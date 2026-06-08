"""Intent classifier — LLM-first router with narrow rule shortcuts.

Strategy mirrors cvm-agents:
1. Very narrow command-style rules catch unambiguous imperatives
   ("создай кампанию", "подбери аудиторию", "сгенерируй креатив").
   They deliberately do NOT fire on "how to" questions.
2. Otherwise call the LLM with a system prompt + few-shot examples.
3. If the LLM is unavailable, default to documentation_qa (safe fallback).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Literal

logger = logging.getLogger(__name__)


IntentName = Literal[
    "build_campaign",
    "suggest_segments",
    "generate_creatives",
    "documentation_qa",
]

_VALID_INTENTS = {"build_campaign", "suggest_segments", "generate_creatives", "documentation_qa"}


@dataclass(slots=True)
class IntentDecision:
    intent: IntentName
    confidence: float
    reason: str = ""


_RULES: list[tuple[IntentName, list[re.Pattern[str]]]] = [
    (
        # Imperative verbs only (создай/собери…, NOT the infinitive создать) with an
        # optional gap before "кампани" — so "Создай SMS-кампанию" matches but the
        # question "Как создать кампанию" stays documentation_qa.
        "build_campaign",
        [
            re.compile(r"\b(создай|собери|сделай|оформи|настрой|запусти)\b[\w\s-]{0,24}кампани", re.IGNORECASE),
            re.compile(r"\b(прорекламир|разместить рекламу|запустить рекламу)\w*", re.IGNORECASE),
            re.compile(r"\b(build|make|create|launch|set up)\b[\w\s-]{0,24}campaign", re.IGNORECASE),
        ],
    ),
    (
        "suggest_segments",
        [
            re.compile(r"\b(собери|предложи|подбери|найди)\s+(сегмент|аудитори)", re.IGNORECASE),
            re.compile(r"\b(suggest|propose|find|recommend)\s+(an?\s+)?(segment|audience)", re.IGNORECASE),
        ],
    ),
    (
        "generate_creatives",
        [
            re.compile(r"\b(сгенерир|придум|напиш|сделай|подбер|дай)\w*\s+(\w+\s+){0,3}(креатив|объявлен|баннер|текст\w*|сообщени)", re.IGNORECASE),
            re.compile(r"\b(generate|create|write)\s+(\w+\s+){0,3}(creative|ad copy|banner|message|text)", re.IGNORECASE),
        ],
    ),
]


def _rule_match(message: str) -> IntentDecision | None:
    text = (message or "").strip()
    if not text:
        return None
    for intent, patterns in _RULES:
        for pattern in patterns:
            if pattern.search(text):
                return IntentDecision(intent=intent, confidence=0.94, reason=f"rule:{pattern.pattern[:36]}")
    return None


_SYSTEM_PROMPT = """Ты — роутер запросов в мультиагентной системе AdConnect. По сообщению пользователя выбери ровно один intent.

Intents:
- build_campaign     — пользователь просит СОЗДАТЬ/собрать рекламную кампанию (повелительное наклонение). НЕ вопрос «как».
- suggest_segments   — подобрать аудиторию / сегмент (без полной кампании).
- generate_creatives — сгенерировать тексты/креативы объявления.
- documentation_qa   — вопрос «как / что / почему», объяснение функций платформы, гайды.

Правило: «как создать кампанию / how to create» — это ВСЕГДА documentation_qa.

Few-shot:
- «Создай SMS-кампанию для семей с детьми» → build_campaign
- «Прорекламируй мой фитнес-клуб» → build_campaign
- «Как создать рекламную кампанию?» → documentation_qa
- «Что такое сегмент аудитории?» → documentation_qa
- «Подбери аудиторию для доставки еды» → suggest_segments
- «Сгенерируй три варианта SMS-текста» → generate_creatives

Ответ — строго JSON одной строкой без markdown:
{"intent":"<one>","confidence":<0..1>,"reason":"<=80 chars"}"""


async def classify_intent(message: str, history: list[dict] | None = None) -> IntentDecision:
    rule = _rule_match(message)
    if rule is not None:
        return rule
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        from llm import get_llm

        llm = get_llm(temperature=0)
        messages = [SystemMessage(content=_SYSTEM_PROMPT)]
        for h in (history or [])[-4:]:
            if h.get("role") == "user":
                messages.append(HumanMessage(content=str(h.get("content", ""))[:500]))
        messages.append(HumanMessage(content=f"CLASSIFY:\n{message}"))
        result = await llm.ainvoke(messages)
        raw = getattr(result, "content", str(result))
        text = raw if isinstance(raw, str) else json.dumps(raw)
        decision = _parse_decision(text)
        if decision is not None:
            return decision
    except Exception as exc:
        logger.info("intent llm classify skipped: %s", exc)
    return IntentDecision(intent="documentation_qa", confidence=0.4, reason="fallback")


def _parse_decision(text: str) -> IntentDecision | None:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`").lstrip("json").strip()
    match = re.search(r"\{.*?\}", raw, re.DOTALL)
    if not match:
        return None
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    intent = payload.get("intent")
    if intent not in _VALID_INTENTS:
        return None
    try:
        confidence = float(payload.get("confidence", 0.6))
    except (TypeError, ValueError):
        confidence = 0.6
    return IntentDecision(
        intent=intent,  # type: ignore[arg-type]
        confidence=max(0.0, min(1.0, confidence)),
        reason=str(payload.get("reason", "llm"))[:80],
    )

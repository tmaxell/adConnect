"""Creative generation — ad copy variants for the "Message" wizard step.

LLM-driven when a provider is configured, with a deterministic template fallback
so the flow works offline and in tests. Returns 2–3 short variants tailored to
the channel (SMS = short, Email = subject + body line).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_SMS_MAX = 160


def _fallback_variants(product: str, goal: str, channel: str) -> list[str]:
    """Deterministic copy used when no LLM is available."""
    subject = (product or "наше предложение").strip()
    if channel == "email":
        return [
            f"{subject}: специальное предложение — оформите сейчас и получите бонус.",
            f"Только для вас: {subject}. Подробности и условия — по ссылке в письме.",
            f"Не упустите {subject}. Ограниченная акция — успейте подключить сегодня.",
        ]
    return [
        f"{subject}: подключите сейчас и получите бонус. Подробности по ссылке.",
        f"Только сегодня — выгодные условия на {subject}. Жми, чтобы оформить!",
        f"{subject} ждёт вас. Специальная цена ограничена — успейте подключить.",
    ]


_LLM_SYSTEM = """You are a copywriter for the AdConnect advertising platform.
Write {n} short advertising message variants in Russian for the given product, goal, channel and audience.
Rules:
- SMS: each variant <= 160 characters, punchy, one call to action.
- Email: each variant is a single subject-style line, slightly longer is fine.
- No emojis, no placeholders, no markdown. Each variant must stand alone.
Return STRICT JSON: {{"variants": ["...", "...", "..."]}}"""


async def _llm_variants(
    product: str, goal: str, channel: str, audience: str, n: int
) -> list[str]:
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        from llm import get_llm

        llm = get_llm(temperature=0.7)
        prompt = (
            f"Product: {product or '—'}\n"
            f"Goal: {goal or '—'}\n"
            f"Channel: {channel}\n"
            f"Audience: {audience or '—'}"
        )
        result = await llm.ainvoke([
            SystemMessage(content=_LLM_SYSTEM.format(n=n)),
            HumanMessage(content=prompt),
        ])
        raw = getattr(result, "content", str(result))
        text = raw if isinstance(raw, str) else json.dumps(raw)
        variants = _parse_variants(text)
        return variants[:n] if variants else []
    except Exception as exc:  # pragma: no cover - depends on provider availability
        logger.info("creatives llm generation skipped: %s", exc)
        return []


def _parse_variants(text: str) -> list[str]:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`").lstrip("json").strip()
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return []
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    variants = payload.get("variants") if isinstance(payload, dict) else None
    if not isinstance(variants, list):
        return []
    return [str(v).strip() for v in variants if str(v).strip()]


async def generate_creatives(
    *,
    product: str | None,
    goal: str | None,
    channel: str,
    audience: str | None = None,
    n: int = 3,
    use_llm: bool = True,
) -> list[str]:
    """Return `n` creative variants for the campaign (LLM, else templates)."""
    product = product or ""
    goal = goal or ""
    variants: list[str] = []
    if use_llm:
        variants = await _llm_variants(product, goal, channel, audience or "", n)
    if not variants:
        variants = _fallback_variants(product, goal, channel)[:n]
    if channel == "sms":
        variants = [v if len(v) <= _SMS_MAX else v[: _SMS_MAX - 1].rstrip() + "…" for v in variants]
    return variants

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
    """Deterministic, advertiser-neutral copy used when no LLM is available."""
    subject = (product or "").strip() or "наше предложение"
    subject = subject[:1].upper() + subject[1:]
    if channel == "email":
        return [
            f"{subject}: специальное предложение. Подробности и условия — по ссылке в письме.",
            f"Только для вас: {subject}. Оставьте заявку сегодня и получите бонус.",
            f"Не пропустите {subject}. Ограниченная акция — успейте до конца недели.",
        ]
    return [
        f"{subject}: специальное предложение, успейте воспользоваться. Подробности по ссылке.",
        f"{subject} со скидкой! Оставьте заявку сегодня и получите бонус.",
        f"Не пропустите {subject}. Ограниченное предложение — переходите по ссылке.",
    ]


_LLM_SYSTEM = """You are a copywriter for the AdConnect advertising platform.
Write {n} short advertising message variants in Russian for the given product, goal, channel and audience.
Rules:
- SMS: each variant <= 160 characters, punchy, one call to action.
- Email: each variant is a single subject-style line, slightly longer is fine.
- Meta (Facebook/Instagram/WhatsApp): 1-2 short sentences of primary ad text with a clear call to action.
- No emojis, no placeholders, no markdown. Each variant must stand alone.
{tone_line}Return STRICT JSON: {{"variants": ["...", "...", "..."]}}"""

# Tone presets steer the copy without changing the structure.
_TONE_HINT = {
    "selling": "Тон: продающий, с явной выгодой и сильным призывом к действию.",
    "friendly": "Тон: дружелюбный и тёплый, на «вы», простыми словами.",
    "business": "Тон: деловой и сдержанный, без восклицаний.",
    "short": "Тон: максимально короткий и ёмкий, без лишних слов.",
}


async def _llm_variants(
    product: str, goal: str, channel: str, audience: str, n: int, tone: str | None = None
) -> list[str]:
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        from llm import get_llm

        llm = get_llm(temperature=0.7)
        tone_line = (_TONE_HINT.get(tone or "", "") + "\n") if tone else ""
        prompt = (
            f"Product: {product or '—'}\n"
            f"Goal: {goal or '—'}\n"
            f"Channel: {channel}\n"
            f"Audience: {audience or '—'}"
        )
        result = await llm.ainvoke([
            SystemMessage(content=_LLM_SYSTEM.format(n=n, tone_line=tone_line)),
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
    tone: str | None = None,
    use_llm: bool = True,
) -> list[str]:
    """Return `n` creative variants for the campaign (LLM, else templates)."""
    product = product or ""
    goal = goal or ""
    variants: list[str] = []
    if use_llm:
        variants = await _llm_variants(product, goal, channel, audience or "", n, tone)
    if not variants:
        variants = _fallback_variants(product, goal, channel)[:n]
    if channel == "sms":
        variants = [v if len(v) <= _SMS_MAX else v[: _SMS_MAX - 1].rstrip() + "…" for v in variants]
    return variants

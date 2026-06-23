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


def _fallback_variants(product: str, goal: str, channel: str, offer: str | None = None) -> list[str]:
    """Deterministic, advertiser-neutral copy used when no LLM is available."""
    subject = (product or "").strip() or "наше предложение"
    subject = subject[:1].upper() + subject[1:]
    deal = (offer or "").strip()
    promo = f" {deal}." if deal else " специальное предложение."
    if channel == "email":
        return [
            f"{subject}:{promo} Подробности и условия — по ссылке в письме.",
            f"Только для вас: {subject}.{promo} Оставьте заявку сегодня.",
            f"Не пропустите {subject}.{promo} Успейте до конца недели.",
        ]
    if channel == "whatsapp":
        return [
            f"{subject}:{promo} Нажмите кнопку — расскажем подробнее в чате.",
            f"{subject} —{promo} Ответьте «Хочу», и подберём вариант для вас.",
            f"Только для подписчиков: {subject}.{promo} Узнайте больше в один тап.",
        ]
    return [
        f"{subject}:{promo} Подробности по ссылке.",
        f"{subject} —{promo} Оставьте заявку сегодня.",
        f"Не пропустите {subject}.{promo} Переходите по ссылке.",
    ]


_LLM_SYSTEM = """You are a senior copywriter for the AdConnect advertising platform.
Write {n} short advertising message variants in Russian using the campaign brief below.
Each variant should follow hook → offer/benefit → call to action, and the variants
must take DIFFERENT angles (e.g. discount, social proof, urgency, the main benefit).
Tailor wording to the audience and the campaign objective.
Rules:
- SMS: each variant <= 160 characters, punchy, one call to action.
- Email: each variant is a single subject-style line, slightly longer is fine.
- Meta (Facebook/Instagram/WhatsApp): 1-2 short sentences of primary ad text with a clear call to action.
- WhatsApp Business (carousel card): 1-2 short, friendly sentences for one carousel card; end with a button-style call to action (e.g. "Узнать подробнее"); no links or phone numbers in the text.
- If an offer is given, make it concrete and prominent. Mention the brand naturally when provided.
- No emojis, no placeholders, no markdown. Each variant must stand alone.
{tone_line}Return STRICT JSON: {{"variants": ["...", "...", "..."]}}"""

_OBJECTIVE_HINT = {
    "awareness": "Цель — узнаваемость: запоминающийся образ бренда.",
    "traffic": "Цель — трафик: мотивировать перейти по ссылке.",
    "engagement": "Цель — вовлечённость: побудить написать/отреагировать.",
    "leads": "Цель — лиды: побудить оставить заявку/контакт.",
    "sales": "Цель — продажи: подтолкнуть к покупке.",
}

# Tone presets steer the copy without changing the structure.
_TONE_HINT = {
    "recommended": ("Сам выбери наиболее эффективный тон и угол подачи для этого "
                    "продукта, цели и аудитории; добавь конкретную выгоду и чёткий призыв."),
    "selling": "Тон: продающий, с явной выгодой и сильным призывом к действию.",
    "friendly": "Тон: дружелюбный и тёплый, на «вы», простыми словами.",
    "business": "Тон: деловой и сдержанный, без восклицаний.",
    "short": "Тон: максимально короткий и ёмкий, без лишних слов.",
}


async def _llm_variants(
    product: str, goal: str, channel: str, audience: str, n: int, tone: str | None = None,
    company: str | None = None, offer: str | None = None, objective: str | None = None,
) -> list[str]:
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        from llm import get_llm

        llm = get_llm(temperature=0.7)
        hints = _TONE_HINT.get(tone or "", "")
        if objective and objective in _OBJECTIVE_HINT:
            hints = (hints + " " + _OBJECTIVE_HINT[objective]).strip()
        tone_line = (hints + "\n") if hints else ""
        prompt = (
            f"Product/service: {product or '—'}\n"
            f"Company/brand: {company or '—'}\n"
            f"Offer: {offer or '—'}\n"
            f"Goal (in user words): {goal or '—'}\n"
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
    company: str | None = None,
    offer: str | None = None,
    objective: str | None = None,
    n: int = 3,
    tone: str | None = None,
    use_llm: bool = True,
) -> list[str]:
    """Return `n` creative variants for the campaign (LLM, else templates)."""
    product = product or ""
    goal = goal or ""
    variants: list[str] = []
    if use_llm:
        variants = await _llm_variants(product, goal, channel, audience or "", n, tone,
                                       company=company, offer=offer, objective=objective)
    if not variants:
        variants = _fallback_variants(product, goal, channel, offer)[:n]
    if channel == "sms":
        variants = [v if len(v) <= _SMS_MAX else v[: _SMS_MAX - 1].rstrip() + "…" for v in variants]
    return variants

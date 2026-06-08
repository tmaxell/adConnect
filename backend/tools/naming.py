"""Campaign naming + subject extraction.

`clean_subject` turns the user's raw request ("Создай SMS-кампанию для моего
фитнес-клуба, привлечь клиентов") into a tight advertising subject ("фитнес-клуб")
by stripping builder filler ("создай … кампанию для"), channel words and the
audience tail. Used both for the campaign name and as the creative subject, so
neither leaks "Создай SMS-кампанию …" into the output.

`generate_campaign_name` produces a short, human name — LLM when available, with a
deterministic fallback derived from the subject.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

# Imperatives, channel words and connectors that are never part of the subject.
_FILLER = frozenset(
    """
    создай создать создаём создаем собери собрать сделай сделать оформи оформить
    настрой настроить запусти запустить сборку прорекламируй прорекламировать
    реклама рекламу рекламную рекламная рекламы рекламе кампанию кампания кампании
    кампанией смс sms email имейл емейл рассылку рассылка для по про на под о об
    мой моя мою моего моих мне наш наша нашу нашего продвижение продвижения
    продвижению продвинуть это давай давайте хочу нужно надо пожалуйста чтобы
    нового новый новую новое новой
    """.split()
)

_CHANNEL_TAIL = re.compile(
    r"[,.;]?\s*(через|по\s+каналу|канал[а-я]*)\s+(sms|смс|email|имейл|емейл).*$",
    re.IGNORECASE,
)
_CHANNEL_PREFIX = re.compile(r"^(sms|смс|email|имейл|емейл)-", re.IGNORECASE)


def clean_subject(product: str | None, goal: str | None) -> str:
    """Extract a tight advertising subject from product/goal. May be empty."""
    text = (product or goal or "").strip()
    if not text:
        return ""
    # After a colon the user usually states the real subject/audience.
    if ":" in text:
        tail = text.split(":", 1)[1].strip()
        if len(tail) >= 4:
            text = tail
    # Keep only the first clause and drop a trailing "через SMS" tail.
    text = re.split(r"[,.;]", text, maxsplit=1)[0]
    text = _CHANNEL_TAIL.sub("", text)

    kept: list[str] = []
    for tok in re.findall(r"[\wёЁ-]+", text, re.UNICODE):
        tok = _CHANNEL_PREFIX.sub("", tok)   # "SMS-кампанию" → "кампанию"
        if not tok or tok.lower() in _FILLER:
            continue
        kept.append(tok)
    return " ".join(kept).strip()


def _titlecase(text: str) -> str:
    return text[:1].upper() + text[1:] if text else text


def derive_name(product: str | None, goal: str | None) -> str:
    """Deterministic campaign name from the subject; dated fallback if empty."""
    subject = clean_subject(product, goal)
    words = subject.split()
    name = _titlecase(" ".join(words[:6]).strip())
    if name:
        return name[:40]
    return f"Рекламная кампания {datetime.now(UTC).strftime('%d.%m.%Y')}"


_NAME_SYSTEM = """Ты придумываешь короткое название рекламной кампании (2–5 слов) на русском.
Без кавычек, без слов «кампания», «реклама», «SMS». Только само название одной строкой.
Пример: вход «Создай SMS-кампанию для моего фитнес-клуба» → «Фитнес-клуб: набор в зал»."""


async def generate_campaign_name(
    product: str | None,
    goal: str | None,
    *,
    channel: str | None = None,
    audience: str | None = None,
    use_llm: bool = True,
) -> str:
    """Short campaign name — LLM when available, deterministic fallback otherwise."""
    if use_llm:
        try:
            from langchain_core.messages import HumanMessage, SystemMessage

            from llm import get_llm

            llm = get_llm(temperature=0.4)
            prompt = f"Запрос: {goal or product or '—'}\nКанал: {channel or '—'}\nАудитория: {audience or '—'}"
            result = await llm.ainvoke([
                SystemMessage(content=_NAME_SYSTEM),
                HumanMessage(content=prompt),
            ])
            raw = getattr(result, "content", "")
            text = raw if isinstance(raw, str) else str(raw)
            name = _sanitize_name(text)
            if name:
                return name
        except Exception as exc:  # pragma: no cover - depends on provider
            logger.info("name llm generation skipped: %s", exc)
    return derive_name(product, goal)


def _sanitize_name(text: str) -> str:
    name = (text or "").strip().splitlines()[0] if text.strip() else ""
    name = name.strip().strip('"«»').strip()
    # Reject degenerate outputs (echoes of the prompt / overly long).
    if not name or len(name) > 48 or re.search(r"\bкампани", name, re.IGNORECASE):
        return ""
    return _titlecase(name)

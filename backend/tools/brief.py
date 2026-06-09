"""Brief extraction — merge a user turn into the structured CampaignDraft.

Two layers:
1. Deterministic pass (`_heuristic_updates`) — channel, geography, demographics,
   age, interests, budget, message count. Works fully offline and powers tests.
2. Optional LLM enrichment (`_llm_updates`) — fills the remaining free-form slots
   (product, goal, message text, income…) when an LLM provider is configured.

Both produce a flat `updates` dict that `merge_updates` applies onto the draft:
list fields are extended uniquely, scalars overwrite when non-empty.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from schemas import CampaignDraft
from tools.catalog import resolve_channel

logger = logging.getLogger(__name__)


# ── Reference data for the deterministic pass ─────────────────────────────────

_GEO_ALIASES: dict[str, str] = {
    "moscow": "Moscow", "москва": "Moscow", "москве": "Moscow",
    "saint-petersburg": "Saint-Petersburg", "petersburg": "Saint-Petersburg",
    "спб": "Saint-Petersburg", "питер": "Saint-Petersburg", "петербург": "Saint-Petersburg",
    "krasnodar": "Krasnodarskiy kray", "краснодар": "Krasnodarskiy kray",
    "russia": "Russia", "россия": "Russia", "рф": "Russia",
    "novosibirsk": "Novosibirsk", "новосибирск": "Novosibirsk",
    "ekaterinburg": "Ekaterinburg", "екатеринбург": "Ekaterinburg",
    "kazan": "Kazan", "казань": "Kazan",
}

_INTEREST_ALIASES: dict[str, str] = {
    "travel": "travel", "путешеств": "travel", "туриз": "travel", "поездк": "travel",
    "movie": "movies", "кино": "movies", "фильм": "movies",
    "walk": "walking", "прогул": "walking", "ходьб": "walking",
    "sport": "sport", "спорт": "sport", "фитнес": "sport",
    "game": "gaming", "игр": "gaming",
    "finance": "finance", "финанс": "finance", "инвест": "finance",
    "tech": "technology", "технолог": "technology", "гаджет": "technology",
    "food": "food", "ресторан": "food", "еда": "food", "кафе": "food",
    "fashion": "fashion", "мода": "fashion", "одежд": "fashion",
    "education": "education", "образован": "education", "учеб": "education", "курс": "education",
}

_AGE_RE = re.compile(r"\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\b")
_BUDGET_RE = re.compile(
    r"(?:бюджет|budget|потрат\w*|spend)\D{0,12}(\d[\d\s.,]{2,})|"
    r"(\d[\d\s.,]{2,})\s*(?:₽|руб|rub|р\.)",
    re.IGNORECASE,
)
_MESSAGES_RE = re.compile(
    r"(\d[\d\s.,]{1,})\s*(?:сообщен\w*|messages?|смс|sms)",
    re.IGNORECASE,
)
_DEMOGRAPHICS_RE = [
    ("men", re.compile(r"\b(мужчин\w*|men\b|male)", re.IGNORECASE)),
    ("women", re.compile(r"\b(женщин\w*|women\b|female)", re.IGNORECASE)),
]


def _parse_number(raw: str) -> float | None:
    cleaned = re.sub(r"[^\d.]", "", raw.replace(",", "."))
    # Multiple dots can appear after stripping thousands separators — keep the last.
    if cleaned.count(".") > 1:
        head, _, tail = cleaned.rpartition(".")
        cleaned = head.replace(".", "") + "." + tail
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def _heuristic_updates(message: str) -> dict[str, Any]:
    text = message or ""
    low = text.lower()
    updates: dict[str, Any] = {}

    channel = resolve_channel(text)
    if channel:
        updates["channel"] = channel

    geo = [name for alias, name in _GEO_ALIASES.items() if alias in low]
    if geo:
        updates["geography"] = list(dict.fromkeys(geo))

    interests = [canon for alias, canon in _INTEREST_ALIASES.items() if alias in low]
    if interests:
        updates["interests"] = list(dict.fromkeys(interests))

    for value, pattern in _DEMOGRAPHICS_RE:
        if pattern.search(text):
            updates["demographics"] = value
            break

    ages = [f"{a}-{b}" for a, b in _AGE_RE.findall(text)]
    # An age range only counts as age if not part of a budget phrase; good enough here.
    if ages:
        updates["age"] = ages

    mmatch = _MESSAGES_RE.search(text)
    if mmatch:
        n = _parse_number(mmatch.group(1))
        if n:
            updates["messages_count"] = int(n)

    bmatch = _BUDGET_RE.search(text)
    if bmatch:
        raw = bmatch.group(1) or bmatch.group(2) or ""
        amount = _parse_number(raw)
        # Avoid mistaking an age range like "25-35" for a budget.
        if amount and amount >= 100:
            updates["budget"] = amount

    return updates


_LLM_SYSTEM = """You extract advertising-campaign parameters from a user message for the AdConnect campaign builder.
Return STRICT JSON (one line, no markdown) with ONLY the fields you can confidently infer from THIS message.
Possible fields:
- product: string (what is advertised)
- goal: string (the user's objective, short)
- channel: "sms" | "email" | "meta"  (meta = Facebook/Instagram/WhatsApp)
- geography: string[] (regions/cities)
- demographics: "all" | "men" | "women"
- age: string[] (e.g. ["18-25","45-55"])
- interests: string[]
- children_age: string[]
- monthly_income: string
- deposits_per_month: string
- message_text: string (ad copy, only if the user provided or asked for a specific text)
- sender: string
- budget: number (rubles)
- messages_count: integer
Omit any field you are unsure about. Never invent values. Example:
{"product":"fitness club","goal":"attract new members","channel":"sms","geography":["Moscow"],"interests":["sport"]}"""


async def _llm_updates(message: str, history: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Best-effort LLM extraction. Returns {} if no provider / on any error."""
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        from llm import get_llm

        llm = get_llm(temperature=0)
        msgs: list[Any] = [SystemMessage(content=_LLM_SYSTEM)]
        for h in (history or [])[-4:]:
            if h.get("role") == "user":
                msgs.append(HumanMessage(content=str(h.get("content", ""))[:500]))
        msgs.append(HumanMessage(content=f"EXTRACT:\n{message}"))
        result = await llm.ainvoke(msgs)
        raw = getattr(result, "content", str(result))
        text = raw if isinstance(raw, str) else json.dumps(raw)
        return _parse_json_object(text)
    except Exception as exc:  # pragma: no cover - depends on provider availability
        logger.info("brief llm extraction skipped: %s", exc)
        return {}


def _parse_json_object(text: str) -> dict[str, Any]:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`").lstrip("json").strip()
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return {}
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


# ── Merge ─────────────────────────────────────────────────────────────────────

_LIST_FIELDS = {"geography", "age", "interests", "children_age"}
_SEGMENT_FIELDS = {
    "geography", "demographics", "age", "interests", "children_age",
    "monthly_income", "deposits_per_month", "template",
}


def merge_updates(draft: CampaignDraft, updates: dict[str, Any]) -> CampaignDraft:
    """Apply a flat updates dict onto the draft. Lists extend uniquely; scalars overwrite."""
    for key, value in updates.items():
        if value in (None, "", [], {}):
            continue

        if key in {"name", "goal", "product"}:
            setattr(draft, key, value)
        elif key == "channel" and value in ("sms", "email", "meta"):
            draft.channel = value  # type: ignore[assignment]
        elif key in _SEGMENT_FIELDS:
            _apply_segment_field(draft, key, value)
        elif key == "message_text":
            draft.message.text = str(value)
        elif key == "sender":
            draft.message.sender = str(value)
        elif key == "budget":
            try:
                draft.cost.budget = float(value)
            except (TypeError, ValueError):
                pass
        elif key == "messages_count":
            try:
                draft.cost.messages_count = int(value)
            except (TypeError, ValueError):
                pass
        elif key in {"start_date", "end_date", "time_from", "time_to"}:
            setattr(draft.cost, key, str(value))
    return draft


def _apply_segment_field(draft: CampaignDraft, key: str, value: Any) -> None:
    seg = draft.segments
    if key == "demographics":
        if value in ("all", "men", "women"):
            seg.demographics = value  # type: ignore[assignment]
        return
    if key in {"monthly_income", "deposits_per_month", "template"}:
        setattr(seg, key, str(value))
        return
    if key in _LIST_FIELDS:
        incoming = value if isinstance(value, list) else [value]
        current = list(getattr(seg, key))
        for item in incoming:
            item_str = str(item)
            if item_str not in current:
                current.append(item_str)
        setattr(seg, key, current)


async def update_draft_from_message(
    draft: CampaignDraft,
    message: str,
    *,
    history: list[dict[str, Any]] | None = None,
    use_llm: bool = True,
) -> CampaignDraft:
    """Merge one user turn into the draft (deterministic pass, then optional LLM)."""
    merge_updates(draft, _heuristic_updates(message))
    if use_llm:
        merge_updates(draft, await _llm_updates(message, history))
    if draft.goal is None and message.strip():
        draft.goal = message.strip()[:200]
    return draft

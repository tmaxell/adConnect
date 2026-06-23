"""Campaign context for generation — turns the draft into a rich brief.

Both the copy endpoint and the builder agent feed this into the creative/offer
generators so the model uses the product, company, offer, objective and the full
audience (segment + operator filters) — not just the product name.
"""

from __future__ import annotations

from typing import Any

_DEMO = {"men": "мужчины", "women": "женщины"}
_FILTER_LABELS = {
    "monthly_income": "доход", "deposits_per_month": "депозиты", "arpu": "средний чек",
    "tariff_type": "тариф", "device": "устройство", "data_usage": "трафик",
    "tenure": "стаж", "marital_status": "семья", "occupation": "занятость", "education": "образование",
}


def audience_description(seg: dict[str, Any]) -> str:
    """Concise human description of the targeted audience for the prompt."""
    if not isinstance(seg, dict):
        return ""
    parts: list[str] = []
    if seg.get("matched_segment_name"):
        parts.append(f"сегмент «{seg['matched_segment_name']}»")
    if seg.get("geography"):
        parts.append("гео: " + ", ".join(seg["geography"]))
    demo = seg.get("demographics")
    if demo in _DEMO:
        parts.append(_DEMO[demo])
    if seg.get("age"):
        parts.append("возраст " + ", ".join(seg["age"]))
    if seg.get("interests"):
        parts.append("интересы: " + ", ".join(seg["interests"]))
    if seg.get("children_age"):
        parts.append("дети " + ", ".join(seg["children_age"]))
    for key, label in _FILTER_LABELS.items():
        if seg.get(key):
            parts.append(f"{label}: {seg[key]}")
    if seg.get("roaming"):
        parts.append("бывают в роуминге")
    if seg.get("trigger_events"):
        parts.append("триггеры: " + ", ".join(seg["trigger_events"]))
    return "; ".join(parts)


def audience_description_from_draft(draft) -> str:
    seg = draft.segments.model_dump() if hasattr(draft.segments, "model_dump") else dict(draft.segments)
    return audience_description(seg)

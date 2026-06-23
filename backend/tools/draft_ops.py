"""Apply a partial patch to a CampaignDraft — powers the clickable canvas.

The frontend sends small patches (a channel pick, a placement toggle, a budget…)
to PATCH /api/sessions/{id}/draft; this merges them into the current draft so the
user can build a campaign by clicking, not only through the chat agent. The agent
and the canvas mutate the same draft, keeping them in sync.
"""

from __future__ import annotations

from typing import Any

from schemas import CampaignDraft
from tools.brief import _canon_list_item

_DEFAULT_MEDIA_FOR_FORMAT = {"feed": "image", "stories": "image", "reels": "video", "whatsapp": "image"}


def _set_list(key: str, value: Any) -> list[str]:
    items = value if isinstance(value, list) else [value]
    out: list[str] = []
    for item in items:
        canon = _canon_list_item(key, str(item))
        if canon and canon not in out:
            out.append(canon)
    return out


def apply_patch(draft: CampaignDraft, patch: dict[str, Any]) -> CampaignDraft:
    """Mutate the draft in place from a flat patch dict. Unknown keys are ignored."""
    seg = draft.segments
    meta = draft.meta
    creative = meta.creative

    for key, value in patch.items():
        if key in ("product", "company", "offer", "goal"):
            setattr(draft, key, str(value).strip() if value else None)
        elif key == "brief_confirmed":
            draft.brief_confirmed = bool(value)
        elif key == "channel" and value in ("sms", "email", "meta"):
            draft.channel = value  # type: ignore[assignment]
        elif key == "objective" and value in ("awareness", "traffic", "engagement", "leads", "sales"):
            meta.objective = value  # type: ignore[assignment]
        elif key == "lookalike":
            meta.lookalike = bool(value)
        elif key == "audience_mode" and value in ("advantage", "manual"):
            meta.audience_mode = value  # type: ignore[assignment]
        elif key == "lookalike_pct":
            try:
                meta.lookalike_pct = max(1, min(10, int(value)))
                meta.lookalike = True
            except (TypeError, ValueError):
                pass
        elif key == "advantage_placements":
            meta.advantage_placements = bool(value)
        elif key == "demographics" and value in ("all", "men", "women"):
            seg.demographics = value  # type: ignore[assignment]
        elif key == "audience_confirmed":
            seg.audience_confirmed = bool(value)
        elif key == "toggle_placement":
            pid = str(value)
            if pid in meta.placements:
                if len(meta.placements) > 1:        # keep at least one placement
                    meta.placements = [p for p in meta.placements if p != pid]
            else:
                meta.placements = meta.placements + [pid]
        elif key == "placements" and isinstance(value, list):
            meta.placements = [str(p) for p in value] or meta.placements
        elif key in ("geography", "age", "interests", "children_age"):
            setattr(seg, key, _set_list(key, value))
        elif key == "geography_add":
            canon = _canon_list_item("geography", str(value))
            if canon and canon not in seg.geography:
                seg.geography = seg.geography + [canon]
            seg.audience_confirmed = True
        elif key == "geography_remove":
            canon = _canon_list_item("geography", str(value))
            seg.geography = [g for g in seg.geography if g != canon]
        elif key in ("monthly_income", "deposits_per_month"):
            setattr(seg, key, str(value) if value else None)
        elif key == "format" and value in ("feed", "stories", "reels", "whatsapp"):
            creative.format = value  # type: ignore[assignment]
            if creative.media_type == "none":
                creative.media_type = _DEFAULT_MEDIA_FOR_FORMAT.get(value, "image")  # type: ignore[assignment]
        elif key == "media" and isinstance(value, dict):
            if value.get("media_type") in ("none", "image", "video"):
                creative.media_type = value["media_type"]
            if "media_url" in value:
                creative.media_url = value.get("media_url")
            if value.get("media_source") in ("upload", "generated", None):
                creative.media_source = value.get("media_source")
        elif key == "headline":
            creative.headline = str(value) if value else None
        elif key == "message_text":
            draft.message.text = str(value) if value else None
        elif key == "sender":
            draft.message.sender = str(value) if value else None
        elif key == "budget":
            try:
                draft.cost.budget = float(value) if value not in (None, "") else None
            except (TypeError, ValueError):
                pass
        elif key == "messages_count":
            try:
                draft.cost.messages_count = int(value) if value not in (None, "") else None
            except (TypeError, ValueError):
                pass

    return draft

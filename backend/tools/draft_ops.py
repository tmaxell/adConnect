"""Apply a partial patch to a CampaignDraft — powers the clickable canvas.

The frontend sends small patches (a channel pick, a placement toggle, a budget…)
to PATCH /api/sessions/{id}/draft; this merges them into the current draft so the
user can build a campaign by clicking, not only through the chat agent. The agent
and the canvas mutate the same draft, keeping them in sync.
"""

from __future__ import annotations

from typing import Any

from schemas import WA_MAX_CARDS, CampaignDraft, WhatsAppButton, WhatsAppCard
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


_SPEC_LIST_FIELDS = ("geography", "age", "interests", "children_age", "trigger_events")
_SPEC_STR_FIELDS = ("demographics", "monthly_income", "deposits_per_month", "tariff_type", "arpu",
                    "device", "data_usage", "tenure", "marital_status", "occupation", "education",
                    "matched_segment_id", "matched_segment_name")


def _apply_segment_spec(seg, spec: dict[str, Any]) -> None:
    """Apply a saved audience / operator preset spec onto the draft's segments."""
    for f in _SPEC_LIST_FIELDS:
        if isinstance(spec.get(f), list):
            setattr(seg, f, [str(x) for x in spec[f]])
    for f in _SPEC_STR_FIELDS:
        if spec.get(f) is not None:
            setattr(seg, f, str(spec[f]) or None)
    if "roaming" in spec:
        seg.roaming = bool(spec["roaming"])
    seg.audience_confirmed = True


def apply_patch(draft: CampaignDraft, patch: dict[str, Any]) -> CampaignDraft:
    """Mutate the draft in place from a flat patch dict. Unknown keys are ignored."""
    seg = draft.segments
    meta = draft.meta
    creative = meta.creative

    for key, value in patch.items():
        if key in ("product", "company", "offer", "goal", "key_message", "destination_url"):
            setattr(draft, key, str(value).strip() if value else None)
        elif key == "cta_type":
            draft.cta_type = value if value in ("site", "whatsapp", "call", "lead") else None
        elif key == "brief_confirmed":
            draft.brief_confirmed = bool(value)
        elif key == "channel" and value in ("sms", "email", "meta", "whatsapp"):
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
        elif key == "apply_segment_spec" and isinstance(value, dict):
            _apply_segment_spec(seg, value)
        elif key in ("matched_segment_id", "matched_segment_name"):
            setattr(seg, key, str(value) if value else None)
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
        elif key in ("monthly_income", "deposits_per_month", "tariff_type", "arpu",
                     "device", "data_usage", "tenure", "marital_status", "occupation", "education"):
            setattr(seg, key, str(value) if value else None)
        elif key == "roaming":
            seg.roaming = bool(value)
        elif key == "trigger_events" and isinstance(value, list):
            seg.trigger_events = [str(v) for v in value]
        elif key == "toggle_trigger":
            ev = str(value)
            seg.trigger_events = (
                [e for e in seg.trigger_events if e != ev] if ev in seg.trigger_events
                else seg.trigger_events + [ev]
            )
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
        else:
            _apply_whatsapp_patch(draft, key, value)

    return draft


# ── WhatsApp Business creative / sender patches ─────────────────────────────────

def _wa_card_at(wa, index: Any) -> WhatsAppCard | None:
    try:
        i = int(index)
    except (TypeError, ValueError):
        return None
    return wa.cards[i] if 0 <= i < len(wa.cards) else None


def _apply_whatsapp_patch(draft: CampaignDraft, key: str, value: Any) -> bool:
    """Apply a WhatsApp Business patch (sender, carousel cards, auto-reply).

    Returns True when the key was a WhatsApp key (handled), False otherwise.
    """
    wa = draft.whatsapp
    if key == "wa_format" and value in ("single", "carousel", "text"):
        wa.format = value
    elif key == "wa_sender_mode" and value in ("shared", "dedicated"):
        wa.sender_mode = value
    elif key == "wa_sender_name":
        wa.sender_name = str(value).strip() if value else None
    elif key == "template_category" and value in ("marketing", "utility"):
        wa.template_category = value
    elif key == "wa_auto_reply_enabled":
        wa.auto_reply_enabled = bool(value)
    elif key == "toggle_wa_auto_reply":
        wa.auto_reply_enabled = not wa.auto_reply_enabled
    elif key == "wa_greeting":
        wa.auto_reply_greeting = str(value) if value else None
    elif key == "opt_in_source":
        wa.opt_in_source = str(value) if value else None
    elif key == "wa_add_card":
        if len(wa.cards) < WA_MAX_CARDS:
            wa.cards.append(WhatsAppCard())
    elif key == "wa_remove_card":
        card = _wa_card_at(wa, value)
        if card is not None:
            wa.cards.remove(card)
    elif key == "wa_card_body" and isinstance(value, dict):
        card = _wa_card_at(wa, value.get("index"))
        if card is not None:
            body = value.get("body")
            card.body = str(body) if body else None
    elif key == "wa_card_media" and isinstance(value, dict):
        card = _wa_card_at(wa, value.get("index"))
        if card is not None:
            if value.get("media_type") in ("none", "image", "video"):
                card.media_type = value["media_type"]
            if "media_url" in value:
                card.media_url = value.get("media_url")
            if value.get("media_source") in ("upload", "generated", None):
                card.media_source = value.get("media_source")
    elif key == "wa_card_buttons" and isinstance(value, dict):
        card = _wa_card_at(wa, value.get("index"))
        if card is not None and isinstance(value.get("buttons"), list):
            buttons: list[WhatsAppButton] = []
            for b in value["buttons"][:2]:        # WhatsApp allows up to 2 buttons per card
                if not isinstance(b, dict):
                    continue
                label = str(b.get("label") or "").strip()
                if not label:
                    continue
                btype = b.get("type") if b.get("type") in ("quick_reply", "url") else "quick_reply"
                bval = str(b["value"]) if b.get("value") else None
                buttons.append(WhatsAppButton(type=btype, label=label, value=bval))
            card.buttons = buttons
    else:
        return False
    return True

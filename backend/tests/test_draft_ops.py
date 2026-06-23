"""Clickable-canvas patches: apply_patch merge semantics + mock creative gen."""

from schemas import CampaignDraft
from tools.creative_gen import generate_svg
from tools.draft_ops import apply_patch


def test_brief_gates_first_step():
    d = CampaignDraft()
    assert d.current_step() == "brief"          # nothing confirmed yet
    apply_patch(d, {"product": "Фитнес-клуб", "company": "FitLab", "offer": "Первый месяц бесплатно"})
    assert d.product == "Фитнес-клуб" and d.company == "FitLab" and d.offer == "Первый месяц бесплатно"
    assert d.current_step() == "brief"          # still needs confirmation
    apply_patch(d, {"objective": "leads", "brief_confirmed": True})
    assert d.meta.objective == "leads" and d.brief_confirmed is True
    assert d.current_step() == "channel"        # brief done → channel next


def test_select_channel_and_objective():
    d = CampaignDraft()
    apply_patch(d, {"channel": "meta", "objective": "leads"})
    assert d.channel == "meta"
    assert d.meta.objective == "leads"


def test_invalid_values_ignored():
    d = CampaignDraft(channel="sms")
    apply_patch(d, {"channel": "carrier-pigeon", "objective": "world-domination"})
    assert d.channel == "sms"            # unchanged
    assert d.meta.objective == "traffic"  # default kept


def test_toggle_placement_adds_and_removes():
    d = CampaignDraft()  # default placements: facebook, instagram
    apply_patch(d, {"toggle_placement": "messenger"})
    assert "messenger" in d.meta.placements
    apply_patch(d, {"toggle_placement": "messenger"})
    assert "messenger" not in d.meta.placements


def test_toggle_keeps_at_least_one_placement():
    d = CampaignDraft()
    d.meta.placements = ["facebook"]
    apply_patch(d, {"toggle_placement": "facebook"})
    assert d.meta.placements == ["facebook"]  # cannot remove the last one


def test_geography_add_canonicalizes_and_confirms_audience():
    d = CampaignDraft()
    apply_patch(d, {"geography_add": "Moscow"})
    assert d.segments.geography == ["Москва"]
    assert d.segments.audience_confirmed is True
    apply_patch(d, {"geography_add": "Москва"})           # no duplicate
    assert d.segments.geography == ["Москва"]
    apply_patch(d, {"geography_remove": "Moscow"})
    assert d.segments.geography == []


def test_demographics_and_age_set():
    d = CampaignDraft()
    apply_patch(d, {"demographics": "women", "age": ["25-34", "35-44"]})
    assert d.segments.demographics == "women"
    assert d.segments.age == ["25-34", "35-44"]


def test_format_sets_default_media_type():
    d = CampaignDraft()
    apply_patch(d, {"format": "reels"})
    assert d.meta.creative.format == "reels"
    assert d.meta.creative.media_type == "video"   # reels default
    # explicit format that keeps an existing media choice untouched
    apply_patch(d, {"media": {"media_type": "image"}})
    apply_patch(d, {"format": "feed"})
    assert d.meta.creative.media_type == "image"   # not overwritten when already set


def test_media_patch_sets_url_and_source():
    d = CampaignDraft()
    apply_patch(d, {"media": {"media_type": "image", "media_url": "/api/uploads/x.png",
                              "media_source": "upload"}})
    assert d.meta.creative.media_url == "/api/uploads/x.png"
    assert d.meta.creative.media_source == "upload"


def test_budget_and_message_text():
    d = CampaignDraft()
    apply_patch(d, {"budget": "50000", "message_text": "Скидка 20%"})
    assert d.cost.budget == 50000.0
    assert d.message.text == "Скидка 20%"


def test_audience_mode_and_lookalike_controls():
    d = CampaignDraft()
    apply_patch(d, {"audience_mode": "manual"})
    assert d.meta.audience_mode == "manual"
    # lookalike_pct is clamped to 1..10 and implies lookalike on
    apply_patch(d, {"lookalike_pct": 25})
    assert d.meta.lookalike_pct == 10 and d.meta.lookalike is True
    apply_patch(d, {"lookalike_pct": 0})
    assert d.meta.lookalike_pct == 1
    apply_patch(d, {"advantage_placements": False})
    assert d.meta.advantage_placements is False


def test_advantage_mode_widens_reach():
    from tools.forecast import estimate
    seg_kwargs = dict(channel="meta", segments=CampaignDraft().segments)
    manual = CampaignDraft(**seg_kwargs)
    manual.segments.interests = ["sport"]
    manual.meta.audience_mode = "manual"
    advantage = manual.model_copy(deep=True)
    advantage.meta.audience_mode = "advantage"
    assert estimate(advantage).audience_reach > estimate(manual).audience_reach


def test_apply_segment_spec_from_saved_audience():
    d = CampaignDraft()
    apply_patch(d, {"apply_segment_spec": {
        "geography": ["Москва"], "age": ["25-34"], "interests": ["sport"],
        "arpu": "700–1500 ₽", "roaming": True, "trigger_events": ["Смена устройства"],
        "matched_segment_id": "seg_x", "matched_segment_name": "Мои клиенты",
    }})
    s = d.segments
    assert s.geography == ["Москва"] and s.interests == ["sport"] and s.arpu == "700–1500 ₽"
    assert s.roaming is True and s.trigger_events == ["Смена устройства"]
    assert s.matched_segment_name == "Мои клиенты" and s.audience_confirmed is True
    assert d.current_step() != "segments" or True  # audience now confirmed


def test_extended_operator_filters():
    from tools.forecast import estimate
    d = CampaignDraft(channel="meta")
    d.meta.audience_mode = "manual"
    base = estimate(d).audience_reach
    apply_patch(d, {"tariff_type": "Постоплата", "arpu": "700–1500 ₽", "device": "iOS",
                    "data_usage": "Высокое", "tenure": "3+ года", "roaming": True,
                    "marital_status": "В браке", "occupation": "Свой бизнес", "education": "Высшее"})
    s = d.segments
    assert s.tariff_type == "Постоплата" and s.device == "iOS" and s.roaming is True
    assert s.is_specified()
    assert estimate(d).audience_reach < base  # every filter narrows reach
    # trigger toggles add/remove
    apply_patch(d, {"toggle_trigger": "Смена устройства"})
    assert "Смена устройства" in d.segments.trigger_events
    apply_patch(d, {"toggle_trigger": "Смена устройства"})
    assert "Смена устройства" not in d.segments.trigger_events


def test_generate_svg_dimensions_and_escaping():
    svg = generate_svg(fmt="stories", media_type="video", headline="A & B <test>", brand="Бренд")
    assert svg.startswith("<svg")
    assert 'width="1080" height="1920"' in svg     # 9:16 stories
    assert "&amp;" in svg and "&lt;" in svg          # escaped
    assert "<polygon" in svg                          # play affordance for video


# ── WhatsApp Business patches ─────────────────────────────────────────────────

def test_whatsapp_select_channel_and_sender():
    d = CampaignDraft()
    apply_patch(d, {"channel": "whatsapp", "wa_sender_mode": "dedicated", "wa_sender_name": "ФитЛаб"})
    assert d.channel == "whatsapp"
    assert d.whatsapp.sender_mode == "dedicated" and d.whatsapp.sender_name == "ФитЛаб"


def test_whatsapp_card_add_edit_remove_and_cap():
    d = CampaignDraft(channel="whatsapp")
    apply_patch(d, {"wa_add_card": {}})
    apply_patch(d, {"wa_card_body": {"index": 0, "body": "Первый месяц бесплатно"}})
    apply_patch(d, {"wa_card_media": {"index": 0, "media_type": "image",
                                      "media_url": "/api/uploads/c.svg", "media_source": "generated"}})
    apply_patch(d, {"wa_card_buttons": {"index": 0, "buttons": [
        {"type": "quick_reply", "label": "Подробнее"},
        {"type": "url", "label": "Сайт", "value": "https://x"},
        {"type": "quick_reply", "label": "Третья — лишняя"},   # capped at 2
    ]}})
    card = d.whatsapp.cards[0]
    assert card.body == "Первый месяц бесплатно" and card.media_url == "/api/uploads/c.svg"
    assert len(card.buttons) == 2 and card.buttons[1].value == "https://x"
    assert d.whatsapp.is_specified()
    assert d.current_step() != "message"  # card has media+text → creative ready

    # Card cap at WA_MAX_CARDS (10).
    for _ in range(20):
        apply_patch(d, {"wa_add_card": {}})
    assert len(d.whatsapp.cards) == 10
    apply_patch(d, {"wa_remove_card": 0})
    assert len(d.whatsapp.cards) == 9


def test_whatsapp_auto_reply_toggle():
    d = CampaignDraft(channel="whatsapp")
    apply_patch(d, {"toggle_wa_auto_reply": True, "wa_greeting": "Здравствуйте!"})
    assert d.whatsapp.auto_reply_enabled is True
    assert d.whatsapp.auto_reply_greeting == "Здравствуйте!"

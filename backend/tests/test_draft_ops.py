"""Clickable-canvas patches: apply_patch merge semantics + mock creative gen."""

from schemas import CampaignDraft
from tools.creative_gen import generate_svg
from tools.draft_ops import apply_patch


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


def test_generate_svg_dimensions_and_escaping():
    svg = generate_svg(fmt="stories", media_type="video", headline="A & B <test>", brand="Бренд")
    assert svg.startswith("<svg")
    assert 'width="1080" height="1920"' in svg     # 9:16 stories
    assert "&amp;" in svg and "&lt;" in svg          # escaped
    assert "<polygon" in svg                          # play affordance for video

"""Forecast estimator: reach narrowing, price surcharges, cost derivation."""

from schemas import CampaignDraft, SegmentSpec
from tools.forecast import FULL_BASE_REACH, estimate
from tools.catalog import CHANNELS, SEGMENTS_BY_ID


def test_full_base_when_no_targeting():
    draft = CampaignDraft(channel="sms")
    f = estimate(draft)
    assert f.audience_reach == FULL_BASE_REACH
    # No paid targeting dimensions → base channel price only.
    assert f.price_per_message == CHANNELS["sms"].base_price_per_message


def test_geography_narrows_reach_and_adds_surcharge():
    base = estimate(CampaignDraft(channel="sms"))
    geo = estimate(CampaignDraft(channel="sms", segments=SegmentSpec(geography=["Moscow"])))
    assert geo.audience_reach < base.audience_reach
    assert geo.price_per_message == round(base.price_per_message + 0.30, 2)


def test_demographics_and_age_narrow_further():
    one = estimate(CampaignDraft(channel="sms", segments=SegmentSpec(geography=["Moscow"])))
    more = estimate(CampaignDraft(
        channel="sms",
        segments=SegmentSpec(geography=["Moscow"], demographics="women", age=["18-25"]),
    ))
    assert more.audience_reach < one.audience_reach


def test_matched_segment_caps_reach():
    seg = SEGMENTS_BY_ID["seg_young_families"]
    f = estimate(CampaignDraft(
        channel="sms",
        segments=SegmentSpec(matched_segment_id=seg.id),
    ))
    # Reach starts from the segment, not the full base.
    assert f.audience_reach <= seg.reach
    assert f.audience_reach < FULL_BASE_REACH


def test_messages_derived_from_budget():
    draft = CampaignDraft(channel="sms")
    draft.cost.budget = 25_000
    f = estimate(draft)
    assert f.messages_count == int(25_000 // f.price_per_message)
    assert f.estimated_cost <= 25_000


def test_email_is_cheaper_than_sms():
    sms = estimate(CampaignDraft(channel="sms"))
    email = estimate(CampaignDraft(channel="email"))
    assert email.price_per_message < sms.price_per_message


# ── Meta (network channel) ────────────────────────────────────────────────────

def test_meta_uses_cpm_not_price_per_message():
    draft = CampaignDraft(channel="meta")
    draft.cost.budget = 30_000
    f = estimate(draft)
    assert f.price_per_message == 0.0
    assert f.cpm == CHANNELS["meta"].avg_cpm
    # impressions = budget / cpm * 1000
    assert f.estimated_impressions == int(30_000 / CHANNELS["meta"].avg_cpm * 1000)
    assert f.estimated_cost == 30_000


def test_meta_audience_capped_by_match_rate():
    # Same targeting on SMS vs Meta: Meta reach is smaller (Custom Audience match).
    seg = SegmentSpec(geography=["Moscow"], interests=["sport"])
    sms = estimate(CampaignDraft(channel="sms", segments=seg))
    meta = estimate(CampaignDraft(channel="meta", segments=seg))
    assert meta.audience_reach < sms.audience_reach
    # Meta reach ≈ SMS reach × match rate (Custom Audience match).
    ratio = meta.audience_reach / sms.audience_reach
    assert abs(ratio - CHANNELS["meta"].match_rate) < 0.01

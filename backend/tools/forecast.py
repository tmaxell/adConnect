"""Reach & budget forecast — the "audience reach / price" panel.

Two channel models:
- messaging (SMS/Email): reach narrows multiplicatively per targeting dimension;
  each message is priced as the channel base + surcharges for paid dimensions
  (geography and demographics carry +0.3 ₽, matching the product UI); messages are
  derived from the budget.
- network (Meta): the operator segment lands as a Custom Audience, so targetable
  reach = narrowed segment × match rate; delivery is priced by CPM
  (impressions = budget ÷ CPM × 1000); the budget is the spend.
"""

from __future__ import annotations

from dataclasses import dataclass

from schemas import CampaignDraft, SegmentSpec
from tools.catalog import CHANNELS, SEGMENTS_BY_ID

# Full operator subscriber base (matches the "Audience reach" figure in the UI).
FULL_BASE_REACH = 1_994_869

# Multiplicative narrowing factors applied when a dimension is targeted.
_NARROWING = {
    "geography": 0.60,
    "demographics": 0.50,     # men / women (not "all")
    "age": 0.70,
    "interests": 0.65,
    "children_age": 0.50,
    "monthly_income": 0.55,
    "deposits_per_month": 0.55,
}

# Per-message surcharge (₽) for paid targeting dimensions (messaging channels).
_PAID_DIMENSION_SURCHARGE = 0.30

# Average impressions per reached person (network channels).
_AVG_FREQUENCY = 1.8


@dataclass
class Forecast:
    audience_reach: int
    price_per_message: float = 0.0
    messages_count: int = 0
    estimated_cost: float = 0.0
    cpm: float = 0.0
    estimated_impressions: int = 0


def _base_reach(seg: SegmentSpec) -> float:
    """Segment reach (matched catalog segment caps the base; else the full base)."""
    if seg.matched_segment_id and seg.matched_segment_id in SEGMENTS_BY_ID:
        return float(SEGMENTS_BY_ID[seg.matched_segment_id].reach)
    return float(FULL_BASE_REACH)


def _narrow(reach: float, seg: SegmentSpec) -> float:
    """Apply multiplicative narrowing for every specified targeting dimension."""
    if seg.geography:
        reach *= _NARROWING["geography"]
    if seg.demographics != "all":
        reach *= _NARROWING["demographics"]
    if seg.age:
        reach *= _NARROWING["age"]
    if seg.interests:
        reach *= _NARROWING["interests"]
    if seg.children_age:
        reach *= _NARROWING["children_age"]
    if seg.monthly_income:
        reach *= _NARROWING["monthly_income"]
    if seg.deposits_per_month:
        reach *= _NARROWING["deposits_per_month"]
    return reach


def estimate(draft: CampaignDraft) -> Forecast:
    """Compute the forecast for a draft, branching on the channel model."""
    channel = CHANNELS.get(draft.channel or "")
    if channel and channel.kind == "network":
        return _estimate_network(draft, channel)
    return _estimate_messaging(draft)


def _estimate_messaging(draft: CampaignDraft) -> Forecast:
    seg = draft.segments
    audience_reach = int(_narrow(_base_reach(seg), seg))

    channel = CHANNELS.get(draft.channel or "")
    price = channel.base_price_per_message if channel else 0.0
    if seg.geography:
        price += _PAID_DIMENSION_SURCHARGE
    if seg.demographics != "all":
        price += _PAID_DIMENSION_SURCHARGE
    price = round(price, 2)

    if draft.cost.messages_count is not None:
        messages = int(draft.cost.messages_count)
    elif draft.cost.budget is not None and price > 0:
        messages = int(draft.cost.budget // price)
    else:
        messages = 0
    messages = min(messages, audience_reach) if audience_reach else messages

    return Forecast(
        audience_reach=audience_reach,
        price_per_message=price,
        messages_count=messages,
        estimated_cost=round(messages * price, 2),
    )


def _estimate_network(draft: CampaignDraft, channel) -> Forecast:
    seg = draft.segments
    # Additional Meta targeting narrows the Custom Audience; match rate is the
    # share of the operator segment that Meta can match to its users.
    narrowed = _narrow(_base_reach(seg), seg)
    matched = int(narrowed * channel.match_rate)

    cpm = channel.avg_cpm
    budget = draft.cost.budget or 0.0
    impressions = int(budget / cpm * 1000) if (budget and cpm) else 0

    return Forecast(
        audience_reach=matched,
        price_per_message=0.0,
        messages_count=0,
        estimated_cost=round(budget, 2),
        cpm=cpm,
        estimated_impressions=impressions,
    )


def apply_forecast(draft: CampaignDraft) -> CampaignDraft:
    """Recompute the forecast and write it back onto the draft in place."""
    f = estimate(draft)
    draft.audience_reach = f.audience_reach
    draft.price_per_message = f.price_per_message
    draft.estimated_cost = f.estimated_cost
    draft.cpm = f.cpm
    draft.estimated_impressions = f.estimated_impressions
    # Messages count only applies to messaging channels.
    if f.messages_count and draft.cost.messages_count is None:
        draft.cost.messages_count = f.messages_count
    return draft

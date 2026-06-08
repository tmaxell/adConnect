"""Reach & budget forecast — the "audience reach / price per message" panel.

Deterministic estimator: starts from the operator base (or a matched segment's
reach), narrows it multiplicatively per specified targeting dimension, and prices
each message as the channel base plus surcharges for paid targeting dimensions
(geography and demographics carry a +0.3 ₽ surcharge, matching the product UI).
"""

from __future__ import annotations

from dataclasses import dataclass

from schemas import CampaignDraft
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

# Per-message surcharge (₽) for paid targeting dimensions.
_PAID_DIMENSION_SURCHARGE = 0.30
_PAID_DIMENSIONS = ("geography", "demographics")


@dataclass
class Forecast:
    audience_reach: int
    price_per_message: float
    messages_count: int
    estimated_cost: float


def estimate(draft: CampaignDraft) -> Forecast:
    """Compute reach, price-per-message and total cost for a draft."""
    seg = draft.segments

    # Base reach: a matched catalog segment caps the audience; otherwise full base.
    if seg.matched_segment_id and seg.matched_segment_id in SEGMENTS_BY_ID:
        reach = float(SEGMENTS_BY_ID[seg.matched_segment_id].reach)
    else:
        reach = float(FULL_BASE_REACH)

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

    audience_reach = int(reach)

    # Price per message: channel base + surcharge per paid targeting dimension.
    channel = CHANNELS.get(draft.channel or "")
    price = channel.base_price_per_message if channel else 0.0
    if seg.geography:
        price += _PAID_DIMENSION_SURCHARGE
    if seg.demographics != "all":
        price += _PAID_DIMENSION_SURCHARGE
    price = round(price, 2)

    # Messages count: explicit, else derived from budget, else capped by reach.
    if draft.cost.messages_count is not None:
        messages = int(draft.cost.messages_count)
    elif draft.cost.budget is not None and price > 0:
        messages = int(draft.cost.budget // price)
    else:
        messages = 0
    messages = min(messages, audience_reach) if audience_reach else messages

    estimated_cost = round(messages * price, 2)
    return Forecast(
        audience_reach=audience_reach,
        price_per_message=price,
        messages_count=messages,
        estimated_cost=estimated_cost,
    )


def apply_forecast(draft: CampaignDraft) -> CampaignDraft:
    """Recompute the forecast and write it back onto the draft in place."""
    f = estimate(draft)
    draft.audience_reach = f.audience_reach
    draft.price_per_message = f.price_per_message
    draft.estimated_cost = f.estimated_cost
    if draft.cost.messages_count is None and f.messages_count:
        draft.cost.messages_count = f.messages_count
    return draft

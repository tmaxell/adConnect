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

from schemas import CampaignDraft, PlatformStat, SegmentSpec
from tools.catalog import CHANNELS, SEGMENTS_BY_ID

# Full operator subscriber base (matches the "Audience reach" figure in the UI).
FULL_BASE_REACH = 1_994_869

# Operator subscribers reachable per region (sums roughly to the full base across RF).
# Lets geo-targeted reach look realistic — a city can't out-reach its own population.
_GEO_REACH: dict[str, int] = {
    "Москва": 615_000,
    "Санкт-Петербург": 312_000,
    "Новосибирск": 96_000,
    "Екатеринбург": 89_000,
    "Казань": 78_000,
    "Нижний Новгород": 74_000,
    "Краснодар": 71_000,
    "Иваново": 27_000,
    "Россия": FULL_BASE_REACH,
}
_DEFAULT_CITY_REACH = 42_000   # unknown city → mid-size regional centre

# Multiplicative narrowing factors applied when a dimension is targeted.
# (Geography is not here — it's captured by the geo-based base reach above.)
_NARROWING = {
    "demographics": 0.55,     # men / women (not "all")
    "age": 0.70,
    "interests": 0.72,
    "children_age": 0.55,
    "monthly_income": 0.60,
    "deposits_per_month": 0.60,
}

# Per-message surcharge (₽) for paid targeting dimensions (messaging channels).
_PAID_DIMENSION_SURCHARGE = 0.30

# Average impressions per reached person (network channels).
_AVG_FREQUENCY = 1.8

# Relative impression share per Meta publisher platform (normalized over selected).
_PLATFORM_WEIGHT = {
    "facebook": 0.40, "instagram": 0.34, "whatsapp": 0.12,
    "messenger": 0.05, "audience_network": 0.09,
}
_PLATFORM_LABEL = {
    "facebook": "Facebook", "instagram": "Instagram", "whatsapp": "WhatsApp",
    "messenger": "Messenger", "audience_network": "Audience Network",
}


@dataclass
class Forecast:
    audience_reach: int
    price_per_message: float = 0.0
    messages_count: int = 0
    estimated_cost: float = 0.0
    cpm: float = 0.0
    estimated_impressions: int = 0


def _base_reach(seg: SegmentSpec) -> float:
    """Base reach before narrowing.

    Priority: a matched catalog segment caps the base; else the selected regions
    sum their reachable subscribers (capped at the full base); else the full base.
    """
    if seg.matched_segment_id and seg.matched_segment_id in SEGMENTS_BY_ID:
        return float(SEGMENTS_BY_ID[seg.matched_segment_id].reach)
    if seg.geography:
        if "Россия" in seg.geography:
            return float(FULL_BASE_REACH)
        total = sum(_GEO_REACH.get(g, _DEFAULT_CITY_REACH) for g in seg.geography)
        return float(min(total, FULL_BASE_REACH))
    return float(FULL_BASE_REACH)


def _narrow(reach: float, seg: SegmentSpec) -> float:
    """Apply multiplicative narrowing for every specified targeting dimension."""
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


def _audience_multiplier(draft: CampaignDraft) -> float:
    """How much the addressable audience widens beyond the Custom Audience seed.

    Advantage+ lets Meta's AI find more buyers beyond your inputs; a manual
    Lookalike widens proportionally to its % (1% closest/narrowest ↔ 10% broadest).
    """
    meta = draft.meta
    if meta.audience_mode == "advantage":
        return 1.7
    if meta.lookalike:
        return 1.0 + 0.3 * max(1, min(10, meta.lookalike_pct))
    return 1.0


def _estimate_network(draft: CampaignDraft, channel) -> Forecast:
    seg = draft.segments
    # Additional Meta targeting narrows the Custom Audience; match rate is the
    # share of the operator segment that Meta can match to its users. Advantage+
    # / Lookalike then widen the addressable pool beyond the seed.
    narrowed = _narrow(_base_reach(seg), seg)
    matched = int(narrowed * channel.match_rate * _audience_multiplier(draft))

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


def platform_breakdown(draft: CampaignDraft) -> list[PlatformStat]:
    """Split expected impressions/reach across the selected Meta placements.

    Mirrors an Insights `publisher_platform` breakdown — the basis for the
    per-platform reporting we'll show after launch.
    """
    # Advantage+ placements → Meta auto-distributes across every platform.
    places = list(_PLATFORM_WEIGHT) if draft.meta.advantage_placements \
        else (draft.meta.placements or ["facebook", "instagram"])
    weights = {p: _PLATFORM_WEIGHT.get(p, 0.10) for p in places}
    total = sum(weights.values()) or 1.0
    rows: list[PlatformStat] = []
    for p in places:
        share = weights[p] / total
        impressions = int(draft.estimated_impressions * share)
        # Delivered reach = impressions / frequency, capped by the audience share.
        reach = min(int(impressions / _AVG_FREQUENCY), int(draft.audience_reach * share))
        rows.append(PlatformStat(
            platform=p,
            label=_PLATFORM_LABEL.get(p, p.title()),
            impressions=impressions,
            reach=reach,
        ))
    return rows


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
    # Per-platform split only for network channels (Meta).
    channel = CHANNELS.get(draft.channel or "")
    draft.platform_breakdown = platform_breakdown(draft) if (channel and channel.kind == "network") else []
    return draft

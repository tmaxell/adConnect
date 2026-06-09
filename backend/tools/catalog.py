"""Operator data catalog — mock of the assets the campaign builder targets.

In production these come from the operator data layer (subscriber-base segments)
and the network adapters (channel capabilities). For the prototype they are
in-code reference data plus a lightweight keyword matcher that turns a natural
language audience description into a ranked list of operator segments.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


# ── Channels ──────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ChannelInfo:
    id: str
    label: str
    description: str
    # "messaging" — operator channels priced per message (SMS/Email).
    # "network"   — external ad networks priced by auction/CPM (Meta).
    kind: str = "messaging"
    base_price_per_message: float = 0.0   # messaging: ₽ per message, before surcharges
    avg_cpm: float = 0.0                   # network: avg ₽ per 1000 impressions
    match_rate: float = 1.0                # network: Custom Audience match rate
    min_audience: int = 0                  # network: minimum matched audience floor
    audience_landing: str = ""             # how an operator segment lands in the channel
    placements: tuple[str, ...] = ()


CHANNELS: dict[str, ChannelInfo] = {
    "sms": ChannelInfo(
        id="sms",
        label="SMS",
        description="Promotional messages for immediate customer engagement",
        kind="messaging",
        base_price_per_message=2.5,
    ),
    "email": ChannelInfo(
        id="email",
        label="Email",
        description="Promotional messages for ongoing customer engagement",
        kind="messaging",
        base_price_per_message=0.4,
    ),
    "meta": ChannelInfo(
        id="meta",
        label="Meta Ads",
        description="Facebook, Instagram & WhatsApp via Marketing API",
        kind="network",
        avg_cpm=300.0,
        match_rate=0.6,
        min_audience=1000,
        audience_landing="Custom Audiences (SHA-256 сопоставление телефонов)",
        placements=("Facebook", "Instagram", "WhatsApp"),
    ),
}


def is_network_channel(channel: str | None) -> bool:
    info = CHANNELS.get(channel or "")
    return bool(info and info.kind == "network")


def resolve_channel(text: str) -> str | None:
    """Detect a channel mentioned in free text. Returns 'sms' | 'email' | 'meta' | None."""
    t = (text or "").lower()
    if re.search(r"(meta|facebook|\bfb\b|instagram|insta|whats?app|мета|фейсбук|инстаграм|вотс?ап)", t):
        return "meta"
    if re.search(r"\b(e-?mail|почт|имейл|емейл)\w*", t):
        return "email"
    if re.search(r"\b(sms|смс|сообщени|текстов)\w*", t):
        return "sms"
    return None


# ── Operator subscriber-base segments ─────────────────────────────────────────

@dataclass(frozen=True)
class OperatorSegment:
    id: str
    name: str
    description: str
    reach: int                                  # subscribers in the segment
    keywords: tuple[str, ...]                    # for matching against a description
    spec: dict[str, Any] = field(default_factory=dict)   # partial SegmentSpec to pre-fill


# Reach figures are illustrative. `spec` pre-fills the wizard "Segments" step.
SEGMENTS: tuple[OperatorSegment, ...] = (
    OperatorSegment(
        id="seg_young_families",
        name="Young families with children",
        description="Subscribers aged 25–40 with children, mid-to-high spend on family services.",
        reach=412_000,
        keywords=("семь", "дет", "родител", "famil", "child", "kids", "ребен", "мам", "пап"),
        spec={"demographics": "all", "age": ["25-34", "35-44"], "children_age": ["0-6", "7-13"],
              "interests": ["family", "kids"]},
    ),
    OperatorSegment(
        id="seg_high_income",
        name="High-income professionals",
        description="Top income decile, frequent travellers and premium service users.",
        reach=188_000,
        keywords=("доход", "богат", "премиум", "income", "wealth", "premium", "professional", "бизнес",
                  "business", "зарплат"),
        spec={"demographics": "all", "age": ["28-45"], "monthly_income": "150000+",
              "interests": ["business", "premium", "travel"]},
    ),
    OperatorSegment(
        id="seg_students",
        name="Students & young adults",
        description="18–24, price-sensitive, heavy mobile data and social media users.",
        reach=534_000,
        keywords=("студент", "молод", "young", "student", "universit", "учеб", "teen"),
        spec={"demographics": "all", "age": ["18-24"], "interests": ["education", "entertainment", "gaming"]},
    ),
    OperatorSegment(
        id="seg_travellers",
        name="Frequent travellers",
        description="Subscribers with regular roaming activity and travel-related spend.",
        reach=121_000,
        keywords=("путешеств", "туриз", "travel", "роуминг", "roaming", "trip", "отпуск", "поездк"),
        spec={"demographics": "all", "age": ["25-45"], "interests": ["travel", "tourism"]},
    ),
    OperatorSegment(
        id="seg_savers",
        name="Savers & depositors",
        description="Hold deposits and top up regularly — receptive to financial offers.",
        reach=276_000,
        keywords=("вклад", "депозит", "накоплен", "saving", "deposit", "финанс", "finance", "банк", "bank"),
        spec={"demographics": "all", "deposits_per_month": "20000+", "interests": ["finance"]},
    ),
    OperatorSegment(
        id="seg_active_mobile",
        name="Active mobile users",
        description="High data consumption, daily app activity across the network.",
        reach=903_000,
        keywords=("актив", "интернет", "трафик", "active", "mobile", "data", "приложен", "app", "онлайн"),
        spec={"demographics": "all", "interests": ["technology", "entertainment"]},
    ),
)

SEGMENTS_BY_ID: dict[str, OperatorSegment] = {s.id: s for s in SEGMENTS}


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[\wёЁ]+", (text or "").lower(), re.UNICODE)


@dataclass
class SegmentMatch:
    segment: OperatorSegment
    score: float
    reasons: list[str] = field(default_factory=list)


def match_segments(description: str, *, limit: int = 3) -> list[SegmentMatch]:
    """Rank operator segments against a free-text audience description.

    Pure keyword overlap (prefix match on stems) — deterministic and offline.
    Returns the top `limit` segments with a 0..1 score; an empty description
    yields the largest segments as sensible defaults.
    """
    tokens = _tokenize(description)
    matches: list[SegmentMatch] = []
    for seg in SEGMENTS:
        reasons: list[str] = []
        hits = 0
        for kw in seg.keywords:
            for tok in tokens:
                if tok.startswith(kw) or kw.startswith(tok) and len(tok) >= 3:
                    hits += 1
                    reasons.append(kw)
                    break
        if hits:
            score = min(1.0, 0.4 + 0.2 * hits)
            matches.append(SegmentMatch(segment=seg, score=round(score, 2), reasons=reasons[:3]))

    if not matches:
        # No keyword signal — fall back to the broadest segments as defaults.
        ranked = sorted(SEGMENTS, key=lambda s: s.reach, reverse=True)[:limit]
        return [SegmentMatch(segment=s, score=0.3, reasons=["default (broad reach)"]) for s in ranked]

    matches.sort(key=lambda m: (m.score, m.segment.reach), reverse=True)
    return matches[:limit]

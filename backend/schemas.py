"""Pydantic contracts shared by the API, the supervisor and the agents.

Two groups:
1. Generic chat contract (ChatAction / ChatArtifact / ChatTraceEvent) — identical
   to cvm-agents so the existing frontend works unchanged.
2. CampaignDraft — the AdConnect-specific domain model. It mirrors the product's
   5-step campaign wizard (Sending Channel → Segments → Message → Cost →
   Confirmation) and is what the builder agent emits as a `campaign_draft`
   artifact for the canvas to render.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Generic chat contract ─────────────────────────────────────────────────────

class ChatAction(BaseModel):
    id: str
    label: str
    kind: str = "default"
    payload: dict[str, Any] = Field(default_factory=dict)


class ChatTraceEvent(BaseModel):
    event: str
    status: Literal["info", "warning", "error"] = "info"
    detail: str | None = None
    ts: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatArtifact(BaseModel):
    id: str
    type: str
    title: str | None = None
    content: dict[str, Any] | None = None
    url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


# ── Analytics contract ────────────────────────────────────────────────────────
# One source of truth for campaign performance: derived from the stored campaigns
# and served identically to the analytics page and the Copilot reporting agent.

class MetricPoint(BaseModel):
    date: str
    impressions: int
    clicks: int
    spend: float
    results: int


class PlatformMetric(BaseModel):
    platform: str
    label: str
    impressions: int
    clicks: int
    spend: float
    ctr: float


class Recommendation(BaseModel):
    severity: Literal["good", "warning", "critical"]
    title: str
    detail: str
    action: str | None = None          # maps to a UI fix (refresh_creative / expand_audience / scale_budget …)
    action_label: str | None = None


class CampaignAnalytics(BaseModel):
    campaign_id: int
    name: str
    channel: str | None = None
    status: str = "active"
    objective: str | None = None
    result_label: str = "Результаты"
    spend: float = 0.0
    impressions: int = 0
    reach: int = 0
    frequency: float = 0.0
    clicks: int = 0
    ctr: float = 0.0                    # %
    cpc: float = 0.0
    cpm: float = 0.0
    results: int = 0
    cost_per_result: float = 0.0
    conversions: int = 0
    conversion_rate: float = 0.0        # %
    roas: float | None = None
    series: list[MetricPoint] = Field(default_factory=list)
    platforms: list[PlatformMetric] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)


class CampaignRow(BaseModel):
    campaign_id: int
    name: str
    channel: str | None = None
    status: str = "active"
    objective: str | None = None
    result_label: str = "Результаты"
    spend: float = 0.0
    impressions: int = 0
    clicks: int = 0
    ctr: float = 0.0
    results: int = 0
    cost_per_result: float = 0.0
    health: Literal["good", "warning", "critical"] = "good"


class ChannelMetric(BaseModel):
    channel: str
    label: str
    campaign_count: int = 0
    spend: float = 0.0
    impressions: int = 0
    clicks: int = 0
    results: int = 0
    share: float = 0.0                  # % of total spend


class AnalyticsSummary(BaseModel):
    spend: float = 0.0
    impressions: int = 0
    reach: int = 0
    clicks: int = 0
    ctr: float = 0.0
    cpc: float = 0.0
    cpm: float = 0.0
    results: int = 0
    cost_per_result: float = 0.0
    conversions: int = 0
    campaign_count: int = 0
    series: list[MetricPoint] = Field(default_factory=list)
    platforms: list[PlatformMetric] = Field(default_factory=list)
    channels: list[ChannelMetric] = Field(default_factory=list)
    campaigns: list[CampaignRow] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)


# ── Campaign wizard domain model ──────────────────────────────────────────────

# Wizard steps in product order. `ready` is a terminal pseudo-step meaning every
# required slot is filled and the draft can be submitted for moderation.
WizardStep = Literal["channel", "segments", "message", "cost", "confirmation", "ready"]
WIZARD_STEPS: tuple[WizardStep, ...] = ("channel", "segments", "message", "cost", "confirmation")

Channel = Literal["sms", "email", "meta"]
Demographics = Literal["all", "men", "women"]


class SegmentSpec(BaseModel):
    """Audience parameters — the "Segments" wizard step.

    All fields optional; the builder fills them incrementally from the dialogue
    and/or by matching a catalog segment. `matched_segment_id` records when the
    audience came from an operator catalog segment rather than free-form input.
    """
    template: str | None = None
    geography: list[str] = Field(default_factory=list)
    demographics: Demographics = "all"
    age: list[str] = Field(default_factory=list)               # e.g. ["18-25", "45-55"]
    monthly_income: str | None = None
    deposits_per_month: str | None = None
    interests: list[str] = Field(default_factory=list)
    children_age: list[str] = Field(default_factory=list)
    triggers_enabled: bool = False
    matched_segment_id: str | None = None
    matched_segment_name: str | None = None
    # The user actively decided on the audience (picked a segment, described it on
    # the segments step, or chose to continue) — gates leaving the segments step,
    # so the agent always *offers* to pick an audience even if some fields were
    # pre-filled (heuristics/LLM inferring from the product).
    audience_confirmed: bool = False

    def is_specified(self) -> bool:
        """True when the user gave at least one meaningful targeting signal."""
        return bool(
            self.geography
            or self.age
            or self.interests
            or self.children_age
            or self.monthly_income
            or self.deposits_per_month
            or self.demographics != "all"
            or self.matched_segment_id
        )

    def is_ready(self) -> bool:
        """The segments step is complete only after an explicit audience decision."""
        return self.audience_confirmed or bool(self.matched_segment_id)


MetaObjective = Literal["awareness", "traffic", "engagement", "leads", "sales"]

# Publisher platforms. WhatsApp became a real placement in 2025 (Status ads in the
# Updates tab, 9:16); it also remains a Click-to-WhatsApp destination from FB/IG.
META_PLACEMENTS: tuple[str, ...] = ("facebook", "instagram", "messenger", "whatsapp", "audience_network")

# Ad creative format (placement position / WhatsApp Status + Click-to-WhatsApp).
MetaFormat = Literal["feed", "stories", "reels", "whatsapp"]
MediaType = Literal["none", "image", "video"]


class MetaCreative(BaseModel):
    """Creative for a Meta ad: format, media asset, headline and generation prompt."""
    format: MetaFormat = "feed"
    media_type: MediaType = "none"
    media_url: str | None = None                     # uploaded or generated asset
    media_source: Literal["upload", "generated"] | None = None
    headline: str | None = None
    prompt: str | None = None                        # brief used to generate the media


# Ad Set audience-building method (Meta's four targeting modes collapse to two
# top-level choices in Ads Manager): Advantage+ Audience (AI finds buyers, your
# inputs are *suggestions*) vs Manual (Core/Custom/Lookalike you control).
AudienceMode = Literal["advantage", "manual"]


class MetaSpec(BaseModel):
    """Meta-specific campaign config (maps to Campaign objective + Ad Set targeting)."""
    objective: MetaObjective = "traffic"
    placements: list[str] = Field(default_factory=lambda: ["facebook", "instagram"])
    # Audience source: operator data → Custom Audience seed; optional Lookalike
    # expansion (1–10%, closer ↔ broader); Advantage+ vs manual targeting mode.
    audience_mode: AudienceMode = "advantage"
    lookalike: bool = False
    lookalike_pct: int = 3                 # 1 = closest to source, 10 = broadest
    advantage_placements: bool = True      # Advantage+ placements (auto) vs manual
    optimization_goal: str = "link_clicks"
    creative: MetaCreative = Field(default_factory=MetaCreative)


class PlatformStat(BaseModel):
    """Per-publisher-platform forecast row (mirrors an Insights publisher_platform breakdown)."""
    platform: str
    label: str
    impressions: int
    reach: int


class MessageSpec(BaseModel):
    """The creative — the "Message" wizard step."""
    text: str | None = None
    sender: str | None = None
    # Creative variants generated by the agent before one is chosen.
    variants: list[str] = Field(default_factory=list)

    def is_specified(self) -> bool:
        return bool(self.text and self.text.strip())


class CostSpec(BaseModel):
    """Budget and scheduling — the "Cost" wizard step."""
    budget: float | None = None
    messages_count: int | None = None
    start_date: str | None = None
    end_date: str | None = None
    time_from: str | None = None
    time_to: str | None = None
    uniform_distribution: bool = False
    autorun: bool = False

    def is_specified(self) -> bool:
        return self.budget is not None or self.messages_count is not None


class CampaignDraft(BaseModel):
    """Full campaign draft — the contract between the builder agent and the canvas.

    `step` is the first incomplete wizard step (computed by `current_step`).
    Forecast fields (`audience_reach`, `price_per_message`, `estimated_cost`) are
    filled by tools/forecast.py.
    """
    name: str | None = None
    goal: str | None = None                       # the user's original intent, in their words
    product: str | None = None                    # what is being advertised
    channel: Channel | None = None
    segments: SegmentSpec = Field(default_factory=SegmentSpec)
    message: MessageSpec = Field(default_factory=MessageSpec)
    cost: CostSpec = Field(default_factory=CostSpec)
    meta: MetaSpec = Field(default_factory=MetaSpec)   # used when channel == "meta"

    audience_reach: int = 0
    price_per_message: float = 0.0        # messaging channels (SMS/Email)
    estimated_cost: float = 0.0
    cpm: float = 0.0                       # network channels (Meta): ₽ per 1000 impressions
    estimated_impressions: int = 0         # network channels: budget ÷ CPM × 1000
    platform_breakdown: list[PlatformStat] = Field(default_factory=list)  # Meta per-platform split

    status: Literal["draft", "submitted"] = "draft"
    step: WizardStep = "channel"

    def current_step(self) -> WizardStep:
        """First wizard step whose required slots are not yet filled."""
        if self.channel is None:
            return "channel"
        if not self.segments.is_ready():
            return "segments"
        if not self.message.is_specified():
            return "message"
        if not self.cost.is_specified():
            return "cost"
        return "confirmation"

    def is_ready(self) -> bool:
        return self.current_step() == "confirmation"

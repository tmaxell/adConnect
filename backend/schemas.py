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


class DemographicMetric(BaseModel):
    dimension: str                      # "age" | "gender"
    label: str                          # "25-34" | "Мужчины"
    impressions: int = 0
    results: int = 0
    share: float = 0.0                  # % of impressions within its dimension


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
    deltas: dict[str, float] = Field(default_factory=dict)   # % change vs previous period
    series: list[MetricPoint] = Field(default_factory=list)
    platforms: list[PlatformMetric] = Field(default_factory=list)
    demographics: list[DemographicMetric] = Field(default_factory=list)
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
    deltas: dict[str, float] = Field(default_factory=dict)   # % change vs previous period
    series: list[MetricPoint] = Field(default_factory=list)
    platforms: list[PlatformMetric] = Field(default_factory=list)
    channels: list[ChannelMetric] = Field(default_factory=list)
    demographics: list[DemographicMetric] = Field(default_factory=list)
    campaigns: list[CampaignRow] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)


# ── Campaign wizard domain model ──────────────────────────────────────────────

# Wizard steps in product order. `ready` is a terminal pseudo-step meaning every
# required slot is filled and the draft can be submitted for moderation.
WizardStep = Literal["brief", "channel", "segments", "message", "cost", "confirmation", "ready"]
WIZARD_STEPS: tuple[WizardStep, ...] = ("brief", "channel", "segments", "message", "cost", "confirmation")

Channel = Literal["sms", "email", "meta", "whatsapp"]
Demographics = Literal["all", "men", "women"]

# Desired call to action — the destination the creative drives to.
CtaType = Literal["site", "whatsapp", "call", "lead"]
CTA_LABEL: dict[str, str] = {
    "site": "перейти на сайт",
    "whatsapp": "написать в WhatsApp",
    "call": "позвонить",
    "lead": "оставить заявку",
}


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
    # Extended operator (telecom big-data) filters — power the "Доп. параметры" block.
    tariff_type: str | None = None          # предоплата / постоплата / корпоративный
    arpu: str | None = None                 # средний чек (band)
    device: str | None = None               # iOS / Android / премиум / бюджетные
    data_usage: str | None = None           # низкое / среднее / высокое
    tenure: str | None = None               # стаж с оператором (band)
    roaming: bool = False                   # были в роуминге / поездках
    trigger_events: list[str] = Field(default_factory=list)  # событийный таргетинг
    marital_status: str | None = None
    occupation: str | None = None
    education: str | None = None
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
            or self.tariff_type or self.arpu or self.device or self.data_usage
            or self.tenure or self.roaming or self.trigger_events
            or self.marital_status or self.occupation or self.education
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


# ── WhatsApp Business channel (operator broadcast via BSP aggregator) ──────────
# A *separate operator channel* (not the Meta `whatsapp` placement): an approved
# MARKETING template — optionally a carousel of up to 10 cards — broadcast to
# opted-in subscribers through a BSP aggregator (e.g. Woztell) under the operator's
# WABA. Priced per delivered message; the operator's bot then continues the chat
# for free inside the 24h service window. This is NOT a chatbot builder — the
# advertiser composes the broadcast and (optionally) a light auto-reply.

WhatsAppButtonType = Literal["quick_reply", "url"]


class WhatsAppButton(BaseModel):
    """A template button: a quick reply (handled by the operator bot) or a URL."""
    type: WhatsAppButtonType = "quick_reply"
    label: str
    value: str | None = None        # URL for "url"; reply payload/text for "quick_reply"


class WhatsAppCard(BaseModel):
    """One carousel card: media (1:1) + body text + up to 2 buttons."""
    media_type: MediaType = "image"
    media_url: str | None = None
    media_source: Literal["upload", "generated"] | None = None
    body: str | None = None
    buttons: list[WhatsAppButton] = Field(default_factory=list)

    def is_specified(self) -> bool:
        return bool((self.body and self.body.strip()) or self.media_url)


WhatsAppSenderMode = Literal["shared", "dedicated"]
WhatsAppTemplateStatus = Literal["draft", "pending", "approved"]

# Marketing template format variations (all card-based here):
#  single   — one media-header card (image/video + body + buttons)
#  carousel — 2–10 media cards
#  text     — body + buttons, no media
WhatsAppFormat = Literal["single", "carousel", "text"]

# Carousel size cap (Meta allows up to 10 cards per media-card carousel template).
WA_MAX_CARDS = 10


class WhatsAppSpec(BaseModel):
    """WhatsApp Business config: sender (account model), template format, light bot."""
    template_category: Literal["marketing", "utility"] = "marketing"
    format: WhatsAppFormat = "carousel"
    # Sender / account model under the operator's WABA via the aggregator:
    # shared = the operator's common sender ("AdConnect Promo"); dedicated = the
    # advertiser's own display name, provisioned by the operator (large advertisers).
    sender_mode: WhatsAppSenderMode = "shared"
    sender_name: str | None = None          # display name when sender_mode == "dedicated"
    cards: list[WhatsAppCard] = Field(default_factory=list)
    # Light automation handled by the operator's bot (free 24h service window) —
    # a single greeting, not a flow builder. Optional.
    auto_reply_enabled: bool = False
    auto_reply_greeting: str | None = None
    opt_in_source: str | None = None        # how subscribers opted in (note)
    template_status: WhatsAppTemplateStatus = "draft"

    def is_specified(self) -> bool:
        """The creative step is complete once at least one card has media or text."""
        return any(c.is_specified() for c in self.cards)


class BusinessProfile(BaseModel):
    """Durable advertiser context, set once and used to pre-fill every campaign brief."""
    company_name: str | None = None
    industry: str | None = None
    website: str | None = None
    tone: str | None = None                # preferred tone of voice for copy
    default_product: str | None = None     # main product/service advertised
    description: str | None = None         # short "about us" for the model


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
    company: str | None = None                    # advertiser / brand (from profile or brief)
    offer: str | None = None                      # the concrete offer / promo for this campaign
    key_message: str | None = None                # USP / single key message for the creative
    cta_type: CtaType | None = None               # desired call to action
    destination_url: str | None = None            # landing / link backing the CTA
    brief_confirmed: bool = False                 # user passed the brief step (product + objective)
    channel: Channel | None = None
    segments: SegmentSpec = Field(default_factory=SegmentSpec)
    message: MessageSpec = Field(default_factory=MessageSpec)
    cost: CostSpec = Field(default_factory=CostSpec)
    meta: MetaSpec = Field(default_factory=MetaSpec)   # used when channel == "meta"
    whatsapp: WhatsAppSpec = Field(default_factory=WhatsAppSpec)  # used when channel == "whatsapp"

    audience_reach: int = 0
    price_per_message: float = 0.0        # messaging channels (SMS/Email)
    estimated_cost: float = 0.0
    cpm: float = 0.0                       # network channels (Meta): ₽ per 1000 impressions
    estimated_impressions: int = 0         # network channels: budget ÷ CPM × 1000
    platform_breakdown: list[PlatformStat] = Field(default_factory=list)  # Meta per-platform split

    status: Literal["draft", "submitted"] = "draft"
    step: WizardStep = "brief"

    def is_brief_ready(self) -> bool:
        """Brief step is complete once the user has confirmed it (canvas requires a
        product before enabling 'continue'; the chat agent confirms on first reply)."""
        return self.brief_confirmed

    def current_step(self) -> WizardStep:
        """First wizard step whose required slots are not yet filled."""
        if not self.is_brief_ready():
            return "brief"
        if self.channel is None:
            return "channel"
        if not self.segments.is_ready():
            return "segments"
        if not self._is_message_ready():
            return "message"
        if not self.cost.is_specified():
            return "cost"
        return "confirmation"

    def _is_message_ready(self) -> bool:
        """Creative step readiness — a WhatsApp carousel card, else a message text."""
        if self.channel == "whatsapp":
            return self.whatsapp.is_specified()
        return self.message.is_specified()

    def is_ready(self) -> bool:
        return self.current_step() == "confirmation"

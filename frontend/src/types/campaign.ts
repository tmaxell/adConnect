/**
 * CampaignDraft — mirror of the backend `schemas.CampaignDraft` (campaign_draft
 * artifact). This is the contract the agent fills turn by turn and the wizard
 * canvas renders live.
 */

export type WizardStep = "brief" | "channel" | "segments" | "message" | "cost" | "confirmation" | "ready";
export const WIZARD_STEPS: WizardStep[] = ["brief", "channel", "segments", "message", "cost", "confirmation"];

export interface BusinessProfile {
  company_name: string | null;
  industry: string | null;
  website: string | null;
  tone: string | null;
  default_product: string | null;
  description: string | null;
}

export type Channel = "sms" | "email" | "meta" | "whatsapp";
export type Demographics = "all" | "men" | "women";

/** Network (auction/CPM) channels vs operator messaging channels. */
export const NETWORK_CHANNELS_IDS: Channel[] = ["meta"];
export function isNetworkChannel(channel: Channel | null): boolean {
  return channel != null && NETWORK_CHANNELS_IDS.includes(channel);
}

/** Channels with a dedicated creative step (Meta ad / WhatsApp carousel). */
export function isRichCreativeChannel(channel: Channel | null): boolean {
  return channel === "meta" || channel === "whatsapp";
}

export interface SegmentSpec {
  template: string | null;
  geography: string[];
  demographics: Demographics;
  age: string[];
  monthly_income: string | null;
  deposits_per_month: string | null;
  interests: string[];
  children_age: string[];
  triggers_enabled: boolean;
  tariff_type: string | null;
  arpu: string | null;
  device: string | null;
  data_usage: string | null;
  tenure: string | null;
  roaming: boolean;
  trigger_events: string[];
  marital_status: string | null;
  occupation: string | null;
  education: string | null;
  matched_segment_id: string | null;
  matched_segment_name: string | null;
  audience_confirmed: boolean;
}

export interface MessageSpec {
  text: string | null;
  sender: string | null;
  variants: string[];
}

export type MetaObjective = "awareness" | "traffic" | "engagement" | "leads" | "sales";

/** Ad creative format (placement position / Click-to-WhatsApp destination). */
export type MetaFormat = "feed" | "stories" | "reels" | "whatsapp";
export type MediaType = "none" | "image" | "video";

export interface MetaCreative {
  format: MetaFormat;
  media_type: MediaType;
  media_url: string | null;
  media_source: "upload" | "generated" | null;
  headline: string | null;
  prompt: string | null;
}

/** WhatsApp Business (operator carousel broadcast via BSP aggregator). */
export type WhatsAppButtonType = "quick_reply" | "url";
export interface WhatsAppButton {
  type: WhatsAppButtonType;
  label: string;
  value: string | null;
}
export interface WhatsAppCard {
  media_type: MediaType;
  media_url: string | null;
  media_source: "upload" | "generated" | null;
  body: string | null;
  buttons: WhatsAppButton[];
}
export type WhatsAppSenderMode = "shared" | "dedicated";
export type WhatsAppTemplateStatus = "draft" | "pending" | "approved";
export interface WhatsAppSpec {
  template_category: "marketing" | "utility";
  sender_mode: WhatsAppSenderMode;
  sender_name: string | null;
  cards: WhatsAppCard[];
  auto_reply_enabled: boolean;
  auto_reply_greeting: string | null;
  opt_in_source: string | null;
  template_status: WhatsAppTemplateStatus;
}
export const WA_MAX_CARDS = 10;

export type AudienceMode = "advantage" | "manual";

export interface MetaSpec {
  objective: MetaObjective;
  placements: string[];
  audience_mode: AudienceMode;
  lookalike: boolean;
  lookalike_pct: number;
  advantage_placements: boolean;
  optimization_goal: string;
  creative: MetaCreative;
}

export interface PlatformStat {
  platform: string;
  label: string;
  impressions: number;
  reach: number;
}

export interface CostSpec {
  budget: number | null;
  messages_count: number | null;
  start_date: string | null;
  end_date: string | null;
  time_from: string | null;
  time_to: string | null;
  uniform_distribution: boolean;
  autorun: boolean;
}

export interface CampaignDraft {
  name: string | null;
  goal: string | null;
  product: string | null;
  company: string | null;
  offer: string | null;
  brief_confirmed: boolean;
  channel: Channel | null;
  segments: SegmentSpec;
  message: MessageSpec;
  cost: CostSpec;
  meta: MetaSpec;
  whatsapp: WhatsAppSpec;
  audience_reach: number;
  price_per_message: number;
  estimated_cost: number;
  cpm: number;
  estimated_impressions: number;
  platform_breakdown: PlatformStat[];
  status: "draft" | "submitted";
  step: WizardStep;
}

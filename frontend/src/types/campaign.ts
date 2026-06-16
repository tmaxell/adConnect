/**
 * CampaignDraft — mirror of the backend `schemas.CampaignDraft` (campaign_draft
 * artifact). This is the contract the agent fills turn by turn and the wizard
 * canvas renders live.
 */

export type WizardStep = "channel" | "segments" | "message" | "cost" | "confirmation" | "ready";
export const WIZARD_STEPS: WizardStep[] = ["channel", "segments", "message", "cost", "confirmation"];

export type Channel = "sms" | "email" | "meta";
export type Demographics = "all" | "men" | "women";

/** Network (auction/CPM) channels vs operator messaging channels. */
export const NETWORK_CHANNELS_IDS: Channel[] = ["meta"];
export function isNetworkChannel(channel: Channel | null): boolean {
  return channel != null && NETWORK_CHANNELS_IDS.includes(channel);
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
  channel: Channel | null;
  segments: SegmentSpec;
  message: MessageSpec;
  cost: CostSpec;
  meta: MetaSpec;
  audience_reach: number;
  price_per_message: number;
  estimated_cost: number;
  cpm: number;
  estimated_impressions: number;
  platform_breakdown: PlatformStat[];
  status: "draft" | "submitted";
  step: WizardStep;
}

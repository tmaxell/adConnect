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
}

export interface MessageSpec {
  text: string | null;
  sender: string | null;
  variants: string[];
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
  audience_reach: number;
  price_per_message: number;
  estimated_cost: number;
  cpm: number;
  estimated_impressions: number;
  status: "draft" | "submitted";
  step: WizardStep;
}

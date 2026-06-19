/** Mirrors backend schemas.* analytics contract (tools/analytics single source). */

export interface MetricPoint {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  results: number;
}

export interface PlatformMetric {
  platform: string;
  label: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
}

export interface DemographicMetric {
  dimension: "age" | "gender" | string;
  label: string;
  impressions: number;
  results: number;
  share: number;
}

export type Severity = "good" | "warning" | "critical";

export interface Recommendation {
  severity: Severity;
  title: string;
  detail: string;
  action: string | null;
  action_label: string | null;
}

export interface CampaignAnalytics {
  campaign_id: number;
  name: string;
  channel: string | null;
  status: string;
  objective: string | null;
  result_label: string;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  results: number;
  cost_per_result: number;
  conversions: number;
  conversion_rate: number;
  roas: number | null;
  deltas: Record<string, number>;
  series: MetricPoint[];
  platforms: PlatformMetric[];
  demographics: DemographicMetric[];
  recommendations: Recommendation[];
}

export interface CampaignRow {
  campaign_id: number;
  name: string;
  channel: string | null;
  status: string;
  objective: string | null;
  result_label: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  results: number;
  cost_per_result: number;
  health: Severity;
}

export interface ChannelMetric {
  channel: string;
  label: string;
  campaign_count: number;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  share: number;
}

export interface AnalyticsSummary {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  results: number;
  cost_per_result: number;
  conversions: number;
  campaign_count: number;
  deltas: Record<string, number>;
  series: MetricPoint[];
  platforms: PlatformMetric[];
  channels: ChannelMetric[];
  demographics: DemographicMetric[];
  campaigns: CampaignRow[];
  recommendations: Recommendation[];
}

export interface CampaignAdvice {
  campaign_id: number;
  advice: string;
  recommendations: Recommendation[];
}

/**
 * Channel / network display catalog for the "Sending Channel" wizard step.
 *
 * Two groups, per the integration analysis (docs/Интеграция_внешних_рекламных_сетей):
 *  - Operator channels (SMS / Email) — available now, priced per message.
 *  - External ad networks (Telegram / Meta / Google) — display-only for now
 *    ("Planned"). Each carries the audience-landing mechanism that determines how
 *    an operator segment reaches that network (Custom Audience / Customer Match /
 *    channel-topic targeting). See docs/channels_integration_plan.md.
 */

export type ChannelStatus = "available" | "planned";
export type ChannelGroup = "operator" | "network";

export interface ChannelCard {
  id: string;
  label: string;
  description: string;
  group: ChannelGroup;
  status: ChannelStatus;
  /** Per-message price for operator channels (₽). */
  pricePerMessage?: number;
  /** How an operator segment is landed in this network. */
  audienceLanding?: string;
  /** Short note about the integration model. */
  note?: string;
}

export const OPERATOR_CHANNELS: ChannelCard[] = [
  {
    id: "sms",
    label: "SMS",
    description: "Promotional messages for immediate customer engagement",
    group: "operator",
    status: "available",
    pricePerMessage: 2.5,
  },
  {
    id: "email",
    label: "Email",
    description: "Promotional messages for ongoing customer engagement",
    group: "operator",
    status: "available",
    pricePerMessage: 0.4,
  },
];

export const NETWORK_CHANNELS: ChannelCard[] = [
  {
    id: "telegram_ads",
    label: "Telegram Ads",
    description: "Channel & topic targeting via official reseller access",
    group: "network",
    status: "planned",
    audienceLanding: "Подбор каналов и тематик (без загрузки списков)",
    note: "Реселлерская модель, суб-баланс на нашей стороне",
  },
  {
    id: "meta_ads",
    label: "Meta Ads",
    description: "Facebook, Instagram & WhatsApp via Marketing API",
    group: "network",
    status: "planned",
    audienceLanding: "Custom Audiences (SHA-256 сопоставление телефонов)",
    note: "Агентские кабинеты под Business Manager оператора",
  },
  {
    id: "google_ads",
    label: "Google Ads",
    description: "Search & display via manager account (MCC)",
    group: "network",
    status: "planned",
    audienceLanding: "Customer Match (хешированные идентификаторы)",
    note: "Консолидированный биллинг под MCC",
  },
];

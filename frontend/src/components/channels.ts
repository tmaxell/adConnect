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
  {
    id: "whatsapp",
    label: "WhatsApp Business",
    description: "Карусель-рассылка через бота под аккаунтом оператора",
    group: "operator",
    status: "available",
    pricePerMessage: 9,
    audienceLanding: "WhatsApp opt-in (через агрегатора)",
    note: "Открытие диалога платное, дальнейшая переписка с ботом — бесплатно",
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
    id: "meta",
    label: "Meta Ads",
    description: "Facebook, Instagram & WhatsApp via Marketing API",
    group: "network",
    status: "available",
    audienceLanding: "Custom Audiences (SHA-256 сопоставление телефонов)",
    note: "Оплата за показы (CPM ≈ 300 ₽), агентские кабинеты под Business Manager",
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

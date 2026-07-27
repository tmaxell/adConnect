/**
 * Channel / network display catalog for the "Sending Channel" wizard step.
 *
 * Two groups, per the integration analysis (docs/Интеграция_внешних_рекламных_сетей):
 *  - Operator channels (SMS / Email) — available now, priced per message.
 *  - External ad networks (Telegram / Meta / Google) — display-only for now
 *    ("Planned"). Each carries the audience-landing mechanism that determines how
 *    an operator segment reaches that network (Custom Audience / Customer Match /
 *    channel-topic targeting). See docs/channels_integration_plan.md.
 *
 * Display copy (`description` / `audienceLanding` / `note`) is language-aware:
 * each is a getter resolved at render time via the i18n `t()` helper, so the
 * whole catalog re-localizes when the language toggles. `label` is a
 * brand/channel name and stays language-neutral.
 */

import { t } from "../i18n";

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

export function getOperatorChannels(): ChannelCard[] {
  return [
    {
      id: "sms",
      label: "SMS",
      description: t(
        "Промо-сообщения для мгновенного контакта с клиентом",
        "Promotional messages for immediate customer engagement",
      ),
      group: "operator",
      status: "available",
      pricePerMessage: 2.5,
    },
    {
      id: "email",
      label: "Email",
      description: t(
        "Промо-сообщения для регулярной коммуникации с клиентом",
        "Promotional messages for ongoing customer engagement",
      ),
      group: "operator",
      status: "available",
      pricePerMessage: 0.4,
    },
    {
      id: "whatsapp",
      label: "WhatsApp Business",
      description: t(
        "Карусель-рассылка через бота под аккаунтом оператора",
        "Carousel broadcast via a bot under the operator's account",
      ),
      group: "operator",
      status: "available",
      pricePerMessage: 9,
      audienceLanding: t("WhatsApp opt-in", "WhatsApp opt-in"),
      note: t(
        "Открытие диалога платное, дальнейшая переписка с ботом — бесплатно",
        "Opening the conversation is paid; further chat with the bot is free",
      ),
    },
  ];
}

export function getNetworkChannels(): ChannelCard[] {
  return [
    {
      id: "telegram_ads",
      label: "Telegram Ads",
      description: t(
        "Таргетинг по каналам и тематикам через официальный реселлерский доступ",
        "Channel & topic targeting via official reseller access",
      ),
      group: "network",
      status: "planned",
      audienceLanding: t(
        "Подбор каналов и тематик (без загрузки списков)",
        "Channel & topic selection (no list upload)",
      ),
      note: t(
        "Реселлерская модель, суб-баланс на нашей стороне",
        "Reseller model, sub-balance on our side",
      ),
    },
    {
      id: "meta",
      label: "Meta Ads",
      description: t(
        "Facebook, Instagram и WhatsApp через Marketing API",
        "Facebook, Instagram & WhatsApp via Marketing API",
      ),
      group: "network",
      status: "available",
      audienceLanding: t(
        "Custom Audiences (SHA-256 сопоставление телефонов)",
        "Custom Audiences (SHA-256 phone matching)",
      ),
      note: t(
        "Оплата за показы (CPM ≈ 300 ₽), агентские кабинеты под Business Manager",
        "Paid per impression (CPM ≈ 300 ₽), agency accounts under Business Manager",
      ),
    },
    {
      id: "google_ads",
      label: "Google Ads",
      description: t(
        "Поиск и медийная сеть через управляющий аккаунт (MCC)",
        "Search & display via manager account (MCC)",
      ),
      group: "network",
      status: "planned",
      audienceLanding: t(
        "Customer Match (хешированные идентификаторы)",
        "Customer Match (hashed identifiers)",
      ),
      note: t(
        "Консолидированный биллинг под MCC",
        "Consolidated billing under MCC",
      ),
    },
  ];
}

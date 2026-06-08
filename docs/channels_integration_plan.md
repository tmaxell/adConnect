# Digital channels in the campaign wizard — display & rollout plan

How to surface external ad networks (Telegram Ads, Meta Ads, Google Ads) inside the
AdConnect campaign builder. Scope of this doc: **display model + phased rollout**.
The integration architecture (adapters, balance, audience landing, moderation) is
defined in `Интеграция_внешних_рекламных_сетей.docx` and only referenced here.

## 1. Principle: one campaign, many destinations

Per the integration doc, AdConnect is a **control plane over an agency/reseller
layer** with a single wallet and a unified campaign format; everything network-
specific lives in adapters. The UI must reflect this: the user assembles **one**
campaign and picks **where** it runs — operator channels (SMS/Email) and/or
external networks — without learning each network's cabinet.

This reframes the wizard's first step from a single-choice "Sending Channel" into a
**multi-select "Channels & networks"** step, grouped by asset type:

- **Operator channels** — SMS, Email. Available now, priced per message, billed
  from the wallet directly.
- **External ad networks** — Telegram Ads, Meta Ads (FB/IG/WhatsApp), Google Ads.
  Display-only today ("Скоро"); each carries an **audience-landing** hint that
  explains how an operator segment reaches it.

Best-practice reference (from the doc's analog review): Smartly/Skai/Revealbot set
the bar for "single window over official network APIs"; МТС Маркетолог shows the
operator pattern of overlaying its own segments onto an external buy (Telegram via
reseller). Our target is the Smartly-level control plane **plus** the agency/wallet
layer.

## 2. What each network card shows (current, display-only)

Already implemented in `frontend/src/components/channels.ts` +
`CampaignWizard.tsx` (channel step):

| Network | Audience landing (segment → network) | Integration note |
|---|---|---|
| Telegram Ads | Channel & topic targeting (no list upload) | Reseller deposit, sub-balances on our side |
| Meta Ads | Custom Audiences (SHA-256 phone match) | Agency cabinets under operator Business Manager |
| Google Ads | Customer Match (hashed identifiers) | Consolidated billing under MCC |

Each card renders: label, description, a **"Скоро"** badge (status `planned`), the
audience-landing line, and the integration model note. Cards are visually de-
emphasized and non-selectable until their adapter ships.

## 3. Display rules that make the multi-network step honest

These derive directly from the integration constraints and should gate the UI as
adapters come online:

1. **Audience-compatibility surfacing.** When the user has a segment, show per
   network whether it lands by *list match* (Meta/Google) or *channel/topic
   targeting* (Telegram). Telegram must not imply list upload — show "подбор
   каналов" instead. Disable list-match networks if the matched segment is below
   the ~1000-profile match-rate floor, with an inline reason.
2. **Match-rate & delay expectations.** For Meta/Google, warn that ~up to 24h
   processing applies and that match rate reduces effective reach — so the
   "fast launch" promise is set correctly.
3. **WhatsApp is not a separate channel.** It appears as a sub-option *inside* Meta
   (Click-to-WhatsApp), never as a top-level card.
4. **Unified budget split.** Once multiple destinations are selectable, the Cost
   step shows one wallet budget with a recommended **split across networks**
   (forecast agent), each line reserving from the same wallet. Per-network minimums
   (e.g. Telegram reseller floors) surface as validation.
5. **Unified moderation status.** The campaign list and confirmation show one
   normalized status ("На модерации / Отклонено / Активна"), with the originating
   network and a plain-language reason behind it. Rejection returns reserved funds
   to the wallet — reflected in the wallet ledger line.
6. **Transparency on money.** Wallet is the single source of truth (RUB); network
   spend is reconciled daily. Any operator markup shows as a separate wallet line.

## 4. Phased rollout

- **Phase 0 (done).** Display-only network cards in the channel step with audience-
  landing hints. Agent builds SMS/Email campaigns end to end. Sets user expectations
  about what's coming.
- **Phase 1 — Meta adapter.** Richest API; agency cabinets under the operator BM,
  Custom Audiences, prepay funding. Turn Meta card selectable; wire segment hashing
  + upload in the operator data layer; add match-rate/delay UI; WhatsApp sub-option.
- **Phase 2 — Google adapter.** MCC + Customer Match + consolidated billing /
  budget orders. Reuse the same hashed-segment service.
- **Phase 3 — Telegram adapter.** Reseller access; channel/topic targeting from the
  operator's audience knowledge (no list upload); sub-balances. The audience step
  switches Telegram to a channel/topic picker fed by the segment.
- **Cross-cutting.** Multi-select channel step, unified budget split (forecast
  agent), status normalization layer, wallet reservation/reconciliation, and the
  verification (pre-moderation) agent running before any network submission.

## 5. Backend contract impact (when adapters land)

`CampaignDraft` gains a `networks: NetworkSelection[]` field alongside the operator
`channel`, where each selection records the network id, its audience-landing mode,
and a per-network budget share. The orchestration layer translates one
`CampaignDraft` into per-adapter payloads; the wizard and wallet never learn network
specifics — exactly the "single internal campaign format" principle from §9.4 of the
integration doc.

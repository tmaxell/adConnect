# WhatsApp Business channel — prototype concept

**Framing.** A **convincing, high-quality-looking prototype** of WhatsApp as a
*separate operator channel* (not the Meta WhatsApp placement) — *not* a real
WhatsApp Business Platform build. Numbers are estimated, nothing is sent, "submit"
only moves the template to *approval* status. This doc covers **the real model we
emulate**, **what we show**, and **how an advertiser is onboarded** through the
aggregator. The real adapter is explicitly out of scope.

There are now **two** WhatsApp surfaces in AdConnect, and they are different
products — see `channels_integration_plan.md` §3.3:

- **Meta → WhatsApp placement** (existing): WhatsApp Status ads / Click-to-WhatsApp,
  bought in the Meta auction (CPM). Lives *inside* the Meta channel.
- **WhatsApp Business** (this doc): an **operator channel** — a marketing **carousel
  broadcast** to opted-in subscribers through a BSP aggregator, priced per delivered
  message, with the operator's **bot** continuing the chat for free.

---

## 1. The reality we're emulating (so the visuals are credible)

### 1.1 Aggregator model — the client connects nothing

You can't reach Meta directly for WhatsApp; you go through a **BSP / Solution
Partner aggregator** (e.g. **Woztell**, Infobip, Twilio, 360dialog). The aggregator
holds the **WABA** (WhatsApp Business Account) + phone number, runs Embedded Signup /
Tech-Provider onboarding, and owns **template approval, business verification,
quality rating and block resolution**. The advertiser links nothing.

This mirrors the Meta agency model exactly. Two sender models under the operator's
WABA via the aggregator:

- **Shared sender** — small advertisers send under the operator's common sender
  **"AdConnect Promo"**.
- **Dedicated sender** — for large advertisers the operator provisions a dedicated
  sender (the advertiser's own display name), still managed by the operator.

### 1.2 Marketing templates & carousel

Outbound marketing is an **approved template** of category `marketing`. A **media-card
carousel** template carries **up to 10 cards**; each card = media (image/video) +
body text + up to **2 buttons** (quick-reply / URL). All cards share the same
structure. Templates are reviewed by Meta before sending (our "moderation").

### 1.3 Pricing — per message, free follow-up

Since July 2025 WhatsApp is billed **per delivered message** by category;
`marketing` is the costliest (~$0.10 ≈ **9 ₽**, our `base_price_per_message`).
Crucially, **opening the conversation is what's billed** — once the user engages,
the business can reply for free inside the **24-hour service window**. So "open the
chat is paid, then the bot talks for free" is real, and is how we frame the cost.

### 1.4 The "bot" — broadcast + light automation, not a builder

"Реклама через бота" is **not** a chatbot the advertiser builds. It is:

1. a **broadcast** of the carousel template (the creative), plus
2. optional **light automation** — a greeting / quick-reply handling that the
   **operator's bot** runs inside the free 24h window.

So the advertiser composes a broadcast and (optionally) a one-line auto-reply; the
flow engine belongs to the operator + aggregator.

### 1.5 Audience — opt-in + WhatsApp coverage

Marketing requires **opt-in**, and not all subscribers are on WhatsApp. The operator
segment is narrowed by a **coverage** factor (on WhatsApp + opted in ≈ 70%,
`CHANNELS["whatsapp"].coverage`) — the WhatsApp analog of Meta's Custom-Audience
match rate.

---

## 2. What we show (and how it's built)

| Surface | Where | Status |
|---|---|---|
| **WhatsApp Business is a first-class operator channel** (selectable, alongside SMS/Email) | channel step | ✓ |
| **Aggregator / "account not required" badge** + **sender** (shared "AdConnect Promo" / dedicated) | audience step | ✓ |
| **Opt-in + WhatsApp coverage** note (≈70% of base) | audience step | ✓ |
| Operator-base audience + extended telecom filters (reused) | audience step | ✓ |
| **Carousel builder** — up to 10 cards (image 1:1, text, up to 2 buttons), "Собрать карусель" (Copilot), per-card generation | creative step | ✓ |
| **Light bot auto-reply** — toggle + greeting | creative step | ✓ |
| **WhatsApp message preview** — operator bot bubble + horizontal carousel | creative step | ✓ |
| **Cost as opened dialogs** (≈9 ₽ each) + free-follow-up note | cost step / reach panel | ✓ |
| **Confirmation** rows (sender, template, cards, bot) + carousel preview | confirmation | ✓ |
| **Template approval** theatre on submit (`template_status` → pending) | submit | ✓ |
| WhatsApp in the campaigns list + analytics (label, colour, "Диалоги") | lists / analytics | ✓ |

Backend: `Channel += "whatsapp"`, `WhatsAppSpec`/`WhatsAppCard`/`WhatsAppButton`
(`schemas.py`); per-message forecast with coverage (`tools/forecast._estimate_whatsapp`);
carousel copy guidance (`tools/creatives`) + 1:1 card image (`tools/creative_gen`);
clickable-canvas patches (`tools/draft_ops._apply_whatsapp_patch`); Copilot
channel/segments/message/cost/summary/submit branches + `_generate_wa_carousel`
(`agents/campaign_builder.py`). The creative endpoints fill a carousel card without
flipping the channel to Meta (`app.py`).

## 3. Where it lives in the flow

`Канал` → **WhatsApp Business** → `Аудитория` (aggregator/sender badge, opt-in,
operator segment) → `Карусель` (cards + bot auto-reply + preview) → `Стоимость`
(budget → opened dialogs at ≈9 ₽) → `Подтверждение` (summary + carousel preview) →
submit → **шаблон на согласовании** (status only).

## 4. Guardrails to keep the demo honest

- Everything labelled **estimate / preview / demo** where it isn't real.
- **Submit changes status only** — no template send, no message, no charge; the
  template goes to "на согласовании".
- The "account not required / via aggregator" claims describe the **target** model;
  the prototype shows the experience, the real adapter is §5.

## 5. Real integration (out of scope — model only)

Not built. For reference, a real adapter would: connect the operator's WABA through
the aggregator (Embedded Signup / partner API); submit the carousel template and poll
its approval; resolve the opted-in audience; broadcast via the Cloud API; consume
delivery/read/reply webhooks; meter per opened conversation against the wallet;
normalise the moderation status. None of this is implemented — we emulate it.

## 6. Sources

- [Media-card carousel templates — Meta](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/media-card-carousel-templates/) ·
  [WhatsApp carousel (charles)](https://www.hello-charles.com/blog/whatsapp-carousel-template)
- [Pricing on the WhatsApp Business Platform — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) ·
  [July 2025 per-message pricing (CleverTap)](https://clevertap.com/blog/whatsapp-business-pricing-changes-in-july-2025/)
- [Embedded Signup — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview) ·
  [Embedded Signup (Infobip)](https://www.infobip.com/docs/whatsapp/get-started/embedded-signup)
- [Connect WABA on Woztell](https://doc.woztell.com/docs/procedures/basic-whatsapp-chatbot-setup/standard-procedures-wa-connect-waba/) ·
  [WhatsApp Business Platform (Woztell)](https://woztell.com/lp-waba/)
- [Broadcast vs chatbot/flow (respond.io)](https://respond.io/blog/best-whatsapp-chatbots) ·
  [WhatsApp chatbot marketing (Conferbot)](https://www.conferbot.com/blog/whatsapp-business-chatbot-marketing)

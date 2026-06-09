# Meta Ads integration — prototype display concept

**Framing.** The goal here is a **convincing, high-quality-looking prototype** of the
Meta integration — *not* a real Marketing-API build. Numbers are estimated, nothing
is sent to Meta, "submit" only changes status. So this doc is mostly about **what we
show and how it feels**, with just enough grounding in the real API/agency model to
read as production-credible. The real adapter is a separate, later effort (§5).

---

## 1. The reality we're emulating (so the visuals are credible)

### 1.1 Agency model — the client connects nothing

The advertiser does **not** link their own Meta account. The operator runs everything
through **its own Business Manager**: a dedicated ad account is provisioned per client
under the operator's BM (two-tier Parent→Child BM), funded from the operator's
consolidated billing / shared credit line and re-billed via the single wallet. The
client keeps only their Page / Instagram / pixel. This is the "agency ad account"
pattern used by white-label platforms (Vendasta, GoHighLevel, AdEspresso agency tier,
DashClicks…) and the direct telecom analog — МТС Маркетолог reselling Telegram Ads.

### 1.2 Can it be automated via API? Yes.

Provisioning and operation are programmatic with a **System User token** under the
operator BM:
- **Create ad accounts** under the business — `POST /{business-id}/adaccount`
  (Business Manager API).
- **Build campaigns** — Campaign (objective) → Ad Set (audience, placements, budget,
  optimization) → Ad (creative) via the Marketing API.
- **Audiences** — upload the operator segment as a **Custom Audience** (SHA-256
  hashed phones), optional **Lookalike**.
- **Analytics** — pull the **Insights API** with breakdowns.

Gating (one-time): **Advanced Access** to `ads_management` + `business_management`,
**Business Verification** and **App Review**. After that it's fully server-to-server.
So a "no account needed, fully automated" experience is technically real — we just
mock it in the prototype.

### 1.3 What the Marketing API gives us (the data behind the visuals)

- **Hierarchy**: Ad Account → Campaign (objective: awareness/traffic/engagement/
  leads/sales) → Ad Set (audience + placements + budget + optimization) → Ad.
- **Insights**: impressions, reach, frequency, clicks, link_clicks, ctr, spend, cpm,
  cpc, conversions/leads, action_values (ROAS), with **breakdowns**:
  `publisher_platform` (facebook/instagram/messenger/audience_network),
  `platform_position` (feed/stories/reels), device, age, gender, region, action_type.
- **Aggregator UX to borrow**: Smartly/Revealbot/Madgicx — single window, normalized
  cross-placement reporting, sensible defaults.

## 2. What sells the prototype (visual checklist)

Every item below is **mock-driven** and either shipped (✓) or a quick next add (▢).

- ✓ **Meta is a first-class channel** in the "Sending Channel" step (selectable,
  alongside SMS/Email; Telegram/Google stay "Скоро").
- ✓ **"Account not required" badge** — a green status line in Meta setup: *"Рекламный
  аккаунт ведётся через кабинет оператора (Business Manager) — подключать свой не
  нужно."* This single line communicates the whole agency model.
- ✓ **Objective** auto-derived from the request (Лиды/Продажи/Трафик…), shown and
  framed as the Campaign objective.
- ✓ **Placements** as branded chips (Facebook / Instagram / Messenger / Audience
  Network) with platform color dots; selected vs off.
- ✓ **Audience landing** line — *"Custom Audience · совпадение ≈ 60% · ≈ N профилей"*
  + a one-click **Lookalike** toggle.
- ✓ **Auction economics** in the side panel — Custom Audience size, **CPM**, expected
  **impressions**, and a **per-platform impression split** with color dots.
- ✓ **Analytics preview** on confirmation — a per-platform table (Платформа / Показы /
  Охват / CTR / CPM / Конверсии) with the note that real data comes from Meta Insights
  (breakdown by platform, placement, demo, geo). This is the strongest "it's real"
  signal; reach is kept < impressions so the numbers read correctly.
- ▢ **Provisioning micro-animation** — a 1–2s "Готовим рекламный аккаунт оператора…"
  → "✓ Аккаунт готов" on first Meta selection (pure UI theatre, sells automation).
- ▢ **Normalized moderation timeline** on submit — *На модерации Meta → Одобрено →
  Активна* chips with timestamps (mocked), reinforcing the unified-status story.
- ▢ **Statistics screen** (sidebar "Statistics") — a mock dashboard with breakdown
  toggles (by platform / placement position / age-gender) and a couple of charts, fed
  by the same `platform_breakdown` shape. The flagship "Madgicx-like one screen".
- ▢ **Creative preview** — render the chosen ad text inside a small FB/IG post mockup
  (avatar, page name, image placeholder, CTA button) for a real-ad feel.
- ▢ **WhatsApp as Click-to-WhatsApp** — show it as a CTA option inside Meta, not a
  separate channel.

## 3. Where it lives in the flow

`Sending Channel` → pick **Meta** → (Meta setup: account badge, objective,
placements, audience+lookalike) → `Segments` (operator audience → Custom Audience) →
`Message` (creative, later with the post preview) → `Cost` (budget; panel shows CPM +
impressions + per-platform split) → `Confirmation` (full summary + analytics preview
+ moderation timeline) → submit (status only).

## 4. Guardrails to keep the demo honest

- Everything labeled as **estimate / preview / demo** where it isn't real.
- **Submit changes status only** — no spend, no network call.
- The "account not required / automated" claims describe the **target** model; the
  prototype shows the experience, the real adapter is §5.

## 5. Real integration (out of scope here, for later)

System User under the operator BM; `POST /{business-id}/adaccount` to provision; create
Campaign/Ad Set/Ad; hash + upload Custom Audience (+ Lookalike); prepaid funding +
wallet reservation/reconciliation; Insights sync (async jobs) into our store for the
Statistics screen; normalized moderation status + reserve return on rejection. Gated by
Advanced Access + Business Verification + App Review.

## 6. Sources

- [Insights API](https://developers.facebook.com/docs/marketing-api/insights/) ·
  [Breakdowns](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/) ·
  [Insights metrics & hierarchy (Ryze)](https://www.get-ryze.ai/blog/meta-ads-api-insights-endpoint-campaigns-impressions-clicks-spend-leads)
- [Create ad account / Business Manager API & Advanced Access (AdManage)](https://admanage.ai/blog/meta-ads-api) ·
  [Custom Audience reference](https://developers.facebook.com/docs/marketing-api/reference/custom-audience/) ·
  [Agency access levels (AdAmigo)](https://www.adamigo.ai/blog/meta-ads-api-access-levels-for-agencies)
- [Agency ad account, how it works (Shopyads)](https://www.shopyads.io/en/blog/meta-agency-ad-account) ·
  [2-tier Business Manager / consolidated billing (AdManage)](https://admanage.ai/blog/how-to-manage-multiple-facebook-ad-accounts) ·
  [White-label Meta platforms (Madgicx)](https://madgicx.com/blog/white-label-meta-ad-platforms)

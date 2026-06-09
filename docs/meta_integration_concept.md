# Meta Ads integration — concept & implementation plan

How AdConnect launches and reports Meta (Facebook / Instagram / Messenger /
WhatsApp / Audience Network) campaigns from its single advertiser cabinet, on top
of the agency layer described in `Интеграция_внешних_рекламных_сетей.docx`. This
doc focuses on **what we surface in the UI** and **how it maps to the Marketing
API**, grounded in how mature aggregators do it.

---

## 1. What the analogs teach us (UX to borrow)

Tools that resell access to Meta through one cabinet are a control plane over the
Marketing API. Patterns worth copying:

- **Revealbot** — bulk editing + a rules engine (rolling averages, cross-metric
  conditions, alerts), strong cross-account reporting. Take: automation rules,
  one-screen reporting across accounts.
- **Madgicx** — AI optimization layer; **one screen with unified ROAS / CPA across
  all accounts**, custom attribution windows, real-time refresh. Take: a single
  analytics surface with normalized KPIs.
- **Smartly.io** — creative templating / dynamic product ads at enterprise scale.
  Take: generate many creative variants from one brief (our creatives agent).
- **AdEspresso** — approachable campaign builder with guided placement/audience
  steps. Take: keep the wizard simple, sensible defaults, explain choices.

Common denominator: the user never opens Meta Ads Manager — they pick objective,
audience, placements, budget and creative once; the platform translates to the API
and shows **normalized, cross-placement reporting**.

## 2. Marketing API — what we use

### 2.1 Object hierarchy (what the wizard builds)

```
Ad Account (act_<id>, under operator Business Manager, agency model)
└─ Campaign        → objective (ODAX: awareness | traffic | engagement | leads | sales)
   └─ Ad Set       → audience (Custom/Lookalike + targeting), placements,
                     budget & schedule, optimization_goal, bid
      └─ Ad        → creative (primary text, headline, media, CTA, link)
```

Our `CampaignDraft` maps onto this: channel+objective → Campaign; segments +
placements + budget → Ad Set; message/creative → Ad.

### 2.2 Audiences (landing the operator segment)

- **Custom Audience** — the operator segment is exported as identifiers (phones),
  **hashed SHA-256 on our side**, uploaded to the client ad account. Created per
  ad account, shareable within the Business. Practical floors: ~1000 matched
  profiles for stable delivery; match rate < 100% (we model ~60%); files > 10k
  rows batch, processing up to ~24h.
- **Lookalike Audience** — built from the Custom Audience as a source (min ~100
  matched per country); created **in the destination account** so it optimizes on
  that account's data. We expose this as a one-click "расширить похожей
  аудиторией" toggle.
- **Permissions / access** — `ads_management`, `ads_read`, `business_management`;
  a **System User** token under the operator Business Manager. Agency model: the
  client adds the operator's Business ID as a **partner** and shares the ad account
  (Manage role); the operator assigns it to its System User and acts on the
  client's behalf. WhatsApp is **Click-to-WhatsApp** — an ordinary Meta ad with a
  WhatsApp CTA, not a separate channel.

### 2.3 Analytics (Insights API)

- One endpoint reports across all placements; query at Account / Campaign / Ad Set
  / Ad level. 70+ metrics: `impressions`, `reach`, `frequency`, `clicks`,
  `link_clicks`, `ctr`, `unique_ctr`, `spend`, `cpm`, `cpc`, `actions` /
  `conversions` / `leads`, `cost_per_action_type`, `action_values` (→ ROAS).
- **Breakdowns** (the key to "разделение по платформам"):
  `publisher_platform` (facebook / instagram / messenger / audience_network),
  `platform_position` (feed / stories / reels / search), `impression_device`,
  `age`, `gender`, `country` / `region`, `action_type`, time. Breakdowns multiply
  rows, so combine deliberately.
- Heavy/large pulls run as **async report jobs** with polling; per-account rate
  limits apply. We sync Insights into our own store and show normalized,
  per-platform reporting — independent of the network.

## 3. UI concept

### 3.1 In the campaign wizard (build-time)

The "Sending Channel" step lets the user pick **Meta Ads**. Choosing it switches
the wizard to the auction model and reveals Meta specifics:

- **Objective** — awareness / traffic / engagement / leads / sales (maps to ODAX
  Campaign objective). Defaulted from the user's goal, editable.
- **Audience** — operator segment → Custom Audience badge with match-rate and the
  ~1000 floor warning; a **Lookalike** toggle to expand reach.
- **Placements** — Facebook / Instagram / Messenger / Audience Network (WhatsApp
  via Click-to-WhatsApp) as selectable chips; "Advantage+ (авто-плейсменты)" as
  the recommended default.
- **Cost** — daily/lifetime **budget** + schedule (no per-message). The reach
  panel shows **Custom Audience size, CPM and expected impressions**, plus a
  **per-platform split** of impressions across the selected placements.
- **Creative** — primary text variants now; headline + media + CTA in Phase 1.

### 3.2 Reporting surface (run-time) — the differentiator

A single "Statistics" view per campaign, fed by Insights, with **breakdown
toggles**: by **platform** (FB/IG/Messenger/AN), by **placement position**
(feed/stories/reels), by age/gender/region. Normalized KPIs (impressions, reach,
frequency, CTR, CPM, CPC, conversions, ROAS) and a plain-language summary from the
analytics agent ("почему вырос CPM на этой неделе"). In the prototype we ship an
**analytics preview** on the confirmation step — the per-platform table the live
report will fill.

### 3.3 Money & status (shared layer)

Single wallet (RUB); on launch we reserve, fund the ad account (prepaid available
funds / spend cap), reconcile actual spend daily from Insights. One normalized
moderation status over Meta's review; rejection returns the reserve.

## 4. Implementation plan (phased)

- **Phase 0.5 — prototype (this change).** Meta is a selectable channel with the
  auction model: objective, placements, lookalike toggle, Custom-Audience framing,
  per-platform impression split, and an analytics preview on confirmation. All
  estimated; submit only changes status. *No real API calls.*
- **Phase 1 — real adapter (write path).** Operator Business Manager + System User
  token; create Campaign/Ad Set/Ad via Marketing API in the client's ad account
  (agency partner model); hash + upload the operator segment as a Custom Audience;
  optional Lookalike; prepaid funding + wallet reservation; map placements to
  `targeting.publisher_platforms` / positions.
- **Phase 2 — analytics (read path).** Insights sync (async jobs) into our store;
  the Statistics view with `publisher_platform` / `platform_position` / demo
  breakdowns; daily spend reconciliation; the analytics agent for NL summaries.
- **Phase 3 — optimization & moderation.** Rules engine (Revealbot-style),
  Advantage+ budget, pre-moderation agent before submit, normalized status +
  reasons, reserve return on rejection.

## 5. What this prototype change ships

- `CampaignDraft.meta` (`MetaSpec`: objective, placements, lookalike,
  optimization_goal) + `platform_breakdown` (per-platform impressions/reach).
- Forecast splits expected impressions across selected Meta placements.
- Builder sets sensible Meta defaults (objective inferred from the goal, placements
  FB+IG), offers a Lookalike toggle, and summarizes objective/placements.
- Wizard: Meta setup block (objective, placement chips, lookalike), per-platform
  breakdown in the reach panel and confirmation, and an **analytics preview** card.

## 6. Sources

- [Meta — Insights API](https://developers.facebook.com/docs/marketing-api/insights/) ·
  [Breakdowns](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/) ·
  [Insights metrics & hierarchy (Ryze)](https://www.get-ryze.ai/blog/meta-ads-api-insights-endpoint-campaigns-impressions-clicks-spend-leads)
- [Custom Audience reference](https://developers.facebook.com/docs/marketing-api/reference/custom-audience/) ·
  [Agency access levels (AdAmigo)](https://www.adamigo.ai/blog/meta-ads-api-access-levels-for-agencies) ·
  [System User / multi-account (Wevion)](https://wevion.ai/en/blog/meta-business-manager-multiple-accounts/)
- [Meta ads automation platforms compared (adlibrary)](https://adlibrary.com/guides/meta-ads-automation-platforms-compared) ·
  [Meta ads builder comparison (adlibrary)](https://adlibrary.com/posts/meta-ads-builder-comparison)

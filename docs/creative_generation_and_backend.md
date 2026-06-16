# Meta creatives + interactive backend

Covers three things requested for the clickable Meta creative flow:
1. **What Meta's API actually offers for creative generation** (research summary).
2. **The interactive backend we built** to make the canvas clickable (not only
   agent-driven) — endpoints, patch-merge, mock media generation.
3. **A scalable production sketch** for that backend (Python / Go), for when this
   moves past prototype.

---

## 1. Does Meta's API generate creatives? (research summary)

**Short answer: there is no arbitrary "text-to-image / text-to-video" endpoint in
the Marketing API.** Meta's generative AI for ads is exposed only as **Advantage+
creative enhancements** applied to an asset *you already uploaded*, and as
**copy/text suggestions** — never as a standalone "give me an image" call.

### 1.1 What exists

| Capability | Where | What it does |
|---|---|---|
| **Text variations** | `creative_features_spec.text_optimizations` / Advantage+ creative | Rewrites / generates primary text & headline variants from your input copy. |
| **Image background generation** | Advantage+ creative (`degrees_of_freedom_spec`) | Generates a new background behind the product/subject of an uploaded image. |
| **Image expansion (outpainting)** | Advantage+ creative | Extends an uploaded image to fit additional placements/ratios (e.g. 1:1 → 9:16). |
| **Image → video animation** | Advantage+ creative | Animates a still into a short video. |
| **Music / overlays / brightness** | Advantage+ creative | Auto enhancements at delivery. |

These are **opt-in flags on the ad creative**, e.g.:

```jsonc
// POST /act_{ad-account}/adcreatives
{
  "object_story_spec": { /* page, link, uploaded image_hash / video_id */ },
  "degrees_of_freedom_spec": {
    "creative_features_spec": {
      "image_background_gen":   { "enroll_status": "OPT_IN" },
      "image_uncrop":           { "enroll_status": "OPT_IN" },  // expansion
      "text_optimizations":     { "enroll_status": "OPT_IN" },
      "image_animation":        { "enroll_status": "OPT_IN" }   // image→video
    }
  }
}
```

You still **upload the base asset** (`POST /act_{id}/adimages` → `image_hash`, or
`/advideos` → `video_id`). The AI only *enhances* it, and enhancements are realised
at delivery time / preview, not returned as a file you can grab.

### 1.2 Implication for us

For a visual-first prototype we therefore **mock generation** (synthesise a branded
placeholder sized to the placement) and do **real uploads**. A future real adapter
would: upload the user's asset → create the ad creative with the relevant
`creative_features_spec` opt-ins → pull the **Ad Preview** (`/generatepreviews`) to
show the enhanced result. See `meta_integration_concept.md` §5 for the adapter plan.

### 1.3 Formats by placement (drives the format picker)

| Placement | Formats | Ratio | Media |
|---|---|---|---|
| Facebook / Instagram **Feed** | Лента | 1:1 (or 4:5) | image / video / carousel |
| Stories | Истории | 9:16 | image / video |
| Reels | Reels | 9:16 | video |
| **WhatsApp** | WhatsApp | 9:16 | image / video (Status ads, see §1.4) |

Unified Stories/Reels **safe zone** since Mar 2026: keep text/logo within ~14% top /
35% bottom / 6% sides. The canvas exposes exactly these as the format options
(`availableFormats(placements)` in `CampaignWizard.tsx`, mirrored by
`_available_formats` in `campaign_builder.py`).

### 1.4 Advertising in WhatsApp — two ways, both supported

There are **two** ways to advertise "in WhatsApp", and we surface both:

1. **WhatsApp Status ads (a real placement).** Launched June 2025, ads appear in the
   **Updates tab** between full-screen Status updates — WhatsApp's Stories analog.
   Format is **9:16**, single image or video (≤30s), ephemeral (24h). In Ads Manager
   you pick the **Messages** objective, link the WhatsApp account, and select the
   **WhatsApp / Status placement** under placements. Requires the WhatsApp Business
   Platform (API). → modelled as the `whatsapp` **placement**.
2. **Click-to-WhatsApp (CTWA).** An ad on FB/IG/Messenger whose CTA opens a WhatsApp
   **chat** with the business (a *destination*, not a placement). Strong for SMB lead
   gen; "Cost per Conversation" is the key metric. → modelled as the `whatsapp`
   **creative format** (9:16) + the "Написать в WhatsApp" CTA.

In the prototype WhatsApp is therefore a first-class **placement** (chip with logo,
share in the platform breakdown, in confirmation) and the WhatsApp creative format
(9:16) becomes available when that placement is selected.

Sources:
- [Meta expands WhatsApp Status ad options — Search Engine Land](https://searchengineland.com/meta-expands-whatsapp-status-ad-options-462076)
- [Meta Expands WhatsApp Status Ad Options — Social Media Today](https://www.socialmediatoday.com/news/meta-adds-whatsapp-click-to-message-whatsapp-status-ads/760186/)
- [Meta Launches Ads on WhatsApp: Status and Channels (2025) — The Bridge Chronicle](https://www.thebridgechronicle.com/tech/meta-whatsapp-ads-rollout-status-channels-2025)

---

### 1.5 Audience model (Ad Set) — what we surface

Meta's ad-set targeting has **four** methods (Core/detailed, Custom, Lookalike,
Advantage+) which Ads Manager now presents as **two top-level modes**:

- **Advantage+ Audience** (default) — AI finds buyers; your inputs are *suggestions*
  (age, gender, detailed targeting, custom/lookalike), with a few *hard controls*
  (location, min age, exclusions). 2025-26 best practice: feed a customer list as a
  Custom Audience seed and let Advantage+ expand it (it does lookalike modelling
  internally).
- **Manual** — you control Core/Custom/Lookalike directly.

The reworked audience screen mirrors this with **operator data = the Custom Audience
seed**:
- **Цель кампании** — the 5 relevant ODAX objectives as cards (icon + description).
- **Метод подбора** — Advantage+ ↔ Ручная segmented control + an **audience-size
  gauge** (Точная ↔ Широкая, like Meta's audience-definition needle).
- **Источник** — Custom Audience (operator data, ~60% match) + **Lookalike** with a
  1–10% slider (closer ↔ broader) in manual mode; built into Advantage+ otherwise.
- **Локации** — kept first and tagged a *hard control* (applies even under Advantage+).
- **Возраст / пол / детальный таргетинг** — labelled "подсказка для ИИ" under Advantage+.
- **Плейсменты** — Advantage+ placements (auto) toggle vs manual chips.

Backend: `MetaSpec.audience_mode` / `lookalike_pct` / `advantage_placements`;
`forecast._audience_multiplier` widens reach (Advantage+ ×1.7; Lookalike ×(1+0.3·%));
`platform_breakdown` spans all platforms under Advantage+ placements.

## 2. The interactive backend (what we built)

The canvas was read-only (the agent drove everything via `/api/chat`). To let the
user **build a campaign by clicking**, the canvas now mutates the *same*
`campaign_draft` artifact through small REST calls. Agent and canvas share one source
of truth, so they stay in sync.

### 2.1 Endpoints (`backend/app.py`)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/sessions/{id}/draft` | Current draft (creates none). |
| `PATCH`| `/api/sessions/{id}/draft` | Apply a `{patch:{…}}` → merge, recompute forecast, persist, return draft. |
| `POST` | `/api/sessions/{id}/creative/generate` | Mock-generate an image/video for a format → returns asset URL + draft. |
| `POST` | `/api/sessions/{id}/creative/upload` | Real `multipart` upload (image/video, ≤25 MB) → attaches to the draft. |
| `GET`  | `/api/uploads/{file}` | Static mount serving generated/uploaded assets. |

`/api/uploads` is mounted **under `/api`** on purpose: both the Vite dev proxy and
the nginx `/api → backend` rule forward it unchanged, so asset URLs work in dev and
in Docker without extra config.

### 2.2 Patch merge (`backend/tools/draft_ops.py`)

`apply_patch(draft, patch)` is a small, whitelisted reducer — each key maps to one
field with validation, unknown keys ignored. Keys: `channel`, `objective`,
`lookalike`, `demographics`, `toggle_placement`/`placements`, `geography_add`/
`geography_remove`/`geography`, `age`, `interests`, `format`, `media`, `headline`,
`message_text`, `sender`, `budget`, `messages_count`. Geo/interests are canonicalised
through the same `tools/brief._canon_list_item` the agent uses (so `"Moscow"` and
`"Москва"` don't both land in the list). After every patch the API re-runs
`apply_forecast` and recomputes `step`, exactly like an agent turn.

### 2.3 Mock media (`backend/tools/creative_gen.py`)

`save_generated(...)` renders a branded gradient **SVG** sized to the format
(feed 1080×1080, stories/reels 1080×1920), writes it under `data/uploads/`, and
returns `/api/uploads/<uuid>.svg`. `media_type="video"` adds a play affordance.
A free-text **generation prompt** (`MetaCreative.prompt`, sent to `/creative/generate`)
drives the rendered visual and seeds the placeholder, so distinct briefs yield
distinct mock images — standing in for a real text-to-image call.
Generated "video" is still an SVG placeholder, so the frontend renders generated
assets as `<img>` and only real uploaded video files (`.mp4/.webm/…`) as `<video>`
(`isVideoFile()` in `CampaignWizard.tsx`).

### 2.4 Frontend wiring

- `chatApi.ts`: `patchDraft` / `generateCreative` / `uploadCreative`.
- Store: `updateDraft` / `generateCreative` / `uploadCreative` upsert the returned
  draft as the latest `campaign_draft` artifact so the wizard re-renders instantly.
- `draftRev` counter: bumps only on **agent/session-driven** draft changes, so the
  view follows the agent but is **not** yanked off the step the user is editing.

---

## 3. Scalable production backend (sketch)

The prototype backend (FastAPI + SQLite, single process) is correct but not the
shape you'd ship the clickable builder on. Target: a **stateless API behind a load
balancer**, with the draft as the shared state and media on object storage.

### 3.1 Recommended stack

**Python — FastAPI + async SQLAlchemy + Postgres** (what we already use, scaled out)
is the pragmatic choice: same language as the agent code, async I/O fits the
LLM/Meta-API call pattern, and the team already maintains it. **Go (chi/echo +
pgx)** is the alternative if the draft service must be a tiny, very high-RPS,
allocation-light core decoupled from the Python agents — at the cost of duplicating
the `CampaignDraft` model in two languages. **Recommendation: stay on Python**; reach
for Go only if/when the draft service becomes a measured hot path.

### 3.2 Shape

```
            ┌─────────── Load balancer (TLS) ───────────┐
            │                                            │
     ┌──────▼──────┐   ┌──────────────┐         ┌────────▼────────┐
     │ API (N pods)│──▶│  Postgres    │         │  Object store   │
     │ FastAPI,    │   │  (drafts,    │         │  (S3/GCS):      │
     │ stateless   │   │  sessions)   │         │  creatives,     │
     └──┬───────┬──┘   └──────┬───────┘         │  uploads        │
        │       │             │                 └─────────────────┘
   ┌────▼───┐ ┌─▼─────────┐ ┌─▼────────┐
   │ Redis  │ │ Job queue │ │ LLM /    │
   │ (cache,│ │ (Celery/  │ │ Meta API │
   │  locks)│ │  RQ/arq)  │ │ adapters │
   └────────┘ └───────────┘ └──────────┘
```

### 3.3 Key decisions

- **Stateless API, state in Postgres.** Drafts move from the artifact table to a
  first-class `campaign_drafts` row (JSONB column for the `CampaignDraft`, plus a few
  indexed columns: session_id, status, channel). Any pod can serve any request.
- **Concurrency on a draft.** The agent and the canvas can both write. Use optimistic
  concurrency: a `version` (or `updated_at`) column, `PATCH` does
  compare-and-swap, 409 → client refetches and reapplies. Cheaper than row locks and
  fine for one-user-per-draft.
- **Media → object storage + CDN.** Real uploads go to S3/GCS via **pre-signed PUT
  URLs** (browser uploads directly, API never proxies bytes); validate
  type/size/dimensions; virus-scan async. Generated/enhanced assets likewise. Serve
  via CDN, not the app. (Prototype's local `data/uploads/` is the stand-in.)
- **Real creative generation is slow → make it async.** Upload + Advantage+ creative
  + ad-preview render is multi-second and rate-limited. Run it on a **job queue**
  (arq/Celery), return a job id, stream status (SSE/WebSocket) to the canvas — never
  block the request thread. Same pattern for LLM text generation under load.
- **Resilience to Meta.** All Meta calls go through one adapter with token rotation
  (System User token per operator BM), **rate-limit handling** (respect
  `X-Business-Use-Case-Usage`, backoff), idempotency keys on writes, and a circuit
  breaker. Cache audience-size/insights lookups in Redis.
- **Observability & cost.** Structured request logs + traces (OpenTelemetry); track
  LLM tokens and Meta API call budgets per session.

### 3.4 Migration path from the prototype

1. Swap SQLite → Postgres (async SQLAlchemy already supports it; `asyncpg` is in
   `requirements.txt`). 2. Promote the draft to its own table with `version`. 3. Move
   `data/uploads` → object storage + pre-signed URLs. 4. Put generation behind a
   queue. None of these change the public API contract the canvas already speaks, so
   the frontend is unaffected.

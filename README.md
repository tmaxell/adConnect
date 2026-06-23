# Eastwind AdConnect — AI features prototype

Prototype of the AdConnect AI features: a floating chat widget over the product UI,
backed by a multi-agent system whose flagship **campaign-builder agent** assembles a
full advertising campaign from a natural-language request (brief & objective →
channel → audience → creatives → budget → confirmation). A reusable **business
profile** pre-fills each brief; audiences can be **saved and reused**; the operator
audience supports extended telecom filters (tariff, ARPU, device, triggers…); and
offers/creatives are generated from the full context (product, company, offer,
objective, audience). A second **analyst agent** reports campaign
performance and recommends fixes — the same data powers the **Analytics** page and
the Copilot reports (one backend source, `tools/analytics.py`).

```
frontend/   Vite + React widget + AdConnect product canvas (live campaign wizard)
backend/    FastAPI multi-agent backend (supervisor → agents, /api/chat)
docs/        product & integration analysis
screens/     Figma screen exports
```

## Run with Docker (full stack)

```bash
docker compose up --build
# open http://localhost:8080   (frontend; /api is proxied to the backend)
```

The backend runs in **deterministic mode** without an LLM key. To enable the LLM,
create `backend/.env` from `backend/.env.example` and add a provider key — compose
loads it automatically.

> **After changing code, always rebuild** — `docker compose up -d` (without
> `--build`) reuses the existing images, so the UI/API can look stale:
> ```bash
> docker compose up -d --build            # rebuild both
> docker compose up -d --build frontend   # rebuild just the frontend
> ```
> Asset filenames are content-hashed, so a normal browser refresh of
> `http://localhost:8080` picks up the new build (no hard-reload needed).

## Run locally (dev)

```bash
# backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && uvicorn app:app --reload --port 8000

# frontend (separate shell)
cd frontend && npm install && npm run dev   # http://localhost:5173 (proxies /api → :8000)
```

## Test

```bash
cd backend && source .venv/bin/activate && pytest    # 63 tests
```

## Try it (SMB scenarios)

The agent is tuned for general small-business advertisers. Example prompts:

- "Создай SMS-кампанию для моего фитнес-клуба, чтобы привлечь новых клиентов"
- "Подбери аудиторию для службы доставки готовой еды"
- "Собери кампанию по продвижению автосервиса"
- "Покажи отчёт по кампаниям" / "Как идёт кампания …? что улучшить?"

As you converse, the product canvas fills the campaign wizard live, step by step.

The canvas is also **fully clickable** — you can build a campaign without the copilot:
pick a channel, toggle placements, edit the audience, and on the Meta **creative**
step choose a placement format (Лента / Истории / Reels / Click-to-WhatsApp) and
generate or upload an image/video, with a live ad preview. The canvas and the agent
edit the same draft. See `docs/creative_generation_and_backend.md` for the Meta
creative-API research, the interactive endpoints, and the production-scaling sketch.

Operator channels are **SMS**, **Email** and **WhatsApp Business** — a carousel
broadcast through a BSP aggregator (Woztell-style) under the operator's account,
priced per opened dialog with the operator bot continuing the chat for free. It has
its own creative step (a carousel of up to 10 cards) built by analogy with Meta; see
`docs/whatsapp_channel_plan.md`.

The **Statistics** screen is an analytics dashboard: account-level KPIs (spend,
impressions, CTR, results, cost per result), a 14-day trend chart, a per-platform
split and a per-campaign table; drill into a campaign for its metrics, ROAS and
recommendations, with a button to get Copilot's fix suggestions. The metrics follow
Meta's Insights set and are derived deterministically from the stored campaigns by
`tools/analytics.py` — the single source shared by the page and the chat reports.

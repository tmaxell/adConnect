# Eastwind AdConnect — AI features prototype

Prototype of the AdConnect AI features: a floating chat widget over the product UI,
backed by a multi-agent system whose flagship **campaign-builder agent** assembles a
full advertising campaign from a natural-language request (channel → audience →
creatives → budget → confirmation).

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
cd backend && source .venv/bin/activate && pytest    # 26 tests
```

## Try it (SMB scenarios)

The agent is tuned for general small-business advertisers. Example prompts:

- "Создай SMS-кампанию для моего фитнес-клуба, чтобы привлечь новых клиентов"
- "Подбери аудиторию для службы доставки готовой еды"
- "Собери кампанию по продвижению автосервиса"

As you converse, the product canvas fills the campaign wizard live, step by step.

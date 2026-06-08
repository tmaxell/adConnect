# AdConnect — agent backend

Multi-agent backend for the **Eastwind AdConnect** AI features. Conceptually mirrors
`cvm-agents`: an LLM-based supervisor routes a user message to specialized agents
through a single `/api/chat` endpoint, persisting sessions, runs (trace) and
artifacts.

The flagship is the **campaign-builder agent** — it interviews the user, proposes an
audience, generates creatives and assembles a complete AdConnect campaign draft,
following the product's 5-step wizard (Sending Channel → Segments → Message → Cost →
Confirmation). It never launches or spends without explicit confirmation
(human-in-the-loop), per the AI-initiatives guardrails.

## Architecture

```
app.py            FastAPI — /api/chat, /api/sessions  (same contract as cvm-agents)
  └─ supervisor   action dispatch + intent routing + sticky multi-turn context
       ├─ intent.py            LLM-first intent classifier (rules + few-shot)
       ├─ campaign_builder.py  flagship — wizard state machine, slot filling
       └─ docs_qa.py           documentation Q&A (minimal)
tools/
  catalog.py      operator segment catalog, channels, geo, interests, demographics
  forecast.py     audience reach + price-per-message + total cost estimate
  creatives.py    LLM creative generation (SMS/Email) with deterministic fallback
  brief.py        LLM brief extraction → merges user turns into a CampaignDraft
llm.py            provider-agnostic LLM factory (gemini/groq/gigachat/ollama/anthropic)
db.py             async ChatStore (SQLite by default, Postgres via DATABASE_URL)
models.py         SQLAlchemy ORM (sessions, messages, runs, events, artifacts)
schemas.py        Pydantic contracts (ChatAction/Artifact/Trace + CampaignDraft)
```

The artifact the builder emits — `campaign_draft` — is the contract the frontend
canvas renders (the 5-step wizard, pre-filled).

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add an LLM key (or leave empty for deterministic mode)
uvicorn app:app --reload --port 8000
```

Without an LLM key the agent still runs in a deterministic slot-filling mode
(keyword extraction + catalog matching), so the flow is testable offline.

```bash
pytest                        # unit tests for brief, forecast, builder state machine
```

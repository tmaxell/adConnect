"""AdConnect agents — FastAPI backend for the unified chat widget.

Endpoints (same contract as cvm-agents, so the existing frontend works unchanged):
  GET  /api/health
  GET  /api/sessions
  POST /api/sessions
  GET  /api/sessions/{id}
  GET  /api/sessions/{id}/messages
  POST /api/chat            — single entry point into the multi-agent supervisor
"""

from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agents.base import AgentContext
from agents.supervisor import handle as supervisor_handle
from db import ChatStore, init_db
from schemas import ChatAction, ChatArtifact, ChatTraceEvent

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

store = ChatStore()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="AdConnect Agents API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / response schemas ────────────────────────────────────────────────

class SessionCreateRequest(BaseModel):
    title: str | None = None


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str = ""
    action: ChatAction | None = None


class ChatResponse(BaseModel):
    assistant_message: str
    trace: list[ChatTraceEvent] = Field(default_factory=list)
    artifacts: list[ChatArtifact] = Field(default_factory=list)
    actions_available: list[ChatAction] = Field(default_factory=list)
    session_id: str


# ── Health & sessions ─────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": app.version}


@app.get("/api/sessions")
async def list_sessions():
    return await store.list_sessions()


@app.post("/api/sessions")
async def create_session(request: SessionCreateRequest):
    return await store.ensure_session(title=request.title)


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    detail = await store.get_session_with_messages(session_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return detail


@app.get("/api/sessions/{session_id}/messages")
async def list_session_messages(session_id: str):
    detail = await store.get_session(session_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = await store.list_messages(session_id)
    return {"messages": messages, "next_cursor": None, "has_more": False}


# ── Campaigns ─────────────────────────────────────────────────────────────────

@app.get("/api/campaigns")
async def list_campaigns():
    """Campaigns assembled by the agent — backs the Ad Campaigns list."""
    return await store.list_campaigns()


# ── Unified chat — supervisor entry point ─────────────────────────────────────

@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    session = await store.ensure_session(session_id=request.session_id or None)
    session_id = session["id"]
    if request.message:
        await store.add_message(session_id=session_id, role="user", content=request.message)
    run_id = await store.create_run(
        session_id=session_id,
        user_message=request.message or f"action:{request.action.id if request.action else 'noop'}",
    )
    await store.add_event(run_id=run_id, event="route_selected", detail="POST /api/chat")

    history = await store.list_messages(session_id)
    artifacts = await store.list_artifacts(session_id=session_id)

    ctx = AgentContext(
        session_id=session_id,
        run_id=run_id,
        store=store,
        message=request.message or "",
        history=history,
        action=request.action,
        artifacts=artifacts,
    )

    try:
        result = await supervisor_handle(ctx)
        await store.add_event(
            run_id=run_id, event="run_completed",
            status="info" if result.status != "error" else "warning",
            detail=f"status={result.status}",
        )
        await store.complete_run(
            run_id=run_id,
            status="completed" if result.status != "error" else "failed",
            intent=str(ctx.inputs.get("action_id") or ctx.inputs.get("entry") or "auto"),
        )
    except Exception as exc:
        logger.exception("/api/chat supervisor crashed")
        await store.add_event(run_id=run_id, event="run_failed", status="error", detail=str(exc)[:300])
        await store.complete_run(run_id=run_id, status="failed", intent="crash")
        message = f"Не удалось обработать запрос: {str(exc)[:200]}"
        await store.add_message(session_id=session_id, role="assistant", content=message,
                                metadata={"run_id": run_id, "error": True})
        trace = await store.list_events(run_id=run_id)
        return ChatResponse(assistant_message=message, trace=trace, artifacts=[],
                            actions_available=[], session_id=session_id)

    trace = await store.list_events(run_id=run_id)
    await store.add_message(
        session_id=session_id,
        role="assistant",
        content=result.assistant_message,
        metadata={
            "run_id": run_id,
            "actions": [a.model_dump() for a in result.actions],
            "artifact_ids": [a.get("id") for a in result.artifacts if isinstance(a, dict)],
            "agent_meta": {k: v for k, v in (result.metadata or {}).items()},
        },
    )

    return ChatResponse(
        assistant_message=result.assistant_message,
        trace=trace,
        artifacts=[ChatArtifact(**_artifact_response(a)) for a in result.artifacts if isinstance(a, dict)],
        actions_available=result.actions,
        session_id=session_id,
    )


def _artifact_response(artifact: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": artifact.get("id", ""),
        "type": artifact.get("type", "unknown"),
        "title": None,
        "content": artifact.get("content"),
        "url": None,
        "metadata": artifact.get("metadata") or {},
    }

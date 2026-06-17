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

from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env by absolute path so it works regardless of the process cwd
# (uvicorn, docker, tests). override=False keeps real env vars (e.g. docker
# env_file / compose) authoritative when both are present.
load_dotenv(Path(__file__).resolve().parent / ".env", override=False)

import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agents.base import AgentContext
from agents.supervisor import handle as supervisor_handle
from db import ChatStore, init_db
from schemas import CampaignDraft, ChatAction, ChatArtifact, ChatTraceEvent
from tools import analytics, creative_gen, creatives as creatives_tool, naming
from tools.draft_ops import apply_patch
from tools.forecast import apply_forecast

# Generated/uploaded creatives live here and are served under /api/uploads so the
# Vite dev proxy and the nginx /api → backend rule both reach them unchanged.
UPLOADS_DIR = Path(__file__).resolve().parent / "data" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

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
app.mount("/api/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


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


# ── Analytics ─────────────────────────────────────────────────────────────────
# One source of truth (tools/analytics) serves both this page and the Copilot
# reporting agent, so figures and recommendations match everywhere.

@app.get("/api/analytics")
async def analytics_summary():
    """Account-level summary across all campaigns (KPIs, series, per-campaign rows)."""
    campaigns = await store.list_campaigns_full()
    return analytics.account_summary(campaigns).model_dump(mode="json")


@app.get("/api/analytics/{campaign_id}")
async def analytics_campaign(campaign_id: int):
    """Detailed performance + recommendations for one campaign."""
    campaign = await store.get_campaign(campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return analytics.campaign_metrics(campaign).model_dump(mode="json")


@app.post("/api/analytics/{campaign_id}/advice")
async def analytics_advice(campaign_id: int):
    """AI fix suggestions for a campaign — rule findings, phrased by the LLM."""
    campaign = await store.get_campaign(campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    metrics = analytics.campaign_metrics(campaign)
    advice = await analytics.advice_text(metrics)
    return {
        "campaign_id": campaign_id,
        "advice": advice,
        "recommendations": [r.model_dump() for r in metrics.recommendations],
    }


# ── Interactive draft (clickable canvas) ──────────────────────────────────────
# The canvas mutates the same `campaign_draft` artifact as the chat agent, so the
# user can build a campaign by clicking — not only by talking to the copilot.

class DraftPatchRequest(BaseModel):
    patch: dict[str, Any] = Field(default_factory=dict)


class CreativeGenerateRequest(BaseModel):
    format: str = "feed"
    media_type: str = "image"       # "image" | "video"
    headline: str | None = None
    prompt: str | None = None       # free-text generation brief
    brand: str | None = None


class CopyGenerateRequest(BaseModel):
    tone: str | None = None         # selling | friendly | business | short
    brief: str | None = None        # what to advertise (overrides product/goal)
    n: int = 3


async def _load_latest_draft(session_id: str) -> CampaignDraft:
    artifacts = await store.list_artifacts(session_id=session_id)
    drafts = [a for a in artifacts if a.get("type") == "campaign_draft"]
    if drafts and isinstance(drafts[-1].get("content"), dict):
        try:
            return CampaignDraft.model_validate(drafts[-1]["content"])
        except Exception:  # pragma: no cover - defensive
            logger.warning("PATCH draft: stale artifact, starting fresh")
    return CampaignDraft()


async def _recompute_and_save(session_id: str, draft: CampaignDraft) -> dict[str, Any]:
    apply_forecast(draft)
    if draft.status != "submitted":
        draft.step = draft.current_step()
    if draft.step == "confirmation" and not draft.name:
        draft.name = await naming.generate_campaign_name(
            draft.product, draft.goal,
            channel=draft.channel, audience=draft.segments.matched_segment_name,
        )
    content = draft.model_dump(mode="json")
    await store.save_artifact(session_id=session_id, artifact_type="campaign_draft", content_json=content)
    return content


@app.get("/api/sessions/{session_id}/draft")
async def get_draft(session_id: str):
    if await store.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    draft = await _load_latest_draft(session_id)
    return {"draft": draft.model_dump(mode="json")}


@app.patch("/api/sessions/{session_id}/draft")
async def patch_draft(session_id: str, request: DraftPatchRequest):
    """Apply a small patch from a canvas click → merge, recompute forecast, persist."""
    if await store.ensure_session(session_id=session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    draft = await _load_latest_draft(session_id)
    apply_patch(draft, request.patch)
    content = await _recompute_and_save(session_id, draft)
    return {"draft": content}


@app.post("/api/sessions/{session_id}/creative/generate")
async def generate_creative(session_id: str, request: CreativeGenerateRequest):
    """Mock creative generation — synthesise a branded placeholder for the format."""
    if await store.ensure_session(session_id=session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    draft = await _load_latest_draft(session_id)
    headline = request.headline or draft.message.text or draft.goal
    prompt = (request.prompt or "").strip() or None
    # The generated visual reflects the prompt when given (else the ad copy); the
    # prompt also seeds the placeholder so distinct briefs yield distinct images.
    image_text = prompt or headline
    seed = abs(hash(prompt)) % 997 if prompt else len(await store.list_artifacts(session_id=session_id))
    url = creative_gen.save_generated(
        fmt=request.format, media_type=request.media_type,
        headline=image_text, brand=request.brand or draft.product, seed=seed,
    )

    draft.channel = "meta"
    draft.meta.creative.format = request.format  # type: ignore[assignment]
    draft.meta.creative.media_type = request.media_type  # type: ignore[assignment]
    draft.meta.creative.media_url = url
    draft.meta.creative.media_source = "generated"
    draft.meta.creative.prompt = prompt
    if headline:
        draft.meta.creative.headline = headline
    content = await _recompute_and_save(session_id, draft)
    return {"url": url, "media_type": request.media_type, "draft": content}


@app.post("/api/sessions/{session_id}/creative/copy")
async def generate_copy(session_id: str, request: CopyGenerateRequest):
    """Generate ad-copy variants for the creative step (tone-aware), on the page."""
    if await store.ensure_session(session_id=session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    draft = await _load_latest_draft(session_id)
    brief = (request.brief or "").strip() or None
    audience = draft.segments.matched_segment_name or ", ".join(draft.segments.interests)
    variants = await creatives_tool.generate_creatives(
        product=brief or draft.product, goal=draft.goal, channel=draft.channel or "meta",
        audience=audience, n=max(1, min(5, request.n)), tone=request.tone,
    )
    draft.message.variants = variants
    if brief and not draft.product:
        draft.product = brief
    content = await _recompute_and_save(session_id, draft)
    return {"variants": variants, "draft": content}


@app.post("/api/sessions/{session_id}/creative/upload")
async def upload_creative(session_id: str, file: UploadFile = File(...)):
    """Real upload — store the asset and attach it to the draft's Meta creative."""
    if await store.ensure_session(session_id=session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    ctype = (file.content_type or "").lower()
    media_type = "video" if ctype.startswith("video") else "image"
    if not (ctype.startswith("image") or ctype.startswith("video")):
        raise HTTPException(status_code=415, detail="Only image or video files are accepted")
    suffix = Path(file.filename or "").suffix.lower()[:8] or (".mp4" if media_type == "video" else ".png")
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 25 MB)")
    name = f"{uuid.uuid4().hex}{suffix}"
    (UPLOADS_DIR / name).write_bytes(data)
    url = f"/api/uploads/{name}"

    draft = await _load_latest_draft(session_id)
    draft.channel = "meta"
    draft.meta.creative.media_type = media_type  # type: ignore[assignment]
    draft.meta.creative.media_url = url
    draft.meta.creative.media_source = "upload"
    content = await _recompute_and_save(session_id, draft)
    return {"url": url, "media_type": media_type, "draft": content}


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

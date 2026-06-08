"""Shared test fixtures: an in-memory store and a multi-turn conversation driver.

The driver replays the app's /api/chat loop against the real supervisor without a
database — enough to exercise the campaign-building state machine end to end.
LLM calls are not configured in tests, so the agents fall back to their
deterministic paths.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from agents.base import AgentContext, AgentResult
from agents.supervisor import handle as supervisor_handle
from schemas import ChatAction


class FakeStore:
    """Minimal ChatStore stand-in — only what agents/supervisor touch."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self.artifacts: dict[str, list[dict[str, Any]]] = {}

    async def add_event(self, **kwargs: Any) -> None:
        self.events.append(kwargs)

    async def save_artifact(
        self,
        *,
        session_id: str,
        artifact_type: str,
        content_json: dict[str, Any] | None,
        source_run_id: str | None = None,
        metadata_json: dict[str, Any] | None = None,
        schema_version: int = 1,
    ) -> str:
        art_id = str(uuid4())
        self.artifacts.setdefault(session_id, []).append(
            {"id": art_id, "type": artifact_type, "content": content_json}
        )
        return art_id


class Conversation:
    """Drives a multi-turn dialogue, threading history + artifacts like the app does."""

    def __init__(self, session_id: str = "s1") -> None:
        self.session_id = session_id
        self.store = FakeStore()
        self.history: list[dict[str, Any]] = []

    async def send(self, message: str = "", action: ChatAction | None = None) -> AgentResult:
        if message:
            self.history.append({"role": "user", "content": message})
        ctx = AgentContext(
            session_id=self.session_id,
            run_id=str(uuid4()),
            store=self.store,
            message=message,
            history=list(self.history),
            action=action,
            artifacts=list(self.store.artifacts.get(self.session_id, [])),
        )
        result = await supervisor_handle(ctx)
        # Emulate the app persisting the assistant reply with its agent_meta.
        self.history.append({
            "role": "assistant",
            "content": result.assistant_message,
            "metadata": {"agent_meta": dict(result.metadata or {})},
        })
        return result

    @property
    def draft(self) -> dict[str, Any] | None:
        arts = self.store.artifacts.get(self.session_id, [])
        for a in reversed(arts):
            if a["type"] == "campaign_draft":
                return a["content"]
        return None


@pytest.fixture
def convo() -> Conversation:
    return Conversation()


def action(action_id: str, **payload: Any) -> ChatAction:
    return ChatAction(id=action_id, label=action_id, payload=payload)

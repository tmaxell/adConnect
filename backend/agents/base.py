"""Shared types and protocol for the AdConnect multi-agent system.

- AgentContext   — what an agent knows (session, history, message, action, store).
- AgentResult    — what an agent returns to the supervisor.
- AgentProtocol  — the single execute() interface.
- Plan/PlanStep  — an execution plan (one or more steps).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, Protocol, TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from db import ChatStore
    from schemas import ChatAction

logger = logging.getLogger(__name__)


IntentName = Literal[
    "build_campaign",
    "suggest_segments",
    "generate_creatives",
    "documentation_qa",
]


@dataclass(slots=True)
class AgentContext:
    """Full context of one /api/chat request, passed to an agent."""
    session_id: str
    run_id: str
    store: "ChatStore"
    message: str
    history: list[dict[str, Any]] = field(default_factory=list)
    action: "ChatAction | None" = None
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    inputs: dict[str, Any] = field(default_factory=dict)

    def latest_artifact(self, *types: str) -> dict[str, Any] | None:
        for artifact in reversed(self.artifacts):
            if not types or artifact.get("type") in types:
                return artifact
        return None

    async def emit(
        self,
        event: str,
        *,
        status: str = "info",
        detail: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.store.add_event(
            run_id=self.run_id, event=event, status=status, detail=detail, metadata=metadata or {},
        )


@dataclass(slots=True)
class AgentResult:
    """What an agent returns to the supervisor."""
    assistant_message: str = ""
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    actions: list["ChatAction"] = field(default_factory=list)
    status: Literal["ok", "error", "needs_input"] = "ok"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class PlanStep:
    agent: str
    description: str
    inputs: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class Plan:
    intent: IntentName
    steps: list[PlanStep]
    summary: str = ""


class AgentProtocol(Protocol):
    name: str
    description: str
    supported_intents: tuple[IntentName, ...]

    async def execute(self, context: AgentContext) -> AgentResult: ...


AgentFn = Callable[[AgentContext], Awaitable[AgentResult]]


@dataclass(slots=True)
class FunctionAgent:
    """Adapter: wraps an async function as an Agent."""
    name: str
    description: str
    supported_intents: tuple[IntentName, ...]
    fn: AgentFn

    async def execute(self, context: AgentContext) -> AgentResult:
        return await self.fn(context)

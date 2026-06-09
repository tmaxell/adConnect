"""Supervisor — entry point of the multi-agent system.

Flow:
1. If the request carries an explicit action, dispatch it to the owning agent.
2. Else, if the last assistant reply is waiting inside a sticky stage, continue in
   that agent without re-classifying (multi-turn campaign building).
3. Otherwise classify the intent (rules + LLM), build a one-step plan and run it.

Emits trace events at each stage via ctx.emit().
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base import AgentContext, AgentResult, Plan, PlanStep
from agents.intent import IntentDecision, classify_intent
from agents.registry import get_agent

logger = logging.getLogger(__name__)


# Action id → owning agent. Every campaign-wizard action belongs to the builder.
_ACTION_AGENT: dict[str, str] = {
    "select_channel": "campaign_builder",
    "select_segment": "campaign_builder",
    "keep_audience": "campaign_builder",
    "suggest_audience": "campaign_builder",
    "generate_creatives": "campaign_builder",
    "select_creative": "campaign_builder",
    "skip_creatives": "campaign_builder",
    "submit_campaign": "campaign_builder",
}

# Intent → owning agent. The builder is the unified campaign flow; segment and
# creative requests enter it too (it offers those as sub-steps).
_INTENT_AGENT: dict[str, str] = {
    "build_campaign": "campaign_builder",
    "suggest_segments": "campaign_builder",
    "generate_creatives": "campaign_builder",
    "documentation_qa": "docs_qa",
}

# Sticky stage (set in an assistant reply's agent_meta) → agent that owns it.
_STICKY_STAGES: dict[str, str] = {
    "collect_campaign": "campaign_builder",
}


async def handle(context: AgentContext) -> AgentResult:
    if context.action is not None:
        return await _handle_action(context)
    return await _handle_message(context)


async def _handle_action(ctx: AgentContext) -> AgentResult:
    action = ctx.action
    assert action is not None
    await ctx.emit("plan_created", detail=f"action: {action.id}", metadata={"action_id": action.id})

    agent_name = _ACTION_AGENT.get(action.id)
    if agent_name is None:
        return AgentResult(assistant_message=f"Неизвестное действие: {action.id}", status="error")
    agent = get_agent(agent_name)
    if agent is None:
        return AgentResult(assistant_message=f"Агент `{agent_name}` не зарегистрирован.", status="error")

    ctx.inputs.setdefault("action_id", action.id)
    return await agent.execute(ctx)


async def _handle_message(ctx: AgentContext) -> AgentResult:
    # Sticky-context: continue the multi-turn flow without re-classifying.
    sticky_agent, sticky_stage = _detect_sticky_agent(ctx.history)
    if sticky_agent:
        await ctx.emit(
            "plan_created",
            detail=f"sticky-context: продолжаем в {sticky_agent} (stage={sticky_stage})",
            metadata={"sticky": sticky_agent, "stage": sticky_stage},
        )
        agent = get_agent(sticky_agent)
        if agent is not None:
            ctx.inputs.setdefault("goal", ctx.message)
            return await agent.execute(ctx)

    decision = await classify_intent(ctx.message, history=ctx.history)
    await ctx.emit(
        "plan_created",
        detail=f"intent={decision.intent} confidence={decision.confidence:.2f} ({decision.reason})",
        metadata={"intent": decision.intent, "confidence": decision.confidence},
    )

    plan = _build_plan(decision)
    last_result: AgentResult | None = None
    for step in plan.steps:
        agent = get_agent(step.agent)
        if agent is None:
            await ctx.emit("step_completed", status="error", detail=f"agent `{step.agent}` not registered")
            return AgentResult(assistant_message=f"Агент `{step.agent}` не зарегистрирован.", status="error")
        ctx.inputs.update(step.inputs)
        last_result = await agent.execute(ctx)
        if last_result.status == "error":
            return last_result
        for artifact in last_result.artifacts:
            ctx.artifacts.append(artifact)

    return last_result or AgentResult(assistant_message="Шагов не выполнено.", status="error")


def _detect_sticky_agent(history: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """If the latest assistant reply is waiting in a sticky stage, return its agent."""
    for msg in reversed(history):
        if msg.get("role") != "assistant":
            continue
        meta = msg.get("metadata") or {}
        agent_meta = meta.get("agent_meta") or {}
        stage = agent_meta.get("stage") if isinstance(agent_meta, dict) else None
        if stage in _STICKY_STAGES:
            return _STICKY_STAGES[stage], stage
        break  # only the most recent assistant reply matters
    return None, None


def _build_plan(decision: IntentDecision) -> Plan:
    agent_name = _INTENT_AGENT.get(decision.intent, "docs_qa")
    agent = get_agent(agent_name)
    entry_inputs: dict[str, Any] = {"entry": decision.intent}
    return Plan(
        intent=decision.intent,
        summary=decision.reason or decision.intent,
        steps=[PlanStep(agent=agent.name if agent else "docs_qa", description="", inputs=entry_inputs)],
    )

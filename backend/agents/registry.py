"""Agent registry for the AdConnect multi-agent system."""

from __future__ import annotations

from agents import campaign_builder, docs_qa
from agents.base import AgentProtocol, FunctionAgent


def _make(module) -> AgentProtocol:
    return FunctionAgent(
        name=module.NAME,
        description=module.DESCRIPTION,
        supported_intents=module.SUPPORTED_INTENTS,
        fn=module.execute,
    )


_AGENTS: dict[str, AgentProtocol] = {
    campaign_builder.NAME: _make(campaign_builder),
    docs_qa.NAME: _make(docs_qa),
}


def get_agent(name: str) -> AgentProtocol | None:
    return _AGENTS.get(name)


def list_agents() -> list[AgentProtocol]:
    return list(_AGENTS.values())


def agent_for_intent(intent: str) -> AgentProtocol | None:
    for agent in _AGENTS.values():
        if intent in agent.supported_intents:
            return agent
    return None

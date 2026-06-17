"""AnalystAgent — performance reports & recommendations inside the Copilot chat.

Reads the same campaigns and runs the same `tools.analytics` as the analytics page,
so the numbers and advice the user sees in chat match the dashboard exactly.

- "отчёт / аналитика / как идут кампании" → account-level summary.
- mentions a campaign by name (or there's only one) → that campaign's report + AI advice.
"""

from __future__ import annotations

import logging

from agents.base import AgentContext, AgentResult
from schemas import ChatAction
from tools import analytics

logger = logging.getLogger(__name__)

NAME = "analyst"
DESCRIPTION = "Показывает аналитику по кампаниям и даёт рекомендации по улучшению."
SUPPORTED_INTENTS = ("analytics_report",)


def _match_campaign(message: str, campaigns: list[dict]) -> dict | None:
    """Pick a campaign the message refers to (by name token, or the latest)."""
    text = (message or "").lower()
    if any(w in text for w in ("последн", "свеж", "новую кампан")):
        return campaigns[0] if campaigns else None
    best: tuple[int, dict] | None = None
    for c in campaigns:
        name = str(c.get("name") or "").lower()
        if not name:
            continue
        # significant tokens (≥4 chars) of the campaign name present in the message
        tokens = [t for t in name.replace("«", " ").replace("»", " ").split() if len(t) >= 4]
        hits = sum(1 for t in tokens if t in text)
        if hits and (best is None or hits > best[0]):
            best = (hits, c)
    return best[1] if best else None


async def execute(ctx: AgentContext) -> AgentResult:
    await ctx.emit("step_started", detail="Analyst: building report")
    campaigns = await ctx.store.list_campaigns_full()
    if not campaigns:
        await ctx.emit("step_completed", detail="Analyst: no campaigns")
        return AgentResult(
            assistant_message=(
                "Пока нет запущенных кампаний — соберите первую, и я покажу аналитику "
                "и рекомендации здесь же. Напишите, например: «Создай кампанию в Meta»."
            ),
            status="ok", metadata={"stage": "analytics"},
        )

    message = ctx.inputs.get("goal") or ctx.message
    target = _match_campaign(message, campaigns)

    if target is not None:
        metrics = analytics.campaign_metrics(target)
        advice = await analytics.advice_text(metrics)
        msg = f"{analytics.format_report(metrics)}\n\n**Что улучшить:**\n{advice}"
        actions = [ChatAction(
            id="open_analytics", label="Открыть аналитику кампании", kind="primary",
            payload={"campaign_id": metrics.campaign_id},
        )]
        await ctx.emit("step_completed", detail=f"Analyst: report for #{metrics.campaign_id}")
        return AgentResult(assistant_message=msg, actions=actions, status="ok",
                           metadata={"stage": "analytics", "campaign_id": metrics.campaign_id})

    summary = analytics.account_summary(campaigns)
    msg = analytics.format_summary(summary)
    actions = [ChatAction(id="open_analytics", label="Открыть страницу аналитики",
                          kind="primary", payload={})]
    await ctx.emit("step_completed", detail=f"Analyst: summary ({summary.campaign_count})")
    return AgentResult(assistant_message=msg, actions=actions, status="ok",
                       metadata={"stage": "analytics"})

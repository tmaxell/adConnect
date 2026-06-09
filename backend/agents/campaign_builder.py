"""CampaignBuilderAgent — the flagship campaign-assembly agent.

It interviews the user and assembles an AdConnect campaign step by step, following
the product wizard: Sending Channel → Segments → Message → Cost → Confirmation.

Each turn:
1. Load the accumulated CampaignDraft (latest `campaign_draft` artifact).
2. Apply the user's action (channel pick, audience suggestion, creative pick,
   submit) or merge a free-text message into the draft.
3. Recompute the reach/price forecast.
4. Advance to the first incomplete wizard step and ask the next question, offering
   one-click actions (suggest audience, generate creatives, submit…).
5. Persist the updated draft (once, centrally) and tag the reply with a sticky
   stage so follow-ups continue here.

Guardrail: the agent assembles and edits a draft autonomously but performs no
irreversible action. "Submit for moderation" only flips the draft status — it
never launches the campaign or charges the wallet.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from agents.base import AgentContext, AgentResult
from schemas import CampaignDraft, ChatAction
from tools import creatives as creatives_tool
from tools import naming
from tools.brief import merge_updates, update_draft_from_message
from tools.catalog import CHANNELS, SEGMENTS_BY_ID, is_network_channel, match_segments
from tools.forecast import apply_forecast

logger = logging.getLogger(__name__)

NAME = "campaign_builder"
DESCRIPTION = "Собирает рекламную кампанию AdConnect по шагам мастера: канал → сегменты → сообщение → стоимость → подтверждение."
SUPPORTED_INTENTS = ("build_campaign",)

# Sticky stage tag — keeps the dialogue inside this agent until the draft is submitted.
STAGE = "collect_campaign"


async def execute(ctx: AgentContext) -> AgentResult:
    started = time.perf_counter()
    action_id = ctx.action.id if ctx.action else None
    await ctx.emit("step_started", detail=f"CampaignBuilder: action={action_id or 'message'}")

    draft = _load_draft(ctx)
    if draft.goal is None:
        goal = ctx.inputs.get("goal") or ctx.message
        draft.goal = (goal or "").strip()[:200] or None

    # 1. Apply the turn. Actions either return a specialized result (suggest /
    #    generate / submit) or just mutate the draft (None → standard step flow).
    result: AgentResult | None = None
    if action_id:
        result = await _handle_action(ctx, draft, action_id)
    elif ctx.message.strip():
        await update_draft_from_message(draft, ctx.message, history=ctx.history)

    # 2. Standard path: forecast + advance the wizard to the next question.
    if result is None:
        apply_forecast(draft)
        draft.step = draft.current_step()
        if draft.step == "confirmation" and not draft.name:
            draft.name = await naming.generate_campaign_name(
                draft.product, draft.goal,
                channel=draft.channel, audience=draft.segments.matched_segment_name,
            )
        result = _respond_for_step(draft)

    # 3. Persist the draft once and attach it to the result.
    artifact = await _persist(ctx, draft)
    result.artifacts = [artifact]

    await ctx.emit(
        "step_completed",
        detail=f"step={draft.step} reach={draft.audience_reach} in {(time.perf_counter()-started)*1000:.0f}ms",
        metadata={"step": draft.step, "reach": draft.audience_reach},
    )
    return result


# ── Actions ───────────────────────────────────────────────────────────────────

async def _handle_action(ctx: AgentContext, draft: CampaignDraft, action_id: str) -> AgentResult | None:
    """Apply a one-click action.

    Returns a specialized AgentResult for actions that produce their own message
    (suggest_audience / generate_creatives / submit_campaign), or None for simple
    mutations (channel / segment / creative pick) so `execute` runs the standard
    step response.
    """
    payload = (ctx.action.payload if ctx.action else {}) or {}

    if action_id == "select_channel":
        if payload.get("channel") in ("sms", "email", "meta"):
            draft.channel = payload["channel"]
        return None

    if action_id == "select_segment":
        seg = SEGMENTS_BY_ID.get(str(payload.get("segment_id")))
        if seg:
            merge_updates(draft, dict(seg.spec))
            draft.segments.matched_segment_id = seg.id
            draft.segments.matched_segment_name = seg.name
        return None

    if action_id == "select_creative":
        text = payload.get("text")
        idx = payload.get("index")
        if not text and isinstance(idx, int) and 0 <= idx < len(draft.message.variants):
            text = draft.message.variants[idx]
        if text:
            draft.message.text = str(text)
        return None

    if action_id == "skip_creatives":
        if not draft.message.variants:
            subject = naming.clean_subject(draft.product, draft.goal)
            draft.message.variants = await creatives_tool.generate_creatives(
                product=subject, goal=draft.goal, channel=draft.channel or "sms",
            )
        draft.message.text = draft.message.variants[0] if draft.message.variants else \
            "Специальное предложение — подробности по ссылке."
        return None

    if action_id == "suggest_audience":
        return await _suggest_audience(ctx, draft)

    if action_id == "generate_creatives":
        return await _generate_creatives(ctx, draft)

    if action_id == "submit_campaign":
        return await _submit(ctx, draft)

    return None  # unknown action — fall through to the standard step response


async def _suggest_audience(ctx: AgentContext, draft: CampaignDraft) -> AgentResult:
    query = " ".join(filter(None, [draft.goal, draft.product, ctx.message]))
    matches = match_segments(query, limit=3)
    await ctx.emit("tool_called", detail=f"match_segments → {len(matches)} segment(s)")

    lines = ["Вот подходящие сегменты абонентской базы оператора:\n"]
    actions: list[ChatAction] = []
    for m in matches:
        seg = m.segment
        reach = f"{seg.reach:,}".replace(",", " ")
        lines.append(f"- **{seg.name}** — {seg.description} Охват ≈ {reach}.")
        actions.append(ChatAction(
            id="select_segment", label=f"Выбрать: {seg.name}", kind="primary",
            payload={"segment_id": seg.id},
        ))
    lines.append("\nВыберите сегмент или опишите аудиторию своими словами.")
    apply_forecast(draft)
    return _wrap(draft, "\n".join(lines), actions, substep="audience")


async def _generate_creatives(ctx: AgentContext, draft: CampaignDraft) -> AgentResult:
    channel = draft.channel or "sms"
    audience = draft.segments.matched_segment_name or ", ".join(draft.segments.interests)
    subject = naming.clean_subject(draft.product, draft.goal)
    variants = await creatives_tool.generate_creatives(
        product=subject, goal=draft.goal, channel=channel, audience=audience,
    )
    draft.message.variants = variants
    await ctx.emit("tool_called", detail=f"generate_creatives → {len(variants)} variant(s)")

    noun = "объявления" if is_network_channel(channel) else "сообщения"
    lines = [f"Сгенерировал варианты {CHANNELS[channel].label} — {noun}:\n"]
    actions: list[ChatAction] = []
    for i, v in enumerate(variants):
        lines.append(f"{i + 1}. {v}")
        actions.append(ChatAction(
            id="select_creative", label=f"Вариант {i + 1}", kind="primary",
            payload={"index": i, "text": v},
        ))
    lines.append("\nВыберите вариант или пришлите свой текст.")
    apply_forecast(draft)
    return _wrap(draft, "\n".join(lines), actions, substep="message")


async def _submit(ctx: AgentContext, draft: CampaignDraft) -> AgentResult:
    apply_forecast(draft)
    # Idempotency: a campaign is created exactly once, on the first submit.
    if draft.status == "submitted":
        return AgentResult(
            assistant_message=f"Кампания **«{draft.name}»** уже отправлена на модерацию.",
            actions=[], status="ok", metadata={"stage": "done"},
        )
    if not draft.is_ready():
        # Guardrail: never submit an incomplete draft — return to the missing step.
        draft.step = draft.current_step()
        return _respond_for_step(draft)
    if not draft.name:
        draft.name = await naming.generate_campaign_name(
            draft.product, draft.goal,
            channel=draft.channel, audience=draft.segments.matched_segment_name,
        )
    draft.status = "submitted"
    draft.step = "ready"

    # Persist the campaign so it shows up in the Ad Campaigns list.
    campaign_id = await ctx.store.save_campaign(
        session_id=ctx.session_id, draft=draft.model_dump(mode="json"), status="moderation",
    )
    await ctx.store.set_campaign_id(session_id=ctx.session_id, campaign_id=campaign_id)
    await ctx.emit("run_completed", detail=f"campaign #{campaign_id} submitted for moderation")

    msg = (
        f"Кампания **«{draft.name}»** собрана и отправлена на модерацию. "
        f"Списания и запуска не произошло — это произойдёт только после вашего подтверждения "
        f"и прохождения модерации.\n\n{_summary(draft)}"
    )
    return AgentResult(
        assistant_message=msg, actions=[], status="ok",
        metadata={"stage": "done", "campaign_id": campaign_id},
    )


# ── Step responses ─────────────────────────────────────────────────────────────

def _respond_for_step(draft: CampaignDraft) -> AgentResult:
    handler = {
        "channel": _ask_channel,
        "segments": _ask_segments,
        "message": _ask_message,
        "cost": _ask_cost,
        "confirmation": _confirm,
    }.get(draft.step, _confirm)
    return handler(draft)


def _wrap(draft: CampaignDraft, message: str, actions: list[ChatAction], *,
          status: str = "needs_input", stage: str = STAGE, substep: str | None = None) -> AgentResult:
    meta: dict[str, Any] = {"stage": stage, "step": draft.step}
    if substep:
        meta["substep"] = substep
    return AgentResult(
        assistant_message=message, actions=actions,
        status=status,  # type: ignore[arg-type]
        metadata=meta,
    )


def _ask_channel(draft: CampaignDraft) -> AgentResult:
    meta = CHANNELS["meta"]
    msg = (
        f"{_intro_line(draft)}Начнём с **канала**. Где показываем рекламу?\n\n"
        f"- **SMS** — мгновенный контакт, {CHANNELS['sms'].base_price_per_message} ₽/сообщение.\n"
        f"- **Email** — для длинных сообщений, {CHANNELS['email'].base_price_per_message} ₽/сообщение.\n"
        f"- **Meta Ads** — Facebook, Instagram и WhatsApp. Ваша аудитория загружается как "
        f"Custom Audience (по хешам телефонов), оплата за показы (CPM ≈ {meta.avg_cpm:.0f} ₽)."
    )
    actions = [
        ChatAction(id="select_channel", label="SMS", kind="primary", payload={"channel": "sms"}),
        ChatAction(id="select_channel", label="Email", kind="primary", payload={"channel": "email"}),
        ChatAction(id="select_channel", label="Meta Ads", kind="primary", payload={"channel": "meta"}),
    ]
    return _wrap(draft, msg, actions)


def _ask_segments(draft: CampaignDraft) -> AgentResult:
    landing = ""
    if is_network_channel(draft.channel):
        ci = CHANNELS[draft.channel]
        landing = (
            f" Для **{ci.label}** аудитория загружается как Custom Audience "
            f"(хеши телефонов, совпадает ≈{ci.match_rate * 100:.0f}%)."
        )
    msg = (
        f"Канал: **{CHANNELS[draft.channel].label}**. Теперь — **аудитория**.{landing}\n\n"
        f"Опишите, кого хотим охватить (гео, возраст, интересы), либо я подберу сегмент "
        f"абонентской базы под вашу цель."
    )
    actions = [ChatAction(id="suggest_audience", label="Подобрать аудиторию за меня", kind="primary", payload={})]
    return _wrap(draft, msg, actions)


def _ask_message(draft: CampaignDraft) -> AgentResult:
    reach = f"{draft.audience_reach:,}".replace(",", " ")
    if is_network_channel(draft.channel):
        ci = CHANNELS[draft.channel]
        price_line = f"охват аудитории ≈ **{reach}**, размещение **{', '.join(ci.placements)}**, оплата за показы (CPM ≈ {draft.cpm:.0f} ₽)"
        what = "**текст объявления**"
    else:
        price_line = f"охват ≈ **{reach}**, цена сообщения **{draft.price_per_message} ₽**"
        what = "**текст сообщения**"
    msg = (
        f"Аудитория готова: {price_line}.\n\n"
        f"Теперь {what}. Пришлите свой вариант или я сгенерирую несколько под вашу цель."
    )
    actions = [
        ChatAction(id="generate_creatives", label="Сгенерировать креативы", kind="primary", payload={}),
        ChatAction(id="skip_creatives", label="Использовать типовой текст", kind="default", payload={}),
    ]
    return _wrap(draft, msg, actions)


def _ask_cost(draft: CampaignDraft) -> AgentResult:
    if is_network_channel(draft.channel):
        msg = (
            "Объявление готово. Теперь — **бюджет**.\n\n"
            f"Укажите бюджет кампании в рублях. При CPM **{draft.cpm:.0f} ₽** я посчитаю "
            f"ожидаемое число показов."
        )
    else:
        msg = (
            "Сообщение готово. Теперь — **бюджет**.\n\n"
            f"Укажите бюджет в рублях или число сообщений. При цене **{draft.price_per_message} ₽** "
            f"за сообщение я посчитаю охват и стоимость."
        )
    return _wrap(draft, msg, [])


def _confirm(draft: CampaignDraft) -> AgentResult:
    if not draft.name:
        draft.name = naming.derive_name(draft.product, draft.goal)
    msg = (
        "Кампания собрана. Проверьте параметры и отправьте на модерацию — "
        "запуска и списания не произойдёт без вашего подтверждения.\n\n"
        f"{_summary(draft)}"
    )
    actions = [
        ChatAction(id="submit_campaign", label="Отправить на модерацию", kind="primary", payload={}),
        ChatAction(id="generate_creatives", label="Перегенерировать креатив", kind="default", payload={}),
    ]
    return _wrap(draft, msg, actions)


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _intro_line(draft: CampaignDraft) -> str:
    return f"Собираю кампанию: «{draft.goal}». " if draft.goal else ""


def _summary(draft: CampaignDraft) -> str:
    seg = draft.segments
    reach = f"{draft.audience_reach:,}".replace(",", " ")
    network = is_network_channel(draft.channel)
    rows = [
        f"- **Канал**: {CHANNELS[draft.channel].label if draft.channel else '—'}",
        f"- **Аудитория**: {seg.matched_segment_name or _audience_text(draft)}",
        f"- **Гео**: {', '.join(seg.geography) or 'Россия'}",
        f"- **Демография**: {seg.demographics}",
        f"- **Возраст**: {', '.join(seg.age) or '—'}",
        f"- **Интересы**: {', '.join(seg.interests) or '—'}",
        f"- **{'Объявление' if network else 'Сообщение'}**: {draft.message.text or '—'}",
    ]
    if network:
        ci = CHANNELS[draft.channel]
        impressions = f"{draft.estimated_impressions:,}".replace(",", " ")
        rows += [
            f"- **Размещение**: {', '.join(ci.placements)}",
            f"- **Аудитория (Custom Audience)**: ≈ {reach}",
            f"- **CPM**: {draft.cpm:.0f} ₽",
            f"- **Ожидаемые показы**: ≈ {impressions}",
            f"- **Бюджет**: {_budget_text(draft)}",
        ]
    else:
        rows += [
            f"- **Охват**: ≈ {reach}",
            f"- **Цена сообщения**: {draft.price_per_message} ₽",
            f"- **Бюджет**: {_budget_text(draft)}",
        ]
    return "\n".join(rows)


def _audience_text(draft: CampaignDraft) -> str:
    parts = list(draft.segments.interests) + list(draft.segments.age)
    return ", ".join(parts) if parts else "широкая аудитория"


def _budget_text(draft: CampaignDraft) -> str:
    cost = draft.cost
    if cost.budget is not None:
        return f"{cost.budget:,.0f} ₽".replace(",", " ")
    if cost.messages_count:
        msgs = f"{cost.messages_count:,}".replace(",", " ")
        est = f"{draft.estimated_cost:,.0f}".replace(",", " ")
        return f"{msgs} сообщений ≈ {est} ₽"
    return "—"


# ── Draft persistence ───────────────────────────────────────────────────────────

def _load_draft(ctx: AgentContext) -> CampaignDraft:
    artifact = ctx.latest_artifact("campaign_draft")
    if artifact and isinstance(artifact.get("content"), dict):
        try:
            return CampaignDraft.model_validate(artifact["content"])
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("failed to load campaign_draft, starting fresh: %s", exc)
    return CampaignDraft()


async def _persist(ctx: AgentContext, draft: CampaignDraft) -> dict[str, Any]:
    content = draft.model_dump(mode="json")
    art_id = await ctx.store.save_artifact(
        session_id=ctx.session_id,
        artifact_type="campaign_draft",
        content_json=content,
        source_run_id=ctx.run_id,
    )
    return {"id": art_id, "type": "campaign_draft", "content": content}

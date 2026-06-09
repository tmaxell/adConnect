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
import re
import time
from typing import Any

from agents.base import AgentContext, AgentResult
from schemas import META_PLACEMENTS, CampaignDraft, ChatAction
from tools import creative_gen
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
    prior_step = draft.step  # the step the user was answering this turn
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
        # Infer the Meta objective from the RAW request (the LLM may summarize the
        # goal and drop intent words like "заявки"); never downgrade a specific one.
        inferred = _infer_objective(ctx.message)
        if inferred != "traffic":
            draft.meta.objective = inferred
        # A free-text reply while on the segments step is the user describing their
        # audience → count it as an explicit audience decision.
        if prior_step == "segments":
            draft.segments.audience_confirmed = True

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


# ── Meta creative helpers ───────────────────────────────────────────────────────

_FORMAT_LABEL = {"feed": "Лента", "stories": "Истории", "reels": "Reels", "whatsapp": "WhatsApp"}
_FORMAT_DEFAULT_MEDIA = {"feed": "image", "stories": "image", "reels": "video", "whatsapp": "image"}
_FORMAT_ORDER = ("feed", "stories", "reels", "whatsapp")


def _effective_placements(draft: CampaignDraft) -> list[str]:
    """Placements that ads actually run on (all of them under Advantage+ placements)."""
    if draft.meta.advantage_placements:
        return list(META_PLACEMENTS)
    return draft.meta.placements


def _available_formats(placements: list[str]) -> list[str]:
    """Creative formats offered for the given placements (mirrors the canvas)."""
    out: list[str] = []
    if any(p in placements for p in ("facebook", "instagram", "messenger")):
        out.append("feed")
    if "facebook" in placements or "instagram" in placements:
        out += ["stories", "reels"]
    if "whatsapp" in placements:
        out.append("whatsapp")  # WhatsApp Status (9:16) + Click-to-WhatsApp chat
    return [f for f in _FORMAT_ORDER if f in out] or ["feed"]


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

    if action_id == "toggle_lookalike":
        draft.meta.lookalike = not draft.meta.lookalike
        return None

    if action_id == "select_segment":
        seg = SEGMENTS_BY_ID.get(str(payload.get("segment_id")))
        if seg:
            merge_updates(draft, dict(seg.spec))
            draft.segments.matched_segment_id = seg.id
            draft.segments.matched_segment_name = seg.name
            draft.segments.audience_confirmed = True
        return None

    if action_id == "keep_audience":
        # User chose to continue with the current/whole-base audience.
        draft.segments.audience_confirmed = True
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

    if action_id == "select_format":
        fmt = payload.get("format")
        if fmt in ("feed", "stories", "reels", "whatsapp"):
            draft.channel = "meta"
            draft.meta.creative.format = fmt
            if draft.meta.creative.media_type == "none":
                draft.meta.creative.media_type = _FORMAT_DEFAULT_MEDIA[fmt]
        return None

    if action_id == "suggest_audience":
        return await _suggest_audience(ctx, draft)

    if action_id == "generate_creatives":
        return await _generate_creatives(ctx, draft)

    if action_id == "generate_creative_image":
        media_type = "video" if payload.get("media_type") == "video" else "image"
        return await _generate_meta_creative(ctx, draft, media_type=media_type)

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


async def _ensure_ad_text(ctx: AgentContext, draft: CampaignDraft) -> str:
    """Guarantee the draft has ad copy (generate a variant if empty)."""
    if draft.message.text:
        return draft.message.text
    if not draft.message.variants:
        subject = naming.clean_subject(draft.product, draft.goal)
        draft.message.variants = await creatives_tool.generate_creatives(
            product=subject, goal=draft.goal, channel="meta",
            audience=draft.segments.matched_segment_name or ", ".join(draft.segments.interests),
        )
    draft.message.text = draft.message.variants[0] if draft.message.variants else \
        "Специальное предложение — подробности по ссылке."
    return draft.message.text


def _creative_actions(draft: CampaignDraft) -> list[ChatAction]:
    """Format picks + media generation buttons for the Meta creative step."""
    cr = draft.meta.creative
    actions = [
        ChatAction(id="generate_creative_image", label="Сгенерировать изображение",
                   kind="primary", payload={"media_type": "image"}),
        ChatAction(id="generate_creative_image", label="Сгенерировать видео",
                   kind="default", payload={"media_type": "video"}),
    ]
    for fmt in _available_formats(_effective_placements(draft)):
        if fmt == cr.format:
            continue
        actions.append(ChatAction(
            id="select_format", label=f"Формат: {_FORMAT_LABEL[fmt]}",
            kind="default", payload={"format": fmt},
        ))
    return actions


async def _generate_meta_creative(ctx: AgentContext, draft: CampaignDraft, *, media_type: str = "image") -> AgentResult:
    """Mock-generate a Meta creative (image/video) for the current format."""
    draft.channel = "meta"
    headline = await _ensure_ad_text(ctx, draft)
    cr = draft.meta.creative
    cr.media_type = media_type  # type: ignore[assignment]
    cr.headline = headline
    cr.media_url = creative_gen.save_generated(
        fmt=cr.format, media_type=media_type, headline=headline, brand=draft.product,
        seed=len(draft.message.variants) + (1 if media_type == "video" else 0),
    )
    cr.media_source = "generated"
    await ctx.emit("tool_called", detail=f"generate_creative → {media_type}/{cr.format}")

    kind = "видео" if media_type == "video" else "изображение"
    msg = (
        f"Готово: сгенерировал **{kind}** для формата «**{_FORMAT_LABEL[cr.format]}**».\n\n"
        f"Текст объявления: «{headline}».\n\n"
        f"Можно перегенерировать, сменить формат или загрузить своё медиа прямо на холсте."
    )
    apply_forecast(draft)
    return _wrap(draft, msg, _creative_actions(draft), substep="message")


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
    prefilled = _audience_hint(draft)
    hint = f" Пока ориентируюсь на: {prefilled}." if prefilled else ""

    if is_network_channel(draft.channel):
        ci = CHANNELS[draft.channel]
        geo = ", ".join(draft.segments.geography)
        geo_line = (
            f"Гео уже задано: **{geo}**. " if geo
            else "**В каком городе показываем рекламу?** Для локального бизнеса гео — самый важный таргетинг. "
        )
        msg = (
            f"Канал: **{ci.label}**. Теперь — **аудитория**.{hint}\n\n"
            f"{geo_line}Также можно задать возраст и интересы. Данные оператора подгружаются как "
            f"Custom Audience (совпадение ≈{ci.match_rate * 100:.0f}%), при желании расширю похожей аудиторией."
        )
    else:
        msg = (
            f"Канал: **{CHANNELS[draft.channel].label}**. Теперь — **аудитория**.{hint}\n\n"
            f"Опишите, кого хотим охватить (гео, возраст, интересы), либо я подберу сегмент "
            f"абонентской базы под вашу цель."
        )
    actions = [
        ChatAction(id="suggest_audience", label="Подобрать аудиторию за меня", kind="primary", payload={}),
        ChatAction(id="keep_audience", label="Продолжить с этой аудиторией", kind="default", payload={}),
    ]
    if is_network_channel(draft.channel):
        ll = draft.meta.lookalike
        actions.append(ChatAction(
            id="toggle_lookalike",
            label=("Выключить похожую аудиторию" if ll else "Расширить похожей аудиторией (lookalike)"),
            kind="default", payload={},
        ))
    return _wrap(draft, msg, actions)


_OBJECTIVE_RULES: list[tuple[str, str]] = [
    ("sales", r"продаж|купить|заказ|покупк|выручк|конверс"),
    ("leads", r"заявк|лид|регистрац|подписк на|запис"),
    ("awareness", r"узнаваем|охват|бренд"),
    ("engagement", r"вовлеч|подписчик|лайк|актив"),
]
_OBJECTIVE_LABEL = {
    "awareness": "Узнаваемость", "traffic": "Трафик", "engagement": "Вовлечённость",
    "leads": "Лиды", "sales": "Продажи",
}


def _infer_objective(goal: str | None) -> str:
    g = (goal or "").lower()
    for objective, pattern in _OBJECTIVE_RULES:
        if re.search(pattern, g):
            return objective
    return "traffic"


def _audience_hint(draft: CampaignDraft) -> str:
    seg = draft.segments
    parts = list(seg.geography) + list(seg.interests) + list(seg.age)
    if seg.demographics != "all":
        parts.append(seg.demographics)
    return ", ".join(parts)


def _ask_message(draft: CampaignDraft) -> AgentResult:
    reach = f"{draft.audience_reach:,}".replace(",", " ")
    if is_network_channel(draft.channel):
        cr = draft.meta.creative
        price_line = f"охват аудитории ≈ **{reach}**, оплата за показы (CPM ≈ {draft.cpm:.0f} ₽)"
        formats = " · ".join(_FORMAT_LABEL[f] for f in _available_formats(_effective_placements(draft)))
        msg = (
            f"Аудитория готова: {price_line}.\n\n"
            f"Теперь **креатив**. Текущий формат — «**{_FORMAT_LABEL[cr.format]}**» "
            f"(доступны: {formats}). Сгенерирую текст и изображение/видео под вашу цель, "
            f"либо соберите всё на холсте — выбор формата, загрузка и генерация медиа доступны там же."
        )
        actions = [
            ChatAction(id="generate_creatives", label="Сгенерировать тексты", kind="primary", payload={}),
            *_creative_actions(draft),
            ChatAction(id="skip_creatives", label="Использовать типовой текст", kind="default", payload={}),
        ]
        return _wrap(draft, msg, actions, substep="message")

    price_line = f"охват ≈ **{reach}**, цена сообщения **{draft.price_per_message} ₽**"
    msg = (
        f"Аудитория готова: {price_line}.\n\n"
        f"Теперь **текст сообщения**. Пришлите свой вариант или я сгенерирую несколько под вашу цель."
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
        impressions = f"{draft.estimated_impressions:,}".replace(",", " ")
        placement_labels = {b.platform: b.label for b in draft.platform_breakdown}
        placements = ", ".join(placement_labels.get(p, p) for p in draft.meta.placements) or "Facebook, Instagram"
        split = " · ".join(
            f"{b.label} {b.impressions:,}".replace(",", " ") for b in draft.platform_breakdown
        )
        rows += [
            f"- **Цель**: {_OBJECTIVE_LABEL.get(draft.meta.objective, draft.meta.objective)}",
            f"- **Плейсменты**: {placements}",
            f"- **Похожая аудитория (lookalike)**: {'да' if draft.meta.lookalike else 'нет'}",
            f"- **Аудитория (Custom Audience)**: ≈ {reach}",
            f"- **CPM**: {draft.cpm:.0f} ₽",
            f"- **Ожидаемые показы**: ≈ {impressions}",
        ]
        if split:
            rows.append(f"- **По платформам**: {split}")
        rows.append(f"- **Бюджет**: {_budget_text(draft)}")
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

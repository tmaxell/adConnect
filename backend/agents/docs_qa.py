"""DocsQAAgent — answers "how / what / why" questions about AdConnect.

Minimal for the first slice: an LLM answer grounded in a short product primer,
with a deterministic fallback when no provider is configured. A full RAG index
over the product docs is a later step (see the plan in the backend README).
"""

from __future__ import annotations

import logging

from agents.base import AgentContext, AgentResult

logger = logging.getLogger(__name__)

NAME = "docs_qa"
DESCRIPTION = "Отвечает на вопросы о платформе AdConnect и помогает с подсказками."
SUPPORTED_INTENTS = ("documentation_qa",)

_PRIMER = """AdConnect — кабинет для запуска рекламы во внешних сетях (SMS, Email и далее Telegram/Meta/Google).
Кампания создаётся пошагово в мастере: 1) Канал отправки (SMS/Email), 2) Сегменты (гео, демография,
возраст, доход, интересы), 3) Сообщение (текст/креатив), 4) Стоимость (бюджет, расписание),
5) Подтверждение (проверка параметров и отправка на модерацию). Запуск и списание средств происходят
только после подтверждения пользователем и прохождения модерации."""

_FALLBACK = (
    "AdConnect помогает запускать рекламные кампании пошагово: канал → сегменты → сообщение → "
    "стоимость → подтверждение. Чтобы собрать кампанию автоматически, напишите, например: "
    "«Создай SMS-кампанию для моего фитнес-клуба» — и я проведу вас по шагам."
)


async def execute(ctx: AgentContext) -> AgentResult:
    await ctx.emit("step_started", detail="DocsQA: answering")
    question = ctx.inputs.get("goal") or ctx.message
    answer = await _answer(question)
    await ctx.emit("step_completed", detail="DocsQA: done")
    return AgentResult(assistant_message=answer, status="ok", metadata={"stage": "qa"})


async def _answer(question: str) -> str:
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        from llm import get_llm

        llm = get_llm(temperature=0.2)
        result = await llm.ainvoke([
            SystemMessage(content=f"Ты — ассистент платформы AdConnect. Отвечай кратко и по делу на русском.\n\n{_PRIMER}"),
            HumanMessage(content=question),
        ])
        raw = getattr(result, "content", "")
        text = raw if isinstance(raw, str) else str(raw)
        if text.strip():
            return text.strip()
    except Exception as exc:
        logger.info("docs_qa llm skipped: %s", exc)
    return _FALLBACK

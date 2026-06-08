"""Brief extraction: deterministic slot filling + merge semantics."""

import pytest

from schemas import CampaignDraft
from tools.brief import merge_updates, update_draft_from_message


async def _merge(message: str) -> CampaignDraft:
    draft = CampaignDraft()
    return await update_draft_from_message(draft, message, use_llm=False)


async def test_detects_channel_sms():
    draft = await _merge("Хочу отправить SMS клиентам")
    assert draft.channel == "sms"


async def test_detects_channel_email():
    draft = await _merge("Сделай рассылку по email")
    assert draft.channel == "email"


async def test_detects_geography_and_interests():
    draft = await _merge("Реклама для тех, кто любит путешествия, в Москве и Питере")
    assert "Moscow" in draft.segments.geography
    assert "Saint-Petersburg" in draft.segments.geography
    assert "travel" in draft.segments.interests


async def test_detects_demographics_and_age():
    draft = await _merge("Целевая аудитория — женщины 25-34")
    assert draft.segments.demographics == "women"
    assert "25-34" in draft.segments.age


async def test_detects_budget():
    draft = await _merge("Бюджет кампании 25000 рублей")
    assert draft.cost.budget == 25000.0


async def test_detects_messages_count():
    draft = await _merge("Отправь 10000 сообщений")
    assert draft.cost.messages_count == 10000


async def test_goal_captured_when_empty():
    draft = await _merge("Прорекламируй мой фитнес-клуб")
    assert draft.goal and "фитнес" in draft.goal.lower()


def test_merge_extends_lists_uniquely():
    draft = CampaignDraft()
    merge_updates(draft, {"geography": ["Moscow"], "interests": ["travel"]})
    merge_updates(draft, {"geography": ["Moscow", "Kazan"]})
    assert draft.segments.geography == ["Moscow", "Kazan"]


def test_merge_ignores_empty_values():
    draft = CampaignDraft(channel="sms")
    merge_updates(draft, {"channel": "", "budget": None, "geography": []})
    assert draft.channel == "sms"
    assert draft.segments.geography == []

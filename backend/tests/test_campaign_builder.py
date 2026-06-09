"""End-to-end campaign building: the wizard state machine through the supervisor.

Exercises intent routing, sticky multi-turn context, action handling and the
guardrail that submission only changes status (no launch / no spend).
"""

from conftest import action


async def test_full_campaign_flow(convo):
    # 1. Build request — rule routes to the builder; "SMS" is detected from text.
    r1 = await convo.send("Создай SMS-кампанию для семей с детьми")
    assert convo.draft["channel"] == "sms"
    assert convo.draft["step"] == "segments"
    assert "аудитори" in r1.assistant_message.lower()
    assert r1.metadata["stage"] == "collect_campaign"

    # 2. Ask the agent to suggest an audience → segment options offered.
    r2 = await convo.send(action=action("suggest_audience"))
    assert r2.status == "needs_input"
    assert any(a.id == "select_segment" for a in r2.actions)

    # 3. Pick the young-families segment → audience filled, advance to message.
    r3 = await convo.send(action=action("select_segment", segment_id="seg_young_families"))
    assert convo.draft["segments"]["matched_segment_id"] == "seg_young_families"
    assert convo.draft["step"] == "message"
    assert any(a.id == "generate_creatives" for a in r3.actions)

    # 4. Generate creatives → variants produced (template fallback offline).
    r4 = await convo.send(action=action("generate_creatives"))
    assert convo.draft["message"]["variants"]
    assert any(a.id == "select_creative" for a in r4.actions)

    # 5. Choose the first creative → message set, advance to cost.
    await convo.send(action=action("select_creative", index=0))
    assert convo.draft["message"]["text"]
    assert convo.draft["step"] == "cost"

    # 6. Provide a budget by plain text → sticky context keeps us in the builder.
    r6 = await convo.send("Бюджет 25000 рублей")
    assert convo.draft["cost"]["budget"] == 25000.0
    assert convo.draft["step"] == "confirmation"
    assert any(a.id == "submit_campaign" for a in r6.actions)

    # 7. Submit → status flips to submitted, nothing launched / charged.
    r7 = await convo.send(action=action("submit_campaign"))
    assert r7.status == "ok"
    assert convo.draft["status"] == "submitted"
    assert convo.draft["step"] == "ready"
    assert "модерац" in r7.assistant_message.lower()
    assert convo.draft["audience_reach"] > 0
    # Name must be derived cleanly — no "Создай …/кампанию" leakage.
    name = convo.draft["name"] or ""
    assert name and "созда" not in name.lower() and "кампани" not in name.lower()

    # The campaign is persisted exactly once with the draft snapshot.
    assert len(convo.store.campaigns) == 1
    saved = convo.store.campaigns[0]
    assert saved["status"] == "moderation"
    assert saved["draft"]["name"] == convo.draft["name"]
    assert convo.store.session_campaign_id[convo.session_id] == saved["id"]

    # Submitting again is idempotent — no duplicate campaign.
    await convo.send(action=action("submit_campaign"))
    assert len(convo.store.campaigns) == 1


async def test_channel_asked_when_not_specified(convo):
    # No channel in the request → first question is the channel.
    r = await convo.send("Собери кампанию по продвижению нового тарифа")
    assert convo.draft["channel"] is None
    assert convo.draft["step"] == "channel"
    assert any(a.id == "select_channel" for a in r.actions)


async def test_submit_blocked_when_incomplete(convo):
    # Submitting before the draft is ready must not submit — guardrail.
    await convo.send("Создай SMS-кампанию")
    r = await convo.send(action=action("submit_campaign"))
    assert convo.draft["status"] == "draft"
    assert r.status != "ok" or convo.draft["status"] == "draft"


async def test_documentation_question_routes_to_docs(convo):
    r = await convo.send("Как создать рекламную кампанию в AdConnect?")
    assert r.metadata.get("stage") == "qa"
    assert convo.draft is None  # docs agent does not produce a campaign draft


async def test_meta_channel_flow(convo):
    # Pick Meta explicitly → wizard adapts to the auction/CPM model.
    await convo.send("Собери рекламную кампанию для моего бизнеса")
    await convo.send(action=action("select_channel", channel="meta"))
    assert convo.draft["channel"] == "meta"
    assert convo.draft["step"] == "segments"

    await convo.send(action=action("select_segment", segment_id="seg_active_mobile"))
    await convo.send(action=action("generate_creatives"))
    await convo.send(action=action("select_creative", index=0))
    # Budget drives impressions via CPM (no per-message pricing for Meta).
    r = await convo.send("Бюджет 50000")
    d = convo.draft
    assert d["step"] == "confirmation"
    assert d["price_per_message"] == 0.0
    assert d["cpm"] > 0
    assert d["estimated_impressions"] > 0
    assert d["cost"]["budget"] == 50000.0
    assert d["cost"]["messages_count"] is None
    assert any(a.id == "submit_campaign" for a in r.actions)

    r = await convo.send(action=action("submit_campaign"))
    assert convo.draft["status"] == "submitted"
    saved = convo.store.campaigns[-1]
    assert saved["draft"]["channel"] == "meta"

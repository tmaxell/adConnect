"""Analytics: deterministic mock metrics, aggregation and recommendations."""

import pytest

from tools.analytics import account_summary, campaign_metrics, recommendations


def _camp(cid=1, channel="meta", objective="leads", reach=50_000, budget=30_000, **draft):
    return {
        "id": cid, "name": f"Кампания {cid}", "channel": channel, "status": "active",
        "audience_reach": reach, "estimated_cost": budget, "budget": budget,
        "draft": {"cpm": 300, "estimated_impressions": int(budget / 300 * 1000),
                  "meta": {"objective": objective, "advantage_placements": True,
                           "placements": ["facebook", "instagram"], **draft}},
    }


def test_metrics_are_deterministic():
    a = campaign_metrics(_camp(cid=42))
    b = campaign_metrics(_camp(cid=42))
    assert a.model_dump() == b.model_dump()


def test_series_sums_to_totals():
    m = campaign_metrics(_camp(cid=3))
    assert sum(p.impressions for p in m.series) == m.impressions
    assert sum(p.clicks for p in m.series) == m.clicks
    assert sum(p.results for p in m.series) == m.results
    assert len(m.series) == 14


def test_reach_capped_by_targetable_audience():
    m = campaign_metrics(_camp(cid=5, reach=10_000))
    assert m.reach <= 10_000
    assert m.frequency == round(m.impressions / m.reach, 1)


def test_platform_split_only_for_network():
    net = campaign_metrics(_camp(cid=6, channel="meta"))
    assert net.platforms and sum(p.impressions for p in net.platforms) == net.impressions
    sms = campaign_metrics({"id": 7, "name": "x", "channel": "sms", "audience_reach": 1000,
                            "estimated_cost": 5000, "budget": 5000, "draft": {"meta": {}}})
    assert sms.platforms == []


def test_low_ctr_recommends_creative_refresh():
    from schemas import CampaignAnalytics
    m = CampaignAnalytics(campaign_id=1, name="x", ctr=0.5, frequency=1.5, cpm=300,
                          clicks=100, results=10, cost_per_result=50, cpc=5)
    recs = recommendations(m)
    assert any(r.action == "refresh_creative" and r.severity == "critical" for r in recs)


def test_high_frequency_recommends_audience_expansion():
    from schemas import CampaignAnalytics
    m = CampaignAnalytics(campaign_id=1, name="x", ctr=1.3, frequency=4.2, cpm=300,
                          clicks=100, results=10, cost_per_result=50, cpc=5)
    recs = recommendations(m)
    assert any(r.action == "expand_audience" for r in recs)


def test_healthy_campaign_has_good_recommendation():
    from schemas import CampaignAnalytics
    m = CampaignAnalytics(campaign_id=1, name="x", ctr=2.0, frequency=1.8, cpm=300,
                          clicks=100, results=20, cost_per_result=30, cpc=4)
    recs = recommendations(m)
    assert recs and recs[0].severity == "good"


def test_account_summary_aggregates():
    s = account_summary([_camp(cid=1), _camp(cid=2, channel="sms"), _camp(cid=3, objective="sales")])
    assert s.campaign_count == 3
    assert s.spend == pytest.approx(90_000, abs=1)
    assert len(s.campaigns) == 3
    assert s.series and len(s.series) == 14
    assert s.recommendations


def test_empty_account_summary():
    s = account_summary([])
    assert s.campaign_count == 0 and s.campaigns == []


def test_channel_distribution():
    s = account_summary([
        _camp(cid=1, channel="meta"), _camp(cid=2, channel="meta"),
        _camp(cid=3, channel="sms"),
        {"id": 4, "name": "Email промо", "channel": "email", "audience_reach": 1000,
         "estimated_cost": 30_000, "budget": 30_000, "draft": {"meta": {}}},
    ])
    by = {c.channel: c for c in s.channels}
    assert by["meta"].campaign_count == 2
    assert {"meta", "sms", "email"} <= set(by)
    assert by["meta"].label == "Meta" and by["email"].label == "Email"
    assert round(sum(c.share for c in s.channels)) == 100
    # sorted by spend descending → meta (2 campaigns) first
    assert s.channels[0].channel == "meta"

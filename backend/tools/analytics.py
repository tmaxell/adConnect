"""Campaign analytics — the single source of truth for performance reporting.

Campaigns in this prototype never actually run, so metrics are **mocked
deterministically** (seeded by campaign id) from the stored campaign draft:
budget, audience reach, channel, objective and creative. The same functions back
both the analytics page (`/api/analytics`) and the Copilot reporting agent, so the
numbers and recommendations are identical everywhere.

Metric set mirrors Meta's Insights core fields: impressions, reach, frequency,
clicks, CTR, CPC, CPM, spend, results (objective-based), cost per result, ROAS.
Recommendations follow common aggregator heuristics (CTR vs benchmark, frequency
> 3 = fatigue, CPM spikes, cost per result).
"""

from __future__ import annotations

import logging
import random
from datetime import date, timedelta

logger = logging.getLogger(__name__)

from schemas import (
    AnalyticsSummary,
    CampaignAnalytics,
    CampaignRow,
    ChannelMetric,
    DemographicMetric,
    MetricPoint,
    PlatformMetric,
    Recommendation,
)

_AGE_BANDS = ("18-24", "25-34", "35-44", "45-54", "55+")
# Typical weighting — 25-44 carries most volume.
_AGE_WEIGHTS = (0.18, 0.32, 0.26, 0.14, 0.10)
_DELTA_KEYS = ("spend", "impressions", "clicks", "ctr", "results", "cost_per_result")
from tools.forecast import _PLATFORM_LABEL, _PLATFORM_WEIGHT

_CHANNEL_LABEL = {"sms": "SMS", "email": "Email", "meta": "Meta", "whatsapp": "WhatsApp"}

# Meta-style benchmarks used for the recommendations.
_CTR_BENCHMARK = 1.15          # % — Facebook feed average
_CTR_WEAK = 0.90               # % — below this = weak creative
_CTR_STRONG = 1.80             # % — above this = strong
_FREQ_FATIGUE = 3.0            # frequency above this = audience saturation
_CPM_HIGH = 420.0             # ₽ — elevated CPM (rising costs = creative fatigue)
_SERIES_DAYS = 14

# Objective → (result label, share of clicks that become a "result").
_OBJECTIVE_RESULT: dict[str, tuple[str, float]] = {
    "awareness": ("Охват", 1.0),
    "traffic": ("Клики по ссылке", 0.92),
    "engagement": ("Вовлечения", 1.6),
    "leads": ("Лиды", 0.14),
    "sales": ("Покупки", 0.035),
}
_AVG_ORDER_VALUE = 2200.0      # ₽ — for ROAS on sales campaigns


def _seed(campaign: dict) -> random.Random:
    return random.Random(int(campaign.get("id") or 0) * 7919 + 13)


def _spend(campaign: dict) -> float:
    for key in ("estimated_cost", "budget"):
        v = campaign.get(key)
        if v:
            return float(v)
    draft = campaign.get("draft") or {}
    cost = (draft.get("cost") or {})
    return float(cost.get("budget") or 25_000)


def _distribute(total: int, days: int, rng: random.Random, trend: float) -> list[int]:
    """Split a total across days with jitter and a mild linear trend (+/-)."""
    weights = []
    for i in range(days):
        base = 1.0 + trend * (i / max(days - 1, 1) - 0.5) * 2
        weights.append(max(0.05, base * rng.uniform(0.78, 1.22)))
    s = sum(weights) or 1.0
    out = [int(total * w / s) for w in weights]
    out[-1] += total - sum(out)        # keep the sum exact
    return out


def campaign_metrics(campaign: dict) -> CampaignAnalytics:
    """Deterministic mock metrics + recommendations for one stored campaign."""
    rng = _seed(campaign)
    draft = campaign.get("draft") or {}
    meta = draft.get("meta") or {}
    channel = campaign.get("channel")
    is_network = channel == "meta"
    objective = (meta.get("objective") if is_network else None)

    spend = round(_spend(campaign), 2)
    cpm = float(draft.get("cpm") or 0) or rng.uniform(260, 360)
    impressions = int(draft.get("estimated_impressions") or 0) or int(spend / cpm * 1000)
    cpm = round(spend / impressions * 1000, 1) if impressions else round(cpm, 1)

    # CTR varies per campaign so some land below the benchmark (→ recommendations).
    ctr = round(rng.uniform(0.65, 2.25), 2)
    clicks = max(1, int(impressions * ctr / 100))
    cpc = round(spend / clicks, 1) if clicks else 0.0

    # Reach capped by the targetable audience; frequency follows.
    targetable = int(campaign.get("audience_reach") or draft.get("audience_reach") or 0)
    reach = int(impressions / rng.uniform(1.5, 2.6))
    if targetable:
        reach = min(reach, targetable)
    reach = max(reach, 1)
    frequency = round(impressions / reach, 1)

    label, rate = _OBJECTIVE_RESULT.get(objective or "", ("Переходы", 0.9))
    if channel == "whatsapp":
        label = "Диалоги"          # WhatsApp result = opened conversations
    if objective == "awareness":
        results = reach
    elif objective == "engagement":
        results = int(impressions * rate / 100 * rng.uniform(0.8, 1.2))
    else:
        results = max(1, int(clicks * rate * rng.uniform(0.85, 1.15)))
    cost_per_result = round(spend / results, 1) if results else 0.0
    conversions = results if objective in ("leads", "sales") else 0
    conversion_rate = round(conversions / clicks * 100, 1) if (conversions and clicks) else 0.0
    roas = round(results * _AVG_ORDER_VALUE / spend, 2) if (objective == "sales" and spend) else None

    series = _build_series(campaign, rng, impressions, clicks, spend, results, ctr)
    platforms = _build_platforms(meta, is_network, impressions, clicks, spend, ctr, rng)
    demographics = _build_demographics(rng, impressions, results)
    deltas = _build_deltas(rng)
    metrics = CampaignAnalytics(
        campaign_id=int(campaign.get("id") or 0),
        name=str(campaign.get("name") or "Кампания"),
        channel=channel,
        status=str(campaign.get("status") or "active"),
        objective=objective,
        result_label=label,
        spend=spend, impressions=impressions, reach=reach, frequency=frequency,
        clicks=clicks, ctr=ctr, cpc=cpc, cpm=cpm,
        results=results, cost_per_result=cost_per_result,
        conversions=conversions, conversion_rate=conversion_rate, roas=roas,
        deltas=deltas, series=series, platforms=platforms, demographics=demographics,
    )
    metrics.recommendations = recommendations(metrics)
    return metrics


def _build_series(campaign, rng, impressions, clicks, spend, results, ctr) -> list[MetricPoint]:
    # Weak CTR campaigns trend down (fatigue); strong ones trend up.
    trend = -0.35 if ctr < _CTR_WEAK else (0.3 if ctr > _CTR_STRONG else rng.uniform(-0.1, 0.1))
    imp = _distribute(impressions, _SERIES_DAYS, rng, trend)
    clk = _distribute(clicks, _SERIES_DAYS, rng, trend)
    spd = _distribute(int(spend), _SERIES_DAYS, rng, 0.0)
    res = _distribute(results, _SERIES_DAYS, rng, trend)
    start = date.today() - timedelta(days=_SERIES_DAYS - 1)
    return [
        MetricPoint(date=(start + timedelta(days=i)).isoformat(),
                    impressions=imp[i], clicks=clk[i], spend=float(spd[i]), results=res[i])
        for i in range(_SERIES_DAYS)
    ]


def _build_deltas(rng: random.Random) -> dict[str, float]:
    """% change vs the previous 14-day period (deterministic mock)."""
    out: dict[str, float] = {}
    for k in _DELTA_KEYS:
        out[k] = round(rng.uniform(-22, 34), 1)
    # Cost per result usually moves opposite to results.
    out["cost_per_result"] = round(rng.uniform(-18, 22), 1)
    return out


def _build_demographics(rng: random.Random, impressions: int, results: int) -> list[DemographicMetric]:
    rows: list[DemographicMetric] = []
    # Age bands — jitter the base weights, then normalise.
    aw = [w * rng.uniform(0.8, 1.2) for w in _AGE_WEIGHTS]
    s = sum(aw) or 1.0
    for band, w in zip(_AGE_BANDS, aw):
        share = w / s
        rows.append(DemographicMetric(dimension="age", label=band,
                                      impressions=int(impressions * share),
                                      results=int(results * share), share=round(share * 100, 1)))
    # Gender split.
    men = rng.uniform(0.4, 0.6)
    for label, share in (("Мужчины", men), ("Женщины", 1 - men)):
        rows.append(DemographicMetric(dimension="gender", label=label,
                                      impressions=int(impressions * share),
                                      results=int(results * share), share=round(share * 100, 1)))
    return rows


def _build_platforms(meta, is_network, impressions, clicks, spend, ctr, rng) -> list[PlatformMetric]:
    if not is_network:
        return []
    if meta.get("advantage_placements", True):
        places = list(_PLATFORM_WEIGHT)
    else:
        places = meta.get("placements") or ["facebook", "instagram"]
    weights = {p: _PLATFORM_WEIGHT.get(p, 0.1) for p in places}
    total = sum(weights.values()) or 1.0
    rows: list[PlatformMetric] = []
    for p in places:
        share = weights[p] / total
        p_ctr = round(max(0.3, ctr * rng.uniform(0.8, 1.2)), 2)
        p_impr = int(impressions * share)
        rows.append(PlatformMetric(
            platform=p, label=_PLATFORM_LABEL.get(p, p.title()),
            impressions=p_impr, clicks=int(p_impr * p_ctr / 100),
            spend=round(spend * share, 2), ctr=p_ctr,
        ))
    return rows


def recommendations(m: CampaignAnalytics) -> list[Recommendation]:
    """Rule-based findings + fixes, ordered by severity."""
    recs: list[Recommendation] = []
    if m.ctr < _CTR_WEAK:
        recs.append(Recommendation(
            severity="critical", title="Низкий CTR",
            detail=(f"CTR {m.ctr}% ниже среднего по Meta (~{_CTR_BENCHMARK}%). "
                    "Объявление слабо цепляет — обновите визуал и заголовок."),
            action="refresh_creative", action_label="Обновить креатив",
        ))
    if m.frequency > _FREQ_FATIGUE:
        recs.append(Recommendation(
            severity="warning", title="Высокая частота показов",
            detail=(f"Частота {m.frequency} — аудитория видит рекламу слишком часто (усталость). "
                    "Расширьте аудиторию или включите Advantage+, либо обновите креатив."),
            action="expand_audience", action_label="Расширить аудиторию",
        ))
    if m.cpm > _CPM_HIGH:
        recs.append(Recommendation(
            severity="warning", title="Высокий CPM",
            detail=(f"CPM {m.cpm} ₽ выше обычного — частый признак усталости креатива. "
                    "Попробуйте свежий вариант объявления."),
            action="refresh_creative", action_label="Обновить креатив",
        ))
    if m.cost_per_result and m.results and m.cost_per_result > (m.cpc * 12):
        recs.append(Recommendation(
            severity="warning", title=f"Дорогой результат ({m.result_label.lower()})",
            detail=(f"Цена результата {m.cost_per_result} ₽ высоковата. Уточните таргетинг "
                    "или сместите бюджет на лучшие площадки."),
            action="adjust_targeting", action_label="Уточнить аудиторию",
        ))
    if m.ctr >= _CTR_STRONG and m.frequency <= _FREQ_FATIGUE:
        recs.append(Recommendation(
            severity="good", title="Кампания работает хорошо",
            detail=(f"CTR {m.ctr}% выше среднего при здоровой частоте {m.frequency}. "
                    "Можно увеличить бюджет, чтобы масштабировать результат."),
            action="scale_budget", action_label="Увеличить бюджет",
        ))
    if not recs:
        recs.append(Recommendation(
            severity="good", title="Показатели в норме",
            detail=(f"CTR {m.ctr}%, частота {m.frequency}, цена результата {m.cost_per_result} ₽ — "
                    "в пределах нормы. Продолжайте наблюдать."),
        ))
    order = {"critical": 0, "warning": 1, "good": 2}
    return sorted(recs, key=lambda r: order[r.severity])


def _health(m: CampaignAnalytics) -> str:
    sev = {r.severity for r in m.recommendations}
    return "critical" if "critical" in sev else ("warning" if "warning" in sev else "good")


def format_report(m: CampaignAnalytics) -> str:
    """Human-readable performance report for a campaign (used by the Copilot bot)."""
    lines = [
        f"**{m.name}** — отчёт по эффективности",
        "",
        f"- Расход: **{m.spend:,.0f} ₽**".replace(",", " "),
        f"- Показы: {m.impressions:,}".replace(",", " ") + f" · Охват: {m.reach:,}".replace(",", " "),
        f"- Частота: {m.frequency}",
        f"- Клики: {m.clicks:,}".replace(",", " ") + f" · CTR: {m.ctr}% · CPC: {m.cpc} ₽",
        f"- CPM: {m.cpm} ₽",
        f"- {m.result_label}: {m.results:,}".replace(",", " ") + f" · Цена: {m.cost_per_result} ₽",
    ]
    if m.roas is not None:
        lines.append(f"- ROAS: {m.roas}×")
    lines.append("")
    lines.append("Рекомендации:")
    for r in m.recommendations:
        mark = {"critical": "🔴", "warning": "🟡", "good": "🟢"}[r.severity]
        lines.append(f"{mark} **{r.title}.** {r.detail}")
    return "\n".join(lines)


def format_summary(s: AnalyticsSummary) -> str:
    """Human-readable account-level report (used by the Copilot bot)."""
    if not s.campaign_count:
        return "Пока нет запущенных кампаний — соберите первую, и здесь появится аналитика."
    lines = [
        f"**Сводка по {s.campaign_count} кампаниям**",
        "",
        f"- Расход: **{s.spend:,.0f} ₽**".replace(",", " "),
        f"- Показы: {s.impressions:,}".replace(",", " ") + f" · Клики: {s.clicks:,}".replace(",", " ") + f" · CTR: {s.ctr}%",
        f"- Результаты: {s.results:,}".replace(",", " ") + f" · Цена результата: {s.cost_per_result} ₽",
        "",
    ]
    for r in s.recommendations:
        mark = {"critical": "🔴", "warning": "🟡", "good": "🟢"}[r.severity]
        lines.append(f"{mark} {r.detail}")
    return "\n".join(lines)


async def advice_text(m: CampaignAnalytics) -> str:
    """LLM-phrased fix suggestions grounded in the rule-based findings.

    Falls back to a deterministic summary of the recommendations when no LLM is
    configured, so the "get suggestions" button always returns something useful.
    """
    findings = "; ".join(f"{r.title}: {r.detail}" for r in m.recommendations)
    fallback = " ".join(
        f"• {r.title}: {r.detail}" + (f" → {r.action_label}." if r.action_label else "")
        for r in m.recommendations
    )
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        from llm import get_llm

        llm = get_llm(temperature=0.3)
        sys = (
            "Ты — AdConnect Copilot, помощник по рекламе. На основе метрик и выявленных "
            "проблем дай 2–4 коротких практических совета на русском, как улучшить кампанию "
            "(что именно поменять: креатив, аудитория, бюджет). Без воды, маркированным списком."
        )
        ctx = (
            f"Кампания «{m.name}» (цель: {m.objective or '—'}). "
            f"Расход {m.spend} ₽, показы {m.impressions}, CTR {m.ctr}%, частота {m.frequency}, "
            f"CPM {m.cpm} ₽, {m.result_label} {m.results}, цена результата {m.cost_per_result} ₽. "
            f"Выявлено: {findings}."
        )
        result = await llm.ainvoke([SystemMessage(content=sys), HumanMessage(content=ctx)])
        raw = getattr(result, "content", "")
        text = raw if isinstance(raw, str) else str(raw)
        if text.strip():
            return text.strip()
    except Exception as exc:
        logger.info("advice_text llm skipped: %s", exc)
    return fallback


def account_summary(campaigns: list[dict]) -> AnalyticsSummary:
    """Aggregate metrics + per-campaign rows + account-level recommendations."""
    metrics = [campaign_metrics(c) for c in campaigns]
    summary = AnalyticsSummary(campaign_count=len(metrics))
    if not metrics:
        return summary

    summary.spend = round(sum(m.spend for m in metrics), 2)
    summary.impressions = sum(m.impressions for m in metrics)
    summary.reach = sum(m.reach for m in metrics)
    summary.clicks = sum(m.clicks for m in metrics)
    summary.results = sum(m.results for m in metrics)
    summary.conversions = sum(m.conversions for m in metrics)
    summary.ctr = round(summary.clicks / summary.impressions * 100, 2) if summary.impressions else 0.0
    summary.cpc = round(summary.spend / summary.clicks, 1) if summary.clicks else 0.0
    summary.cpm = round(summary.spend / summary.impressions * 1000, 1) if summary.impressions else 0.0
    summary.cost_per_result = round(summary.spend / summary.results, 1) if summary.results else 0.0

    # Aggregate the daily series across campaigns (aligned by date).
    by_date: dict[str, MetricPoint] = {}
    for m in metrics:
        for p in m.series:
            agg = by_date.get(p.date)
            if agg is None:
                by_date[p.date] = MetricPoint(date=p.date, impressions=p.impressions,
                                              clicks=p.clicks, spend=p.spend, results=p.results)
            else:
                agg.impressions += p.impressions
                agg.clicks += p.clicks
                agg.spend = round(agg.spend + p.spend, 2)
                agg.results += p.results
    summary.series = [by_date[d] for d in sorted(by_date)]

    # Aggregate platform breakdown.
    by_platform: dict[str, PlatformMetric] = {}
    for m in metrics:
        for pf in m.platforms:
            agg = by_platform.get(pf.platform)
            if agg is None:
                by_platform[pf.platform] = PlatformMetric(**pf.model_dump())
            else:
                agg.impressions += pf.impressions
                agg.clicks += pf.clicks
                agg.spend = round(agg.spend + pf.spend, 2)
    for pf in by_platform.values():
        pf.ctr = round(pf.clicks / pf.impressions * 100, 2) if pf.impressions else 0.0
    summary.platforms = sorted(by_platform.values(), key=lambda x: -x.impressions)

    # Distribution by channel (SMS / Email / Meta …).
    by_channel: dict[str, ChannelMetric] = {}
    for m in metrics:
        ch = m.channel or "other"
        row = by_channel.get(ch)
        if row is None:
            row = by_channel[ch] = ChannelMetric(channel=ch, label=_CHANNEL_LABEL.get(ch, ch.title()))
        row.campaign_count += 1
        row.spend = round(row.spend + m.spend, 2)
        row.impressions += m.impressions
        row.clicks += m.clicks
        row.results += m.results
    for row in by_channel.values():
        row.share = round(row.spend / summary.spend * 100, 1) if summary.spend else 0.0
    summary.channels = sorted(by_channel.values(), key=lambda x: -x.spend)

    # Period-over-period deltas: spend-weighted average of per-campaign deltas.
    wsum = summary.spend or 1.0
    for k in _DELTA_KEYS:
        summary.deltas[k] = round(sum(m.deltas.get(k, 0.0) * m.spend for m in metrics) / wsum, 1)

    # Demographics aggregated across campaigns (recompute share within dimension).
    by_demo: dict[tuple[str, str], DemographicMetric] = {}
    for m in metrics:
        for d in m.demographics:
            agg = by_demo.get((d.dimension, d.label))
            if agg is None:
                by_demo[(d.dimension, d.label)] = DemographicMetric(
                    dimension=d.dimension, label=d.label, impressions=d.impressions, results=d.results)
            else:
                agg.impressions += d.impressions
                agg.results += d.results
    for dim in ("age", "gender"):
        rows = [d for (dd, _), d in by_demo.items() if dd == dim]
        tot = sum(d.impressions for d in rows) or 1
        for d in rows:
            d.share = round(d.impressions / tot * 100, 1)
    order = {b: i for i, b in enumerate(_AGE_BANDS)}
    summary.demographics = sorted(
        by_demo.values(),
        key=lambda d: (d.dimension != "age", order.get(d.label, 99), -d.impressions),
    )

    summary.campaigns = [
        CampaignRow(
            campaign_id=m.campaign_id, name=m.name, channel=m.channel, status=m.status,
            objective=m.objective, result_label=m.result_label, spend=m.spend,
            impressions=m.impressions, clicks=m.clicks, ctr=m.ctr, results=m.results,
            cost_per_result=m.cost_per_result, health=_health(m),  # type: ignore[arg-type]
        )
        for m in metrics
    ]

    # Account-level recommendations: summarise campaigns that need attention.
    flagged = [m for m in metrics if _health(m) != "good"]
    if flagged:
        names = ", ".join(f"«{m.name}»" for m in flagged[:3])
        summary.recommendations.append(Recommendation(
            severity="warning", title=f"Требуют внимания: {len(flagged)} из {len(metrics)}",
            detail=f"Откройте кампании {names} — там есть просадки (низкий CTR / усталость креатива).",
        ))
    else:
        summary.recommendations.append(Recommendation(
            severity="good", title="Все кампании в норме",
            detail="Просадок по CTR и частоте не обнаружено. Рассмотрите масштабирование лучших.",
        ))
    return summary

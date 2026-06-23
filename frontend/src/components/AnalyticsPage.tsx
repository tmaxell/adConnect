/**
 * AnalyticsPage — performance dashboard over the Statistics screen.
 *
 * Summary across all campaigns (KPIs + daily chart + platform split + per-campaign
 * table), drill-down into one campaign, and AI recommendations with a button that
 * asks the Copilot for fix suggestions. Same data as the bot (one backend source).
 */

import { useCallback, useEffect, useState } from "react";
import {
  getAnalyticsSummary,
  getCampaignAdvice,
  getCampaignAnalytics,
} from "../api/chatApi";
import { useChatWorkspaceStore } from "../chat-workspace/store/chatWorkspaceStore";
import type {
  AnalyticsSummary,
  CampaignAnalytics,
  ChannelMetric,
  CampaignRow,
  DemographicMetric,
  MetricPoint,
  PlatformMetric,
  Recommendation,
  Severity,
} from "../types/analytics";

const PLATFORM_COLOR: Record<string, string> = {
  facebook: "#1877F2", instagram: "#E4405F", whatsapp: "#25D366",
  messenger: "#A033FF", audience_network: "#0866FF",
};
const OBJECTIVE_LABEL: Record<string, string> = {
  awareness: "Узнаваемость", traffic: "Трафик", engagement: "Вовлечённость",
  leads: "Лиды", sales: "Продажи",
};
const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", email: "Email", meta: "Meta", whatsapp: "WhatsApp" };
const CHANNEL_COLOR: Record<string, string> = {
  meta: "#5257ff", sms: "#0ea5e9", email: "#f59e0b", whatsapp: "#25D366", other: "#94a3b8",
};

const num = (n: number) => n.toLocaleString("ru-RU").replace(/,/g, " ");
const money = (n: number) => `${num(Math.round(n))} ₽`;

/** Delta chip vs previous period; colour respects whether up is good. */
function DeltaChip({ delta, betterWhenUp = true }: { delta?: number; betterWhenUp?: boolean }) {
  if (delta == null || !isFinite(delta)) return null;
  const up = delta >= 0;
  const good = up === betterWhenUp;
  return (
    <span className={`ana-delta ana-delta-${good ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(delta)}%
    </span>
  );
}

function KpiCard({ label, value, sub, delta, betterWhenUp }: {
  label: string; value: string; sub?: string; delta?: number; betterWhenUp?: boolean;
}) {
  return (
    <div className="ana-kpi">
      <div className="ana-kpi-label">{label}</div>
      <div className="ana-kpi-value">{value}</div>
      <div className="ana-kpi-foot">
        {sub && <span className="ana-kpi-sub">{sub}</span>}
        <DeltaChip delta={delta} betterWhenUp={betterWhenUp} />
      </div>
    </div>
  );
}

/** Compact number for axis labels: 10184 → "10к", 4980 → "5,0к". */
function kfmt(v: number): string {
  if (v >= 1000) {
    const n = v / 1000;
    return (n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(".", ",")) + "к";
  }
  return String(Math.round(v));
}
/** Round a max up to a "nice" axis bound (1/2/2.5/5/10 × 10ⁿ). */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

type TrendMetric = "impressions" | "clicks" | "spend" | "results" | "ctr";
const TREND_METRICS: Array<{ id: TrendMetric; label: string; color: string; line?: boolean; pct?: boolean; money?: boolean }> = [
  { id: "impressions", label: "Показы", color: "#6366f1" },
  { id: "clicks", label: "Клики", color: "#22c55e" },
  { id: "spend", label: "Расход", color: "#0ea5e9", money: true },
  { id: "results", label: "Результаты", color: "#a855f7" },
  { id: "ctr", label: "CTR", color: "#f59e0b", line: true, pct: true },
];

/**
 * Daily-trend chart with a metric selector — each metric on its own properly
 * scaled axis (bars for counts/spend, a line for CTR), with the period average
 * and the change vs the previous period. Mirrors aggregator/Meta reporting.
 */
function TrendChart({ series, deltas }: { series: MetricPoint[]; deltas?: Record<string, number> }) {
  const [metric, setMetric] = useState<TrendMetric>("impressions");
  if (series.length < 2) return <div className="ana-chart-empty">Недостаточно данных</div>;
  const def = TREND_METRICS.find((m) => m.id === metric)!;
  const valueOf = (p: MetricPoint) =>
    metric === "ctr" ? (p.impressions ? (p.clicks / p.impressions) * 100 : 0) : (p[metric] as number);
  const vals = series.map(valueOf);

  const W = 720, H = 240, padL = 48, padR = 14, padT = 18, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = series.length;
  const max = niceMax(Math.max(...vals, def.pct ? 1 : 1));
  const slot = innerW / n;
  const barW = slot * 0.55;
  const cx = (i: number) => padL + slot * i + slot / 2;
  const y = (v: number) => padT + innerH * (1 - v / max);
  const grid = [0, 0.5, 1];
  const linePts = series.map((_, i) => `${cx(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(" ");
  const ticks = [0, Math.floor((n - 1) / 2), n - 1];
  const avg = vals.reduce((s, v) => s + v, 0) / n;
  const avgLabel = def.pct ? `${avg.toFixed(2)}%` : def.money ? money(avg) : num(Math.round(avg));
  const axisLabel = (v: number) => (def.pct ? `${v.toFixed(0)}%` : kfmt(v));

  return (
    <div className="ana-chart">
      <div className="ana-chart-head">
        <div className="ana-metric-tabs">
          {TREND_METRICS.map((m) => (
            <button key={m.id} type="button" className={`ana-metric-tab${metric === m.id ? " on" : ""}`}
              onClick={() => setMetric(m.id)}>{m.label}</button>
          ))}
        </div>
        <div className="ana-chart-avg">
          {def.label}: <b>{avgLabel}</b>/день <DeltaChip delta={deltas?.[metric]} betterWhenUp />
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ana-chart-svg" role="img">
        {grid.map((g) => {
          const gy = padT + innerH * (1 - g);
          return (
            <g key={g}>
              <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="#eef2f7" strokeWidth="1" />
              <text x={padL - 8} y={gy + 4} textAnchor="end" className="ana-axis">{axisLabel(max * g)}</text>
            </g>
          );
        })}
        {def.line ? (
          <>
            <polyline points={linePts} fill="none" stroke={def.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {series.map((_, i) => <circle key={i} cx={cx(i)} cy={y(vals[i])} r="2.6" fill={def.color} />)}
          </>
        ) : (
          series.map((_, i) => (
            <rect key={i} x={cx(i) - barW / 2} y={y(vals[i])} width={barW}
              height={Math.max(0, padT + innerH - y(vals[i]))} rx="2" fill={def.color} opacity="0.85" />
          ))
        )}
        {ticks.map((t) => (
          <text key={t} x={cx(t)} y={H - 8} textAnchor="middle" className="ana-axis">{series[t].date.slice(5)}</text>
        ))}
      </svg>
    </div>
  );
}

/** Funnel: Показы → Клики → Результаты with step conversion rates. */
function Funnel({ impressions, clicks, results, resultLabel }: {
  impressions: number; clicks: number; results: number; resultLabel: string;
}) {
  if (!impressions) return null;
  const stages = [
    { label: "Показы", value: impressions, color: "#6366f1" },
    { label: "Клики", value: clicks, color: "#22c55e" },
    { label: resultLabel, value: results, color: "#a855f7" },
  ];
  const ctr = impressions ? (clicks / impressions) * 100 : 0;
  const cr = clicks ? (results / clicks) * 100 : 0;
  return (
    <div className="ana-funnel">
      {stages.map((s, i) => (
        <div key={s.label} className="ana-funnel-stage">
          <div className="ana-funnel-bar-row">
            <div className="ana-funnel-bar" style={{ width: `${(s.value / impressions) * 100}%`, background: s.color }} />
            <span className="ana-funnel-val">{num(s.value)}</span>
          </div>
          <div className="ana-funnel-label">{s.label}</div>
          {i < stages.length - 1 && (
            <div className="ana-funnel-step">↓ {(i === 0 ? ctr : cr).toFixed(2)}% {i === 0 ? "CTR" : "конверсия в результат"}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Age + gender breakdown bars (Meta-style demographics). */
function Demographics({ demographics }: { demographics: DemographicMetric[] }) {
  const ages = demographics.filter((d) => d.dimension === "age");
  const genders = demographics.filter((d) => d.dimension === "gender");
  if (!ages.length && !genders.length) return null;
  const ageMax = Math.max(...ages.map((a) => a.share), 1);
  return (
    <div className="ana-demo">
      {ages.length > 0 && (
        <div className="ana-demo-block">
          <div className="ana-demo-title">Возраст</div>
          {ages.map((a) => (
            <div key={a.label} className="ana-demo-row">
              <span className="ana-demo-key">{a.label}</span>
              <div className="ana-bar-track"><div className="ana-bar" style={{ width: `${(a.share / ageMax) * 100}%`, background: "#6366f1" }} /></div>
              <span className="ana-demo-val">{a.share}%</span>
            </div>
          ))}
        </div>
      )}
      {genders.length > 0 && (
        <div className="ana-demo-block">
          <div className="ana-demo-title">Пол</div>
          <div className="ana-gender">
            {genders.map((g) => (
              <div key={g.label} className="ana-gender-seg" style={{ width: `${g.share}%`, background: g.label === "Мужчины" ? "#0ea5e9" : "#ec4899" }}>
                <span className="ana-gender-lbl">{g.label} · {g.share}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlatformBars({ platforms }: { platforms: PlatformMetric[] }) {
  if (!platforms.length) return null;
  const max = Math.max(...platforms.map((p) => p.impressions), 1);
  return (
    <div className="ana-platforms">
      {platforms.map((p) => (
        <div key={p.platform} className="ana-platform-row">
          <span className="ana-platform-name">
            <i className="ana-sq" style={{ background: PLATFORM_COLOR[p.platform] ?? "#94a3b8" }} />
            {p.label}
          </span>
          <div className="ana-bar-track">
            <div className="ana-bar" style={{ width: `${(p.impressions / max) * 100}%`, background: PLATFORM_COLOR[p.platform] ?? "#94a3b8" }} />
          </div>
          <span className="ana-platform-val">{num(p.impressions)} · CTR {p.ctr}%</span>
        </div>
      ))}
    </div>
  );
}

/** Channel-distribution donut (by spend share) + legend. */
function ChannelDonut({ channels }: { channels: ChannelMetric[] }) {
  if (!channels.length) return null;
  const R = 54, SW = 22, C = 2 * Math.PI * R;
  let offset = 0;
  const segs = channels.map((c) => {
    const len = (c.share / 100) * C;
    const seg = { c, dash: `${len} ${C - len}`, off: -offset, color: CHANNEL_COLOR[c.channel] ?? CHANNEL_COLOR.other };
    offset += len;
    return seg;
  });
  return (
    <div className="ana-channels">
      <svg viewBox="0 0 140 140" className="ana-donut">
        <g transform="rotate(-90 70 70)">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#eef2f7" strokeWidth={SW} />
          {segs.map((s) => (
            <circle key={s.c.channel} cx="70" cy="70" r={R} fill="none" stroke={s.color}
              strokeWidth={SW} strokeDasharray={s.dash} strokeDashoffset={s.off} />
          ))}
        </g>
        <text x="70" y="66" textAnchor="middle" className="ana-donut-num">{channels.length}</text>
        <text x="70" y="84" textAnchor="middle" className="ana-donut-cap">канала</text>
      </svg>
      <div className="ana-channel-legend">
        {channels.map((c) => (
          <div key={c.channel} className="ana-channel-row">
            <span className="ana-channel-name">
              <i className="ana-sq" style={{ background: CHANNEL_COLOR[c.channel] ?? CHANNEL_COLOR.other }} />
              {c.label}
            </span>
            <span className="ana-channel-share">{c.share}%</span>
            <span className="ana-channel-val">{money(c.spend)} · {c.campaign_count} камп. · {num(c.results)} рез.</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SEV_ICON: Record<Severity, string> = { critical: "🔴", warning: "🟡", good: "🟢" };

function RecoCard({ rec }: { rec: Recommendation }) {
  return (
    <div className={`ana-reco ana-reco-${rec.severity}`}>
      <div className="ana-reco-head">
        <span className="ana-reco-icon">{SEV_ICON[rec.severity]}</span>
        <span className="ana-reco-title">{rec.title}</span>
        {rec.action_label && <span className="ana-reco-fix">{rec.action_label}</span>}
      </div>
      <div className="ana-reco-detail">{rec.detail}</div>
    </div>
  );
}

function CampaignDetail({ campaignId, onBack }: { campaignId: number; onBack: () => void }) {
  const { sendMessage } = useChatWorkspaceStore();
  const [data, setData] = useState<CampaignAnalytics | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setAdvice(null);
    getCampaignAnalytics(campaignId).then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, [campaignId]);

  const askCopilot = useCallback(async () => {
    setAdviceLoading(true);
    try {
      const res = await getCampaignAdvice(campaignId);
      setAdvice(res.advice);
    } finally {
      setAdviceLoading(false);
    }
  }, [campaignId]);

  if (!data) return <div className="ana-loading">Загрузка…</div>;
  return (
    <div className="ana-detail">
      <div className="ana-detail-head">
        <button type="button" className="ana-back" onClick={onBack}>← Все кампании</button>
        <div>
          <h2 className="ana-title">{data.name}</h2>
          <div className="ana-subtitle">
            {data.channel ? CHANNEL_LABEL[data.channel] ?? data.channel : "—"}
            {data.objective ? ` · ${OBJECTIVE_LABEL[data.objective] ?? data.objective}` : ""}
          </div>
        </div>
      </div>

      <div className="ana-kpis">
        <KpiCard label="Расход" value={money(data.spend)} delta={data.deltas?.spend} />
        <KpiCard label="Показы" value={num(data.impressions)} sub={`Охват ${num(data.reach)}`} delta={data.deltas?.impressions} />
        <KpiCard label="Частота" value={`${data.frequency}`} sub="показов на человека" />
        <KpiCard label="Клики" value={num(data.clicks)} sub={`CTR ${data.ctr}%`} delta={data.deltas?.clicks} />
        <KpiCard label="CPC / CPM" value={`${data.cpc} / ${data.cpm} ₽`} />
        <KpiCard label={data.result_label} value={num(data.results)} sub={`${data.cost_per_result} ₽ за результат`} delta={data.deltas?.results} />
        {data.roas != null && <KpiCard label="ROAS" value={`${data.roas}×`} />}
      </div>

      <div className="ana-section-title">Воронка</div>
      <div className="ana-card-box">
        <Funnel impressions={data.impressions} clicks={data.clicks} results={data.results} resultLabel={data.result_label} />
      </div>

      <div className="ana-section-title">Динамика за 14 дней</div>
      <TrendChart series={data.series} deltas={data.deltas} />

      {data.platforms.length > 0 && (
        <>
          <div className="ana-section-title">Площадки</div>
          <PlatformBars platforms={data.platforms} />
        </>
      )}

      {data.demographics.length > 0 && (
        <>
          <div className="ana-section-title">Демография</div>
          <div className="ana-card-box"><Demographics demographics={data.demographics} /></div>
        </>
      )}

      <div className="ana-reco-head-row">
        <div className="ana-section-title">Рекомендации</div>
        <button type="button" className="ana-cta" onClick={askCopilot} disabled={adviceLoading}>
          {adviceLoading ? "Copilot думает…" : "✦ Получить предложения от Copilot"}
        </button>
      </div>
      <div className="ana-recos">
        {data.recommendations.map((r, i) => <RecoCard key={i} rec={r} />)}
      </div>
      {advice && (
        <div className="ana-advice">
          <div className="ana-advice-head">✦ AdConnect Copilot советует</div>
          <div className="ana-advice-body">{advice}</div>
          <button type="button" className="ana-advice-link"
            onClick={() => void sendMessage(`Как улучшить кампанию «${data.name}»? Что поменять в креативе и аудитории?`)}>
            Обсудить с Copilot в чате →
          </button>
        </div>
      )}
    </div>
  );
}

function Summary({ summary, onSelect }: { summary: AnalyticsSummary; onSelect: (id: number) => void }) {
  if (!summary.campaign_count) {
    return (
      <div className="ana-empty">
        <div className="ana-empty-title">Пока нет данных по кампаниям</div>
        <div className="ana-empty-sub">Соберите кампанию — и здесь появится аналитика с графиками и рекомендациями.</div>
      </div>
    );
  }
  return (
    <>
      <div className="ana-kpis">
        <KpiCard label="Расход" value={money(summary.spend)} sub={`${summary.campaign_count} кампаний`} delta={summary.deltas?.spend} />
        <KpiCard label="Показы" value={num(summary.impressions)} sub={`Охват ${num(summary.reach)}`} delta={summary.deltas?.impressions} />
        <KpiCard label="Клики" value={num(summary.clicks)} sub={`CTR ${summary.ctr}%`} delta={summary.deltas?.clicks} />
        <KpiCard label="CPC / CPM" value={`${summary.cpc} / ${summary.cpm} ₽`} />
        <KpiCard label="Результаты" value={num(summary.results)} sub={`${summary.cost_per_result} ₽ за результат`} delta={summary.deltas?.results} />
      </div>

      {summary.recommendations.map((r, i) => <RecoCard key={i} rec={r} />)}

      <div className="ana-section-title">Воронка (все кампании)</div>
      <div className="ana-card-box">
        <Funnel impressions={summary.impressions} clicks={summary.clicks} results={summary.results} resultLabel="Результаты" />
      </div>

      {summary.channels.length > 0 && (
        <>
          <div className="ana-section-title">Распределение по каналам</div>
          <div className="ana-card-box"><ChannelDonut channels={summary.channels} /></div>
        </>
      )}

      <div className="ana-section-title">Динамика за 14 дней (все кампании)</div>
      <TrendChart series={summary.series} deltas={summary.deltas} />

      {summary.platforms.length > 0 && (
        <>
          <div className="ana-section-title">Площадки</div>
          <PlatformBars platforms={summary.platforms} />
        </>
      )}

      {summary.demographics.length > 0 && (
        <>
          <div className="ana-section-title">Демография</div>
          <div className="ana-card-box"><Demographics demographics={summary.demographics} /></div>
        </>
      )}

      <div className="ana-section-title">Кампании</div>
      <CampaignsTable rows={summary.campaigns} onSelect={onSelect} />
    </>
  );
}

type SortKey = "name" | "channel" | "spend" | "impressions" | "ctr" | "results" | "cost_per_result";

function CampaignsTable({ rows, onSelect }: { rows: CampaignRow[]; onSelect: (id: number) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "spend", dir: -1 });
  const sorted = [...rows].sort((a, b) => {
    const va = a[sort.key], vb = b[sort.key];
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * sort.dir;
    return String(va ?? "").localeCompare(String(vb ?? "")) * sort.dir;
  });
  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const cols: Array<[SortKey, string]> = [
    ["name", "Кампания"], ["channel", "Канал"], ["spend", "Расход"],
    ["impressions", "Показы"], ["ctr", "CTR"], ["results", "Результаты"], ["cost_per_result", "Цена"],
  ];
  return (
    <div className="ana-table">
      <div className="ana-tr ana-th">
        {cols.map(([key, label]) => (
          <button key={key} type="button" className="ana-th-cell" onClick={() => toggle(key)}>{label}{arrow(key)}</button>
        ))}
      </div>
      {sorted.map((c) => (
        <button key={c.campaign_id} type="button" className="ana-tr ana-row" onClick={() => onSelect(c.campaign_id)}>
          <span className="ana-row-name"><i className={`ana-health ana-health-${c.health}`} />{c.name}</span>
          <span>{c.channel ? CHANNEL_LABEL[c.channel] ?? c.channel : "—"}</span>
          <span>{money(c.spend)}</span>
          <span>{num(c.impressions)}</span>
          <span>{c.ctr}%</span>
          <span>{num(c.results)}</span>
          <span>{c.cost_per_result} ₽</span>
        </button>
      ))}
    </div>
  );
}

export function AnalyticsPage() {
  const { analyticsCampaignId, setView } = useChatWorkspaceStore();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);

  useEffect(() => {
    let alive = true;
    getAnalyticsSummary().then((s) => { if (alive) setSummary(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div className="ana">
      <div className="ana-header">
        <h1 className="ana-h1">Аналитика</h1>
        <p className="ana-h1-sub">Сводка по кампаниям, динамика и рекомендации Copilot</p>
      </div>
      {analyticsCampaignId != null ? (
        <CampaignDetail campaignId={analyticsCampaignId} onBack={() => setView("analytics", null)} />
      ) : summary ? (
        <Summary summary={summary} onSelect={(id) => setView("analytics", id)} />
      ) : (
        <div className="ana-loading">Загрузка…</div>
      )}
    </div>
  );
}

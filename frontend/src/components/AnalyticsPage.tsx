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
const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", email: "Email", meta: "Meta" };
const CHANNEL_COLOR: Record<string, string> = {
  meta: "#5257ff", sms: "#0ea5e9", email: "#f59e0b", other: "#94a3b8",
};

const num = (n: number) => n.toLocaleString("ru-RU").replace(/,/g, " ");
const money = (n: number) => `${num(Math.round(n))} ₽`;

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ana-kpi">
      <div className="ana-kpi-label">{label}</div>
      <div className="ana-kpi-value">{value}</div>
      {sub && <div className="ana-kpi-sub">{sub}</div>}
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

/**
 * Daily-trend chart: impressions as bars (left axis, with gridlines) and clicks as
 * a line on a separate right axis — so the two very different scales each read
 * clearly instead of overlapping as look-alike normalized curves.
 */
function TrendChart({ series }: { series: MetricPoint[] }) {
  if (series.length < 2) return <div className="ana-chart-empty">Недостаточно данных</div>;
  const W = 720, H = 240, padL = 46, padR = 46, padT = 18, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = series.length;
  const imprMax = niceMax(Math.max(...series.map((p) => p.impressions), 1));
  const clickMax = niceMax(Math.max(...series.map((p) => p.clicks), 1));
  const slot = innerW / n;
  const barW = slot * 0.55;
  const cx = (i: number) => padL + slot * i + slot / 2;
  const yI = (v: number) => padT + innerH * (1 - v / imprMax);
  const yC = (v: number) => padT + innerH * (1 - v / clickMax);
  const grid = [0, 0.5, 1];
  const clicksLine = series.map((p, i) => `${cx(i).toFixed(1)},${yC(p.clicks).toFixed(1)}`).join(" ");
  const ticks = [0, Math.floor((n - 1) / 2), n - 1];
  const avg = (k: "impressions" | "clicks") => Math.round(series.reduce((s, p) => s + p[k], 0) / n);

  return (
    <div className="ana-chart">
      <div className="ana-chart-legend">
        <span><i className="ana-barmark" /> Показы · {num(avg("impressions"))}/день в среднем</span>
        <span><i className="ana-dot" style={{ background: "#22c55e" }} /> Клики · {num(avg("clicks"))}/день в среднем</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ana-chart-svg" role="img">
        {grid.map((g) => {
          const y = padT + innerH * (1 - g);
          return (
            <g key={g}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef2f7" strokeWidth="1" />
              <text x={padL - 8} y={y + 4} textAnchor="end" className="ana-axis ana-axis-l">{kfmt(imprMax * g)}</text>
              <text x={W - padR + 8} y={y + 4} textAnchor="start" className="ana-axis ana-axis-r">{kfmt(clickMax * g)}</text>
            </g>
          );
        })}
        {series.map((p, i) => (
          <rect key={i} x={cx(i) - barW / 2} y={yI(p.impressions)} width={barW}
            height={Math.max(0, padT + innerH - yI(p.impressions))} rx="2" fill="#c7cdfb" />
        ))}
        <polyline points={clicksLine} fill="none" stroke="#22c55e" strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" />
        {series.map((p, i) => <circle key={i} cx={cx(i)} cy={yC(p.clicks)} r="2.6" fill="#22c55e" />)}
        {ticks.map((t) => (
          <text key={t} x={cx(t)} y={H - 8} textAnchor="middle" className="ana-axis">{series[t].date.slice(5)}</text>
        ))}
      </svg>
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
        <KpiCard label="Расход" value={money(data.spend)} />
        <KpiCard label="Показы" value={num(data.impressions)} sub={`Охват ${num(data.reach)}`} />
        <KpiCard label="Частота" value={`${data.frequency}`} sub="показов на человека" />
        <KpiCard label="Клики" value={num(data.clicks)} sub={`CTR ${data.ctr}%`} />
        <KpiCard label="CPC / CPM" value={`${data.cpc} / ${data.cpm} ₽`} />
        <KpiCard label={data.result_label} value={num(data.results)} sub={`${data.cost_per_result} ₽ за результат`} />
        {data.roas != null && <KpiCard label="ROAS" value={`${data.roas}×`} />}
      </div>

      <div className="ana-section-title">Динамика за 14 дней</div>
      <TrendChart series={data.series} />

      {data.platforms.length > 0 && (
        <>
          <div className="ana-section-title">Площадки</div>
          <PlatformBars platforms={data.platforms} />
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
        <KpiCard label="Расход" value={money(summary.spend)} sub={`${summary.campaign_count} кампаний`} />
        <KpiCard label="Показы" value={num(summary.impressions)} sub={`Охват ${num(summary.reach)}`} />
        <KpiCard label="Клики" value={num(summary.clicks)} sub={`CTR ${summary.ctr}%`} />
        <KpiCard label="CPC / CPM" value={`${summary.cpc} / ${summary.cpm} ₽`} />
        <KpiCard label="Результаты" value={num(summary.results)} sub={`${summary.cost_per_result} ₽ за результат`} />
      </div>

      {summary.recommendations.map((r, i) => <RecoCard key={i} rec={r} />)}

      {summary.channels.length > 0 && (
        <>
          <div className="ana-section-title">Распределение по каналам</div>
          <div className="ana-card-box"><ChannelDonut channels={summary.channels} /></div>
        </>
      )}

      <div className="ana-section-title">Динамика за 14 дней (все кампании)</div>
      <TrendChart series={summary.series} />

      {summary.platforms.length > 0 && (
        <>
          <div className="ana-section-title">Площадки</div>
          <PlatformBars platforms={summary.platforms} />
        </>
      )}

      <div className="ana-section-title">Кампании</div>
      <div className="ana-table">
        <div className="ana-tr ana-th">
          <span>Кампания</span><span>Канал</span><span>Расход</span>
          <span>Показы</span><span>CTR</span><span>Результаты</span><span>Цена</span>
        </div>
        {summary.campaigns.map((c) => (
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
    </>
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

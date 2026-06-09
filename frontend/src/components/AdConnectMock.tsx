/**
 * AdConnectMock — статичный CSS/SVG-макет интерфейса продукта Eastwind AdConnect.
 * Воссоздан по экранам из adConnect/screens (Ad Campaigns + боковое меню + топбар).
 *
 * Это фоновый «основной экран» продукта, поверх которого работает плавающий
 * AI-виджет (FloatingWidget). Логики нет — чистая визуальная реконструкция.
 */

import { useEffect, useState } from "react";
import { listCampaigns, type CampaignSummary } from "../api/chatApi";
import { useChatWorkspaceStore } from "../chat-workspace/store/chatWorkspaceStore";
import { CampaignWizard } from "./CampaignWizard";
import { LogoFull } from "./Logo";

const USER_EMAIL = "ivani_gp@starcorp.com";

// ── Demo-данные списка кампаний ───────────────────────────────────────────────

interface CampaignRow {
  name: string;
  id: string;
  created: string;
  period: string;
  channel: string;
  price: string;
  status: "moderation" | "active" | "draft";
}

const STATUS_META: Record<CampaignRow["status"], { label: string; className: string }> = {
  moderation: { label: "Under moderation", className: "ac-pill-moderation" },
  active: { label: "Active", className: "ac-pill-active" },
  draft: { label: "Draft", className: "ac-pill-draft" },
};

const SMB_CAMPAIGNS: Array<{ name: string; channel: string; price: string }> = [
  { name: "Фитнес-клуб «Энергия» — весенний набор", channel: "SMS", price: "25 000 ₽" },
  { name: "Кофейня «Бариста» — акция на завтраки", channel: "SMS", price: "12 500 ₽" },
  { name: "Автосервис «Гараж» — сезонная диагностика", channel: "Email", price: "8 000 ₽" },
  { name: "Доставка еды «Вкусно и точка» — промо", channel: "SMS", price: "40 000 ₽" },
  { name: "Студия маникюра «Лак» — приведи подругу", channel: "SMS", price: "9 900 ₽" },
  { name: "Языковая школа «Lingva» — набор групп", channel: "Email", price: "15 000 ₽" },
  { name: "Пекарня «Хлеб да соль» — открытие точки", channel: "SMS", price: "11 000 ₽" },
  { name: "Барбершоп «Бритва» — скидка новым клиентам", channel: "SMS", price: "7 500 ₽" },
  { name: "Цветочный «Букет» — 8 марта", channel: "SMS", price: "22 000 ₽" },
  { name: "Стоматология «Улыбка» — чек-ап", channel: "Email", price: "18 000 ₽" },
];

const CAMPAIGNS: CampaignRow[] = SMB_CAMPAIGNS.map((c, i) => ({
  name: c.name,
  id: `${100240 + i}`,
  created: "Date created: 14.04.2025",
  period: "10.04.2025-20.05.2025",
  channel: c.channel,
  price: c.price,
  status: "moderation" as const,
}));

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusBox() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="16.5" height="16.5" rx="5" stroke="#5257FF" strokeWidth="1.5" />
      <path d="M12 9H6M9 6v6" stroke="#5257FF" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CampaignsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M2.5 8.5c0-2.36 0-3.54.73-4.27.73-.73 1.91-.73 4.27-.73h5c2.36 0 3.54 0 4.27.73.73.73.73 1.91.73 4.27 0 2.36 0 3.54-.73 4.27-.73.73-1.91.73-4.27.73H9l-3 2.5v-2.55c-1.6-.09-2.46-.36-2.98-1.18C2.5 11.7 2.5 10.6 2.5 8.5Z"
        stroke="#64748B"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6.5 8h7M6.5 10.5h4" stroke="#64748B" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SegmentsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="6" r="3.33" stroke="#64748B" strokeWidth="1.04" />
      <path d="M15 8.5c1.38 0 2.5-.93 2.5-2.08 0-1.15-1.12-2.08-2.5-2.08" stroke="#64748B" strokeWidth="1.04" strokeLinecap="round" />
      <path d="M5 8.5C3.62 8.5 2.5 7.57 2.5 6.42c0-1.15 1.12-2.09 2.5-2.09" stroke="#64748B" strokeWidth="1.04" strokeLinecap="round" />
      <ellipse cx="10" cy="15.17" rx="5" ry="3.33" stroke="#64748B" strokeWidth="1.04" />
      <path d="M16.67 16.83c1.46-.32 2.5-1.13 2.5-2.08 0-.95-1.04-1.76-2.5-2.08" stroke="#64748B" strokeWidth="1.04" strokeLinecap="round" />
      <path d="M3.33 16.83c-1.46-.32-2.5-1.13-2.5-2.08 0-.95 1.04-1.76 2.5-2.08" stroke="#64748B" strokeWidth="1.04" strokeLinecap="round" />
    </svg>
  );
}

function StatisticsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2.5a7.5 7.5 0 1 0 7.5 7.5" stroke="#64748B" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M10 10V2.5A7.5 7.5 0 0 1 17.5 10H10Z" stroke="#64748B" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3" stroke="#64748B" strokeWidth="1.3" />
      <path d="M4 16.5a6 6 0 0 1 12 0" stroke="#64748B" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="10" cy="10" r="8.5" stroke="#64748B" strokeWidth="1.3" />
    </svg>
  );
}

function Chevron({ dir = "down" }: { dir?: "down" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
      style={{ transform: dir === "right" ? "rotate(-90deg)" : undefined }}>
      <path d="M3.5 5l3.5 3.5L10.5 5" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="#F0F0F0" />
      <path d="M9.57 10H20a10 10 0 0 0-.34-2.6H9.57V10Zm0-5.2h8.97a10 10 0 0 0-2.31-2.61H9.57v2.61ZM10 20a10 10 0 0 0 6.23-2.17H3.77A10 10 0 0 0 10 20Zm-8.53-4.78h17.06a10 10 0 0 0 1.12-2.61H.35a10 10 0 0 0 1.12 2.61Z" fill="#D80027" />
      <path d="M4.63 5.56h.91l-.84.61.32 1-.85-.62-.84.62.28-.86A10.05 10.05 0 0 0 1.66 8.48h.3l-.54.39a9.9 9.9 0 0 0-.24.43l.26.79-.48-.35a9.9 9.9 0 0 0-.33.79l.28.87h1.05l-.85.62.32 1-.85-.62-.5.36C.03 13.16 0 13.58 0 14h10V4c-1.98 0-3.82.57-5.37 1.56Z" fill="#0052B4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="#94A3B8" strokeWidth="1.4" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="#94A3B8" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SupportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6.5" stroke="#B9B9B9" />
      <path d="M5.75 5.42a1.25 1.25 0 1 1 2.5 0c0 .46-.25.86-.61 1.08-.32.19-.64.47-.64.84v.83" stroke="#B9B9B9" strokeLinecap="round" />
      <circle cx="7" cy="10.17" r="0.67" fill="#B9B9B9" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M5.5 1.5H4c-1.4 0-2.1 0-2.55.44C1 2.4 1 3.1 1 4.5v5c0 1.4 0 2.1.45 2.56C1.9 12.5 2.6 12.5 4 12.5h1.5" stroke="#2196F3" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M6.5 7h6.5M13 7l-2-1.75M13 7l-2 1.75" stroke="#2196F3" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 3.5c0-.94 0-1.41.29-1.7C4.58 1.5 5.06 1.5 6 1.5h4l4 4v8c0 .94 0 1.41-.29 1.71-.29.29-.77.29-1.71.29H6c-.94 0-1.42 0-1.71-.29C4 14.91 4 14.44 4 13.5v-10Z" stroke="#64748B" strokeWidth="1.3" />
      <path d="M10 1.7V5.5h3.8M6.5 9h7M6.5 11.5h7M6.5 14h4.5" stroke="#64748B" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// ── Top bar ─────────────────────────────────────────────────────────────────

function AdcTopbar() {
  return (
    <header className="ac-topbar">
      <div className="ac-topbar-logo">
        <LogoFull />
      </div>
      <div className="ac-topbar-email">{USER_EMAIL}</div>
      <div className="ac-topbar-right">
        <button className="ac-topbar-link" type="button">
          <SupportIcon />
          <span>Support</span>
        </button>
        <button className="ac-logout-btn" type="button">
          <LogoutIcon />
          <span>Log out</span>
        </button>
      </div>
    </header>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function AdcSidebar() {
  return (
    <aside className="ac-sidebar">
      <nav className="ac-side-nav">
        <div className="ac-side-item ac-side-item-active">
          <span className="ac-side-item-main">
            <CampaignsIcon />
            <span>Ad Campaigns</span>
          </span>
          <button className="ac-side-add" type="button" title="New campaign"><PlusBox /></button>
        </div>
        <div className="ac-side-item">
          <span className="ac-side-item-main">
            <SegmentsIcon />
            <span>Audience Segments</span>
          </span>
          <button className="ac-side-add" type="button" title="New segment"><PlusBox /></button>
        </div>
        <div className="ac-side-item">
          <span className="ac-side-item-main">
            <StatisticsIcon />
            <span>Statistics</span>
          </span>
        </div>
      </nav>

      <div className="ac-side-footer">
        <div className="ac-side-item">
          <span className="ac-side-item-main">
            <AccountIcon />
            <span>Account</span>
          </span>
          <Chevron dir="down" />
        </div>
        <div className="ac-side-sub">Profile</div>
        <div className="ac-side-sub">Names of Senders</div>
        <div className="ac-side-sub">Users</div>
        <div className="ac-side-item ac-side-lang">
          <span className="ac-side-item-main">
            <FlagIcon />
            <span>English</span>
          </span>
          <Chevron dir="right" />
        </div>
      </div>
    </aside>
  );
}

// ── Ad Campaigns list (main screen) ────────────────────────────────────────────

function StatusPill({ status }: { status: CampaignRow["status"] }) {
  const meta = STATUS_META[status];
  return <span className={`ac-pill ${meta.className}`}>{meta.label}</span>;
}

function CampaignListRow({ row }: { row: CampaignRow }) {
  return (
    <div className="ac-row">
      <span className="ac-row-icon"><DocIcon /></span>
      <div className="ac-row-body">
        <a className="ac-row-name" href="#" onClick={(e) => e.preventDefault()}>{row.name}</a>
        <div className="ac-row-meta">ID {row.id} · {row.created}</div>
      </div>
      <div className="ac-row-period">{row.period}</div>
      <div className="ac-row-channel">{row.channel}</div>
      <div className="ac-row-price">{row.price}</div>
      <StatusPill status={row.status} />
    </div>
  );
}

function fmtNumber(n: number): string {
  return n.toLocaleString("ru-RU").replace(/,/g, " ");
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function mapStatus(status: string): CampaignRow["status"] {
  if (status === "active") return "active";
  if (status === "moderation") return "moderation";
  return "draft";
}

const CHANNEL_LABELS: Record<string, string> = { sms: "SMS", email: "Email", meta: "Meta" };

function campaignToRow(c: CampaignSummary): CampaignRow {
  const price = c.estimatedCost > 0 ? c.estimatedCost : c.budget ?? 0;
  const ch = c.channel || "sms";
  return {
    name: c.name,
    id: String(100000 + c.id),
    created: c.createdAt ? `Date created: ${fmtDate(c.createdAt)}` : "",
    period: c.startDate && c.endDate ? `${c.startDate}-${c.endDate}` : "—",
    channel: CHANNEL_LABELS[ch] ?? ch.toUpperCase(),
    price: price > 0 ? `${fmtNumber(Math.round(price))} ₽` : "—",
    status: mapStatus(c.status),
  };
}

function AdcCampaignsScreen() {
  // Load persisted campaigns; fall back to the demo list when there are none yet
  // (fresh install / backend offline) so the screen still looks like the product.
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    listCampaigns()
      .then((cs) => { if (!cancelled) setRows(cs.length ? cs.map(campaignToRow) : CAMPAIGNS); })
      .catch(() => { if (!cancelled) setRows(CAMPAIGNS); });
    return () => { cancelled = true; };
  }, []);

  const list = rows ?? CAMPAIGNS;
  return (
    <div className="ac-card">
      <div className="ac-card-head">
        <h1 className="ac-card-title">Advertising campaigns</h1>
        <p className="ac-card-subtitle">
          You can create an advertising campaign, view existing ones with their data, or delete them
        </p>
      </div>

      <div className="ac-toolbar">
        <div className="ac-search">
          <SearchIcon />
          <span className="ac-search-placeholder">Search</span>
        </div>
        <div className="ac-toolbar-actions">
          <button className="ac-toolbar-btn" type="button">Filters</button>
          <button className="ac-toolbar-btn" type="button">Sort by date</button>
          <span className="ac-toolbar-count">{list.length}</span>
        </div>
      </div>

      <div className="ac-list">
        {list.map((row, i) => (
          <CampaignListRow key={i} row={row} />
        ))}
      </div>

      <div className="ac-pagination">
        {["1", "2", "3", "4", "5", "…", "12"].map((p, i) => (
          <button key={i} type="button" className={`ac-page${p === "1" ? " ac-page-active" : ""}`}>{p}</button>
        ))}
      </div>
    </div>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────────

export function AdConnectMock() {
  const { campaignDraft } = useChatWorkspaceStore();
  return (
    <div className="ac-shell">
      <AdcTopbar />
      <div className="ac-body">
        <AdcSidebar />
        <main className="ac-main">
          {campaignDraft ? <CampaignWizard draft={campaignDraft} /> : <AdcCampaignsScreen />}
        </main>
      </div>
    </div>
  );
}

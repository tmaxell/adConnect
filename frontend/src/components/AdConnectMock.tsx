/**
 * AdConnectMock — статичный CSS/SVG-макет интерфейса продукта Eastwind AdConnect.
 * Воссоздан по экранам из adConnect/screens (Ad Campaigns + боковое меню + топбар).
 *
 * Это фоновый «основной экран» продукта, поверх которого работает плавающий
 * AI-виджет (FloatingWidget). Логики нет — чистая визуальная реконструкция.
 */

import { useCallback, useEffect, useState } from "react";
import { deleteCampaign, listCampaigns, type CampaignSummary } from "../api/chatApi";
import { useChatWorkspaceStore } from "../chat-workspace/store/chatWorkspaceStore";
import { CampaignWizard } from "./CampaignWizard";
import { AnalyticsPage } from "./AnalyticsPage";
import { ProfilePage } from "./ProfilePage";
import { AudiencesPage } from "./AudiencesPage";
import { LogoFull } from "./Logo";
import { t, useLang } from "../i18n";

const USER_EMAIL = "ivani_gp@starcorp.com";

// ── Ad Campaigns list (rows come from the DB via /api/campaigns) ─────────────────

interface CampaignRow {
  campaignId: number;
  name: string;
  id: string;
  created: string;
  period: string;
  channel: string;
  price: string;
  status: "moderation" | "active" | "draft";
}

const STATUS_CLASS: Record<CampaignRow["status"], string> = {
  moderation: "ac-pill-moderation",
  active: "ac-pill-active",
  draft: "ac-pill-draft",
};
function statusLabel(status: CampaignRow["status"]): string {
  switch (status) {
    case "moderation": return t("На модерации", "Under moderation");
    case "active": return t("Активна", "Active");
    case "draft": return t("Черновик", "Draft");
  }
}

// ── Icons ─────────────────────────────────────────────────────────────────────

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

function GlobeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8" stroke="#64748B" strokeWidth="1.4" />
      <path d="M2 10h16M10 2c2.2 2 3.3 4.9 3.3 8s-1.1 6-3.3 8c-2.2-2-3.3-4.9-3.3-8S7.8 4 10 2Z"
        stroke="#64748B" strokeWidth="1.4" strokeLinejoin="round" />
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
  const { t } = useLang();
  return (
    <header className="ac-topbar">
      <div className="ac-topbar-logo">
        <LogoFull />
      </div>
      <div className="ac-topbar-email">{USER_EMAIL}</div>
      <div className="ac-topbar-right">
        <button className="ac-topbar-link" type="button">
          <SupportIcon />
          <span>{t("Поддержка", "Support")}</span>
        </button>
        <button className="ac-logout-btn" type="button">
          <LogoutIcon />
          <span>{t("Выйти", "Log out")}</span>
        </button>
      </div>
    </header>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function AdcSidebar() {
  const { view, setView } = useChatWorkspaceStore();
  const { lang, toggle, t } = useLang();
  return (
    <aside className="ac-sidebar">
      <nav className="ac-side-nav">
        <button
          type="button"
          className={`ac-side-item${view === "campaigns" ? " ac-side-item-active" : ""}`}
          onClick={() => setView("campaigns")}
        >
          <span className="ac-side-item-main">
            <CampaignsIcon />
            <span>{t("Рекламные кампании", "Ad Campaigns")}</span>
          </span>
        </button>
        <button
          type="button"
          className={`ac-side-item${view === "audiences" ? " ac-side-item-active" : ""}`}
          onClick={() => setView("audiences", null)}
        >
          <span className="ac-side-item-main">
            <SegmentsIcon />
            <span>{t("Сегменты аудитории", "Audience Segments")}</span>
          </span>
        </button>
        <button
          type="button"
          className={`ac-side-item${view === "analytics" ? " ac-side-item-active" : ""}`}
          onClick={() => setView("analytics", null)}
        >
          <span className="ac-side-item-main">
            <StatisticsIcon />
            <span>{t("Статистика", "Statistics")}</span>
          </span>
        </button>
      </nav>

      <div className="ac-side-footer">
        <div className="ac-side-item">
          <span className="ac-side-item-main">
            <AccountIcon />
            <span>{t("Аккаунт", "Account")}</span>
          </span>
          <Chevron dir="down" />
        </div>
        <button
          type="button"
          className={`ac-side-sub${view === "profile" ? " ac-side-sub-active" : ""}`}
          onClick={() => setView("profile")}
        >
          {t("Профиль", "Profile")}
        </button>
        <div className="ac-side-sub">{t("Имена отправителей", "Names of Senders")}</div>
        <div className="ac-side-sub">{t("Пользователи", "Users")}</div>
        <button
          type="button"
          className="ac-side-item ac-side-lang"
          onClick={toggle}
          title={lang === "en" ? "Переключить на русский" : "Switch to English"}
          aria-label={lang === "en" ? "Switch language, current: English" : "Сменить язык, текущий: русский"}
        >
          <span className="ac-side-item-main">
            <GlobeIcon />
            <span>{lang === "en" ? "English" : "Русский"}</span>
          </span>
          <span className="ac-side-lang-code">{lang.toUpperCase()}</span>
        </button>
      </div>
    </aside>
  );
}

// ── Ad Campaigns list (main screen) ────────────────────────────────────────────

function StatusPill({ status }: { status: CampaignRow["status"] }) {
  return <span className={`ac-pill ${STATUS_CLASS[status]}`}>{statusLabel(status)}</span>;
}

function CampaignListRow({ row, onOpen, onDelete }: {
  row: CampaignRow; onOpen: (id: number) => void; onDelete: (id: number) => void;
}) {
  const { t } = useLang();
  return (
    <div className="ac-row ac-row-click" role="button" tabIndex={0} onClick={() => onOpen(row.campaignId)}>
      <span className="ac-row-icon"><DocIcon /></span>
      <div className="ac-row-body">
        <span className="ac-row-name">{row.name}</span>
        <div className="ac-row-meta">ID {row.id} · {row.created}</div>
      </div>
      <div className="ac-row-period">{row.period}</div>
      <div className="ac-row-channel">{row.channel}</div>
      <div className="ac-row-price">{row.price}</div>
      <StatusPill status={row.status} />
      <button type="button" className="ac-row-del" title={t("Удалить кампанию", "Delete campaign")}
        onClick={(e) => { e.stopPropagation(); onDelete(row.campaignId); }}>✕</button>
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

const CHANNEL_LABELS: Record<string, string> = { sms: "SMS", email: "Email", meta: "Meta", whatsapp: "WhatsApp" };

function campaignToRow(c: CampaignSummary): CampaignRow {
  const price = c.estimatedCost > 0 ? c.estimatedCost : c.budget ?? 0;
  const ch = c.channel || "sms";
  return {
    campaignId: c.id,
    name: c.name,
    id: String(100000 + c.id),
    created: c.createdAt ? `${t("Дата создания", "Date created")}: ${fmtDate(c.createdAt)}` : "",
    period: c.startDate && c.endDate ? `${c.startDate}-${c.endDate}` : "—",
    channel: CHANNEL_LABELS[ch] ?? ch.toUpperCase(),
    price: price > 0 ? `${fmtNumber(Math.round(price))} ₽` : "—",
    status: mapStatus(c.status),
  };
}

function AdcCampaignsScreen() {
  // Campaigns are read from the DB only — no frontend mock data.
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const reload = useCallback(() => {
    listCampaigns().then((cs) => setRows(cs.map(campaignToRow))).catch(() => setRows([]));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const { startCreating, setView } = useChatWorkspaceStore();
  const { t } = useLang();
  const remove = async (id: number) => {
    if (!window.confirm(t("Удалить кампанию?", "Delete this campaign?"))) return;
    try { await deleteCampaign(id); } finally { reload(); }
  };
  const list = rows ?? [];
  const loading = rows === null;
  return (
    <div className="ac-card">
      <div className="ac-card-head">
        <div className="ac-card-head-row">
          <div>
            <h1 className="ac-card-title">{t("Рекламные кампании", "Advertising campaigns")}</h1>
            <p className="ac-card-subtitle">
              {t(
                "Создавайте рекламные кампании, смотрите существующие с их данными или удаляйте их",
                "You can create an advertising campaign, view existing ones with their data, or delete them",
              )}
            </p>
          </div>
          <button type="button" className="ac-create-btn" onClick={() => void startCreating()}>
            {t("+ Создать кампанию", "+ Create campaign")}
          </button>
        </div>
      </div>

      <div className="ac-toolbar">
        <div className="ac-search">
          <SearchIcon />
          <span className="ac-search-placeholder">{t("Поиск", "Search")}</span>
        </div>
        <div className="ac-toolbar-actions">
          <button className="ac-toolbar-btn" type="button">{t("Фильтры", "Filters")}</button>
          <button className="ac-toolbar-btn" type="button">{t("Сортировать по дате", "Sort by date")}</button>
          <span className="ac-toolbar-count">{list.length}</span>
        </div>
      </div>

      {loading ? (
        <div className="ac-empty">{t("Загрузка…", "Loading…")}</div>
      ) : list.length === 0 ? (
        <div className="ac-empty">{t("Пока нет кампаний. Нажмите «+ Создать кампанию», чтобы собрать первую.", "No campaigns yet. Click “+ Create campaign” to build your first one.")}</div>
      ) : (
        <div className="ac-list">
          {list.map((row) => (
            <CampaignListRow key={row.campaignId} row={row}
              onOpen={(id) => setView("analytics", id)} onDelete={remove} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────────

export function AdConnectMock() {
  const { campaignDraft, view, creating } = useChatWorkspaceStore();
  return (
    <div className="ac-shell">
      <AdcTopbar />
      <div className="ac-body">
        <AdcSidebar />
        <main className="ac-main">
          {view === "analytics"
            ? <AnalyticsPage />
            : view === "profile"
            ? <ProfilePage />
            : view === "audiences"
            ? <AudiencesPage />
            : creating && campaignDraft ? <CampaignWizard draft={campaignDraft} /> : <AdcCampaignsScreen />}
        </main>
      </div>
    </div>
  );
}

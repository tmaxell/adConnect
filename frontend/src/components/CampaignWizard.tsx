/**
 * CampaignWizard — interactive campaign canvas over the AdConnect wizard.
 *
 * The canvas mutates the same `campaign_draft` as the copilot agent (PATCH
 * /api/sessions/{id}/draft), so the user can build a campaign two ways:
 *  - by talking to the copilot, or
 *  - by clicking directly here — pick a channel, toggle placements, edit the
 *    audience, choose a Meta creative format and generate/upload its media.
 *
 * The audience step is channel-aware:
 *  - messaging (SMS/Email): operator-base segments with the per-dimension ₽ surcharge.
 *  - network (Meta): a Meta-style audience builder — Локации → Возраст и пол →
 *    Детальные интересы → Источник (Custom Audience + lookalike) → Плейсменты,
 *    then a dedicated creatives step (format picker + media + ad preview).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  isNetworkChannel,
  WA_MAX_CARDS,
  type CampaignDraft,
  type Channel,
  type MediaType,
  type MetaFormat,
  type WhatsAppButton,
  type WhatsAppCard,
  type WizardStep,
} from "../types/campaign";
import { NETWORK_CHANNELS, OPERATOR_CHANNELS, type ChannelCard } from "./channels";
import { useChatWorkspaceStore } from "../chat-workspace/store/chatWorkspaceStore";
import { getAudiences, getProfile, saveAudience, type AudienceItem, type AudienceLibrary } from "../api/chatApi";
import type { BusinessProfile } from "../types/campaign";

const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", email: "Email", meta: "Meta", whatsapp: "WhatsApp" };
function channelLabel(c: string | null): string {
  return c ? CHANNEL_LABEL[c] ?? c.toUpperCase() : "—";
}

const OBJECTIVE_LABEL: Record<string, string> = {
  awareness: "Узнаваемость", traffic: "Трафик", engagement: "Вовлечённость",
  leads: "Лиды", sales: "Продажи",
};
// Short descriptions mirror Meta's ODAX objective definitions.
const OBJECTIVE_DESC: Record<string, string> = {
  awareness: "Максимум охвата и запоминаемости бренда",
  traffic: "Переходы на сайт, в приложение или чат",
  engagement: "Сообщения, реакции, просмотры, отклики",
  leads: "Заявки и контакты: форма, чат, WhatsApp",
  sales: "Покупки и конверсии",
};
const ALL_OBJECTIVES: Array<keyof typeof OBJECTIVE_LABEL> = [
  "awareness", "traffic", "engagement", "leads", "sales",
];

/** Minimal line icon per ODAX objective. */
function ObjectiveIcon({ objective }: { objective: string }) {
  const p = { className: "acw-obj-icon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (objective) {
    case "awareness": return <svg {...p}><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M16 9a3 3 0 0 1 0 6M19 6a7 7 0 0 1 0 12" /></svg>;
    case "traffic": return <svg {...p}><path d="M5 12h12M13 6l6 6-6 6" /></svg>;
    case "engagement": return <svg {...p}><path d="M4 5h16v11H8l-4 4V5z" /><path d="M8 10h.01M12 10h.01M16 10h.01" /></svg>;
    case "leads": return <svg {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
    case "sales": return <svg {...p}><path d="M5 6h15l-1.5 8h-12L5 6z" /><path d="M5 6 4 3H2" /><circle cx="9" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="8" /></svg>;
  }
}
const PLACEMENT_LABEL: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", messenger: "Messenger",
  whatsapp: "WhatsApp", audience_network: "Audience Network",
};
const DEMOGRAPHICS_LABEL: Record<string, string> = { all: "Все", men: "Мужчины", women: "Женщины" };
const INTEREST_LABEL: Record<string, string> = {
  sport: "Спорт", travel: "Путешествия", tourism: "Туризм", movies: "Кино", walking: "Прогулки",
  finance: "Финансы", technology: "Технологии", education: "Образование", food: "Еда",
  fashion: "Мода", gaming: "Игры", business: "Бизнес", premium: "Премиум",
  family: "Семья", kids: "Дети", entertainment: "Развлечения",
};
const mapInterests = (items: string[]) => items.map((t) => INTEREST_LABEL[t] ?? t);
const ALL_PLACEMENTS = ["facebook", "instagram", "messenger", "whatsapp", "audience_network"];

// Tone presets for ad-copy generation. "recommended" lets the Copilot pick the
// most effective angle and is the default.
const TONES: Array<{ id: string; label: string }> = [
  { id: "recommended", label: "✦ Рекомендуемый Copilot" },
  { id: "selling", label: "Продающий" },
  { id: "friendly", label: "Дружелюбный" },
  { id: "business", label: "Деловой" },
  { id: "short", label: "Краткий" },
];

// Creative formats (placement positions / Click-to-WhatsApp destination).
const FORMAT_ORDER: MetaFormat[] = ["feed", "stories", "reels", "whatsapp"];
const FORMAT_META: Record<MetaFormat, { label: string; ratio: string; hint: string }> = {
  feed:     { label: "Лента",    ratio: "1:1",  hint: "Пост в ленте Facebook / Instagram" },
  stories:  { label: "Истории",  ratio: "9:16", hint: "Полноэкранные Stories" },
  reels:    { label: "Reels",    ratio: "9:16", hint: "Вертикальное видео Reels" },
  whatsapp: { label: "WhatsApp", ratio: "9:16", hint: "Статус в WhatsApp + переход в чат" },
};

/** Formats available for the currently selected placements (mirrors the backend). */
function availableFormats(placements: string[]): MetaFormat[] {
  const set = new Set<MetaFormat>();
  if (["facebook", "instagram", "messenger"].some((p) => placements.includes(p))) set.add("feed");
  if (placements.includes("instagram") || placements.includes("facebook")) {
    set.add("stories");
    set.add("reels");
  }
  if (placements.includes("whatsapp")) set.add("whatsapp"); // WhatsApp Status (9:16)
  const out = FORMAT_ORDER.filter((f) => set.has(f));
  return out.length ? out : ["feed"];
}

/** True only for real uploaded video files. Generated "video" assets are mock
 *  SVG placeholders (with a play affordance) and must render as <img>. */
function isVideoFile(url: string | null): boolean {
  return !!url && /\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(url);
}

function ctaLabel(objective: string, format: MetaFormat): string {
  if (format === "whatsapp") return "Написать в WhatsApp";
  switch (objective) {
    case "sales": return "В магазин";
    case "leads": return "Оставить заявку";
    case "engagement": return "Написать";
    case "awareness": return "Узнать больше";
    default: return "Подробнее";
  }
}

/** Brand logo for a Meta publisher platform (replaces the old colour dots). */
function PlatformIcon({ platform }: { platform: string }) {
  const common = { className: "acw-plogo", viewBox: "0 0 24 24", "aria-hidden": true } as const;
  switch (platform) {
    case "facebook":
      return (
        <svg {...common}><rect width="24" height="24" rx="6" fill="#1877F2" /><path fill="#fff" d="M16.5 8.3h-1.7c-.4 0-.8.4-.8.9V11h2.4l-.4 2.5h-2v6.4h-2.6v-6.4H9.3V11h2.1V9.1c0-1.9 1.2-3.1 3-3.1h2.1v2.3z" /></svg>
      );
    case "instagram":
      return (
        <svg {...common}>
          <defs>
            <radialGradient id="acw-ig" cx="0.3" cy="1.05" r="1.1">
              <stop offset="0" stopColor="#FFD776" /><stop offset="0.25" stopColor="#F3A953" />
              <stop offset="0.5" stopColor="#E8556E" /><stop offset="0.75" stopColor="#CE3AA6" />
              <stop offset="1" stopColor="#7B43E3" />
            </radialGradient>
          </defs>
          <rect width="24" height="24" rx="6" fill="url(#acw-ig)" />
          <rect x="6" y="6" width="12" height="12" rx="4" fill="none" stroke="#fff" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" strokeWidth="1.7" />
          <circle cx="16.3" cy="7.7" r="1.05" fill="#fff" />
        </svg>
      );
    case "messenger":
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="acw-msgr" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#0099FF" /><stop offset="0.6" stopColor="#A033FF" />
              <stop offset="0.9" stopColor="#FF5280" /><stop offset="1" stopColor="#FF7061" />
            </linearGradient>
          </defs>
          <path fill="url(#acw-msgr)" d="M12 2.2C6.4 2.2 2.2 6.3 2.2 11.7c0 2.9 1.2 5.4 3.2 7.1.2.1.3.4.3.6l.05 1.8c.02.6.6.9 1.1.7l2-.9c.16-.07.34-.08.5-.04.92.25 1.9.39 2.9.39 5.6 0 9.8-4.1 9.8-9.5S17.6 2.2 12 2.2z" />
          <path fill="#fff" d="M6.1 14.6l2.9-4.6c.46-.73 1.45-.9 2.13-.39l2.3 1.72c.21.16.5.16.71 0l3.11-2.36c.42-.31.96.18.68.62l-2.9 4.6c-.46.73-1.45.9-2.13.39l-2.3-1.72a.6.6 0 0 0-.71 0L8.79 15.2c-.42.31-.96-.18-.68-.62z" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg {...common}><rect width="24" height="24" rx="6" fill="#25D366" /><path fill="#fff" d="M12 5.4a6.6 6.6 0 0 0-5.66 9.98L5.4 18.6l3.32-.92A6.6 6.6 0 1 0 12 5.4zm3.74 9.18c-.16.44-.92.84-1.27.86-.34.03-.66.16-2.22-.46-1.88-.74-3.06-2.66-3.15-2.78-.09-.12-.75-1-.75-1.9s.47-1.35.64-1.53c.16-.18.36-.22.48-.22l.34.01c.11 0 .26-.04.4.31.16.39.54 1.34.59 1.44.05.1.08.21.01.34-.36.72-.75.69-.55 1.03.75 1.29 1.5 1.73 2.64 2.3.19.1.31.08.42-.05.12-.13.49-.57.62-.76.13-.19.26-.16.44-.1.18.07 1.13.53 1.32.63.19.1.32.14.37.22.05.08.05.45-.11.89z" /></svg>
      );
    default: // audience_network → Meta network mark
      return (
        <svg {...common}><rect width="24" height="24" rx="6" fill="#0866FF" /><text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">∞</text></svg>
      );
  }
}

const STEP_ORDER: Array<Exclude<WizardStep, "ready">> = [
  "brief", "channel", "segments", "message", "cost", "confirmation",
];

function stepLabel(step: Exclude<WizardStep, "ready">, channel: Channel | null): string {
  const network = isNetworkChannel(channel);
  const whatsapp = channel === "whatsapp";
  switch (step) {
    case "brief": return "Бриф";
    case "channel": return "Канал";
    case "segments": return network || whatsapp ? "Аудитория" : "Сегменты";
    case "message": return whatsapp ? "Карусель" : network ? "Креатив" : "Сообщение";
    case "cost": return "Стоимость";
    case "confirmation": return "Подтверждение";
  }
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU").replace(/,/g, " ");
}

function activeStep(draft: CampaignDraft): Exclude<WizardStep, "ready"> {
  return draft.step === "ready" ? "confirmation" : draft.step;
}

// ── Shared interactive primitives ────────────────────────────────────────────────

type Patch = Record<string, unknown>;
interface WizardApi {
  update: (patch: Patch) => void;
  busy: boolean;
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`acw-toggle${on ? " on" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
    />
  );
}

function GenderRadios({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="acw-radios">
      {(["all", "men", "women"] as const).map((d) => (
        <button key={d} type="button" className="acw-radio-row" onClick={() => onChange(d)} disabled={disabled}>
          <span className={`acw-radio${value === d ? " on" : ""}`} />
          <span>{DEMOGRAPHICS_LABEL[d]}</span>
        </button>
      ))}
    </div>
  );
}

/** Editable chip list — Enter/blur adds, × removes. */
function EditableChips({
  items, empty, labelMap, onAdd, onRemove, disabled, placeholder = "+ добавить",
}: {
  items: string[];
  empty: string;
  labelMap?: Record<string, string>;
  onAdd: (raw: string) => void;
  onRemove: (key: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [val, setVal] = useState("");
  const commit = () => {
    const v = val.trim();
    if (v) onAdd(v);
    setVal("");
  };
  return (
    <div className="acw-edit-chips">
      {items.length === 0 && <span className="acw-placeholder">{empty}</span>}
      {items.map((it) => (
        <span key={it} className="acw-chip acw-chip-edit">
          {labelMap?.[it] ?? it}
          <button type="button" className="acw-chip-x" onClick={() => onRemove(it)} disabled={disabled} aria-label="Удалить">×</button>
        </span>
      ))}
      <input
        className="acw-chip-input"
        value={val}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        onBlur={commit}
      />
    </div>
  );
}

/** Inline-editable single value committed on blur / Enter. */
function EditableText({
  value, placeholder, onCommit, multiline, suffix, type = "text", disabled,
}: {
  value: string | null;
  placeholder: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  suffix?: string;
  type?: string;
  disabled?: boolean;
}) {
  const [val, setVal] = useState(value ?? "");
  useEffect(() => { setVal(value ?? ""); }, [value]);
  const commit = () => { if ((val ?? "") !== (value ?? "")) onCommit(val); };
  if (multiline) {
    return (
      <textarea
        className="acw-textarea-edit"
        value={val}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
      />
    );
  }
  return (
    <div className="acw-input-edit-wrap">
      <input
        className="acw-input-edit"
        type={type}
        value={val}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        onBlur={commit}
      />
      {suffix && val !== "" && <span className="acw-input-suffix">{suffix}</span>}
    </div>
  );
}

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <span className="acw-placeholder">{empty}</span>;
  return (
    <div className="acw-chips">
      {items.map((it) => <span key={it} className="acw-chip">{it}</span>)}
    </div>
  );
}

function Field({ label, children, badge, hint }: { label: string; children: ReactNode; badge?: string; hint?: string }) {
  return (
    <div className="acw-field">
      <div className="acw-field-head">
        <span className="acw-field-label">{label}</span>
        {badge && <span className="acw-badge">{badge}</span>}
      </div>
      {hint && <div className="acw-hint acw-hint-top">{hint}</div>}
      {children}
    </div>
  );
}

// Distinct media-action icons (fixed 16px so the button width never reflows).
function IconPhoto() {
  return <svg className="acw-mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="m4 18 5-5 4 4 3-3 4 4" /></svg>;
}
function IconVideo() {
  return <svg className="acw-mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3z" /></svg>;
}
function IconUpload() {
  return <svg className="acw-mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V5M8 9l4-4 4 4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>;
}
function Spinner() {
  return <svg className="acw-mi acw-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
}

/** Two-option segmented control (e.g. Advantage+ ↔ Manual). */
function Segmented<T extends string>({ value, options, onChange, disabled }: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="acw-segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`acw-seg${value === o.value ? " on" : ""}`}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Audience-size gauge (Specific ↔ Broad) — like Meta's audience-definition needle. */
function AudienceGauge({ reach }: { reach: number }) {
  const pos = Math.max(4, Math.min(96, Math.round((Math.log10(Math.max(reach, 1000)) - 3) / 4 * 100)));
  const band = pos < 33 ? "Узкая" : pos < 67 ? "Сбалансированная" : "Широкая";
  return (
    <div className="acw-gauge">
      <div className="acw-gauge-head">
        <span>Размер аудитории</span>
        <span className="acw-gauge-band">{band} · ≈ {fmt(reach)}</span>
      </div>
      <div className="acw-gauge-track"><span className="acw-gauge-needle" style={{ left: `${pos}%` }} /></div>
      <div className="acw-gauge-ends"><span>Точная</span><span>Широкая</span></div>
    </div>
  );
}

// ── Step progress bar ──────────────────────────────────────────────────────────

function StepBar({ draft, current, onJump }: {
  draft: CampaignDraft;
  current: Exclude<WizardStep, "ready">;
  onJump: (s: Exclude<WizardStep, "ready">) => void;
}) {
  const reached = activeStep(draft);
  const reachedIdx = STEP_ORDER.indexOf(reached);
  const currentIdx = STEP_ORDER.indexOf(current);
  const submitted = draft.status === "submitted";
  return (
    <div className="acw-typecard">
      <div className="acw-typename">{draft.channel ? `Кампания ${channelLabel(draft.channel)}` : "Новая кампания"}</div>
      <div className="acw-steps">
        {STEP_ORDER.map((step, i) => {
          const done = submitted || i < reachedIdx;
          const active = !submitted && i === currentIdx;
          // Allow jumping to any step already reached (or the channel step).
          const clickable = submitted || i <= reachedIdx;
          return (
            <button
              key={step}
              type="button"
              className="acw-step"
              disabled={!clickable}
              onClick={() => clickable && onJump(step)}
            >
              <div className={`acw-step-bar${done ? " done" : ""}${active ? " active" : ""}`} />
              <span className={`acw-step-label${done || active ? " on" : ""}`}>{stepLabel(step, draft.channel)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Reach / price panel ─────────────────────────────────────────────────────────

function ReachPanel({ draft }: { draft: CampaignDraft }) {
  const network = isNetworkChannel(draft.channel);
  const whatsapp = draft.channel === "whatsapp";
  return (
    <aside className="acw-reach">
      <div className="acw-reach-num">{fmt(draft.audience_reach || 0)}</div>
      <div className="acw-reach-cap">{network ? "Custom Audience" : whatsapp ? "Достижимо в WhatsApp" : "Охват аудитории"}</div>
      {whatsapp ? (
        <>
          <div className="acw-price-num">{draft.price_per_message || 0} ₽ <span className="acw-info">ⓘ</span></div>
          <div className="acw-reach-cap">Цена за диалог</div>
          {draft.cost.messages_count ? (
            <>
              <div className="acw-price-num acw-reach-imp">{fmt(draft.cost.messages_count)}</div>
              <div className="acw-reach-cap">Ожидаемые диалоги</div>
            </>
          ) : null}
          <div className="acw-hint">Переписка с ботом после открытия диалога — бесплатно.</div>
        </>
      ) : network ? (
        <>
          <div className="acw-price-num">{draft.cpm || 0} ₽ <span className="acw-info">ⓘ</span></div>
          <div className="acw-reach-cap">CPM (за 1000 показов)</div>
          <div className="acw-price-num acw-reach-imp">{fmt(draft.estimated_impressions || 0)}</div>
          <div className="acw-reach-cap">Ожидаемые показы</div>
          {draft.platform_breakdown.length > 0 && (
            <div className="acw-platforms">
              {draft.platform_breakdown.map((p) => (
                <div key={p.platform} className="acw-platform-row">
                  <span className="acw-platform-name"><PlatformIcon platform={p.platform} />{p.label}</span>
                  <span>{fmt(p.impressions)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="acw-price-num">{draft.price_per_message || 0} ₽ <span className="acw-info">ⓘ</span></div>
          <div className="acw-reach-cap">Цена за сообщение</div>
        </>
      )}
    </aside>
  );
}

// ── Channel step ─────────────────────────────────────────────────────────────────

function ChannelCardButton({ card, selected, api }: { card: ChannelCard; selected: boolean; api: WizardApi }) {
  const planned = card.status === "planned";
  return (
    <button
      type="button"
      className={`acw-chan${selected ? " selected" : ""}${planned ? " planned" : ""}`}
      disabled={planned || api.busy}
      onClick={() => api.update({ channel: card.id })}
    >
      <div className="acw-chan-top">
        <span className="acw-chan-label">{card.label}</span>
        {planned ? <span className="acw-soon">Скоро</span> : <span className={`acw-radio${selected ? " on" : ""}`} />}
      </div>
      <div className="acw-chan-desc">{card.description}</div>
      {card.audienceLanding && <div className="acw-chan-meta">Аудитория: {card.audienceLanding}</div>}
      {card.note && <div className="acw-chan-note">{card.note}</div>}
    </button>
  );
}

// ── Brief step — what's advertised + objective (first step) ──────────────────────

function ObjectiveCards({ value, onPick, disabled }: { value: string; onPick: (o: string) => void; disabled?: boolean }) {
  return (
    <div className="acw-obj-grid">
      {ALL_OBJECTIVES.map((o) => (
        <button key={o} type="button" className={`acw-obj${value === o ? " on" : ""}`} disabled={disabled} onClick={() => onPick(o)}>
          <ObjectiveIcon objective={o} />
          <span className="acw-obj-text">
            <span className="acw-obj-label">{OBJECTIVE_LABEL[o]}</span>
            <span className="acw-obj-desc">{OBJECTIVE_DESC[o]}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function BriefStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  useEffect(() => { getProfile().then(setProfile).catch(() => {}); }, []);
  // Pre-fill company from the profile once (only if the brief is still empty).
  useEffect(() => {
    if (profile?.company_name && !draft.company) api.update({ company: profile.company_name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  return (
    <>
      <div className="acw-brief-intro">
        Опишите, что продвигаем и зачем — AdConnect Copilot использует это для подбора аудитории и генерации офферов и креативов.
      </div>
      <Field label="Что рекламируем" hint="Продукт или услуга — например: «фитнес-клуб», «доставка готовой еды».">
        <EditableText value={draft.product} placeholder={profile?.default_product || "Продукт или услуга"}
          onCommit={(v) => api.update({ product: v })} disabled={api.busy} />
      </Field>
      <Field label="Компания / бренд">
        <EditableText value={draft.company} placeholder={profile?.company_name || "Название компании"}
          onCommit={(v) => api.update({ company: v })} disabled={api.busy} />
      </Field>
      <Field label="Оффер (необязательно)" hint="Спецпредложение этой кампании — например: «первый месяц бесплатно», «скидка 20%».">
        <EditableText value={draft.offer} placeholder="Скидка, бонус, акция…"
          onCommit={(v) => api.update({ offer: v })} disabled={api.busy} />
      </Field>
      <Field label="Цель кампании" hint="Определяет, под что Copilot оптимизирует подбор и креативы.">
        <ObjectiveCards value={draft.meta.objective} onPick={(o) => api.update({ objective: o })} disabled={api.busy} />
      </Field>
      {!profile?.company_name && (
        <div className="acw-hint">Заполните «Профиль компании», чтобы не вводить компанию и тон каждый раз.</div>
      )}
    </>
  );
}

function ChannelStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  return (
    <>
      <div className="acw-section-title">Канал отправки оператора</div>
      <div className="acw-chan-list">
        {OPERATOR_CHANNELS.map((c) => (
          <ChannelCardButton key={c.id} card={c} selected={draft.channel === c.id} api={api} />
        ))}
      </div>
      <div className="acw-section-title">Внешние рекламные сети</div>
      <div className="acw-chan-list">
        {NETWORK_CHANNELS.map((c) => (
          <ChannelCardButton key={c.id} card={c} selected={draft.channel === c.id} api={api} />
        ))}
      </div>
    </>
  );
}

// ── Audience registry — pick from / save to the shared audience registry ─────────

function IconSave() {
  return <svg className="acw-mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M7 3v5h7V3" /><path d="M7 21v-7h10v7" /></svg>;
}

/** Modal listing the shared audience registry (saved + operator presets). */
function AudienceRegistryModal({ draft, api, onClose }: { draft: CampaignDraft; api: WizardApi; onClose: () => void }) {
  const [lib, setLib] = useState<AudienceLibrary | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { getAudiences().then(setLib).catch(() => {}); }, []);
  const pick = (item: AudienceItem, isPreset: boolean) => {
    api.update({
      apply_segment_spec: item.spec,
      matched_segment_name: item.name,
      ...(isPreset ? { matched_segment_id: String(item.id) } : {}),
    });
    onClose();
  };
  const match = (a: AudienceItem) => a.name.toLowerCase().includes(q.trim().toLowerCase());
  const saved = (lib?.saved ?? []).filter(match);
  const presets = (lib?.presets ?? []).filter(match);
  const active = draft.segments.matched_segment_name;
  const row = (a: AudienceItem, isPreset: boolean) => (
    <button key={`${isPreset ? "p" : "s"}${a.id}`} type="button"
      className={`acw-aud-row${active === a.name ? " on" : ""}`} title={a.description}
      disabled={api.busy} onClick={() => pick(a, isPreset)}>
      <span className="acw-aud-row-name">{a.name}</span>
      <span className="acw-aud-row-reach">{fmt(a.reach)}</span>
    </button>
  );
  return (
    <div className="acw-modal-backdrop" onClick={onClose}>
      <div className="acw-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="acw-modal-head">
          <span className="acw-modal-title">Реестр аудиторий</span>
          <button type="button" className="acw-modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <input className="acw-modal-search" value={q} placeholder="Поиск по названию…"
          onChange={(e) => setQ(e.target.value)} />
        <div className="acw-modal-body">
          {saved.length > 0 && (
            <>
              <div className="acw-aud-group">Мои сохранённые</div>
              <div className="acw-modal-list">{saved.map((a) => row(a, false))}</div>
            </>
          )}
          <div className="acw-aud-group">Готовые сегменты оператора</div>
          <div className="acw-modal-list">{presets.map((a) => row(a, true))}</div>
          {saved.length === 0 && presets.length === 0 && <div className="acw-hint">Ничего не найдено.</div>}
        </div>
      </div>
    </div>
  );
}

/** Trigger that opens the registry modal and shows the chosen audience. */
function AudiencePicker({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const [open, setOpen] = useState(false);
  const active = draft.segments.matched_segment_name;
  return (
    <Field label="Готовая аудитория" hint="Выберите аудиторию из реестра — ранее сохранённую или готовый сегмент оператора; параметры подставятся автоматически.">
      <div className="acw-aud-pick">
        {active && <span className="acw-chip acw-chip-accent">{active}</span>}
        <button type="button" className="acw-btn acw-btn-ghost" disabled={api.busy} onClick={() => setOpen(true)}>
          {active ? "Сменить аудиторию" : "Выбрать готовую аудиторию"}
        </button>
      </div>
      {open && <AudienceRegistryModal draft={draft} api={api} onClose={() => setOpen(false)} />}
    </Field>
  );
}

/** Save the current audience into the shared registry (sits at the bottom of the step). */
function SaveAudienceButton({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const name = window.prompt("Название аудитории:", draft.product ? `Аудитория «${draft.product}»` : "Моя аудитория");
    if (!name) return;
    setSaving(true);
    try {
      await saveAudience({
        name, channel: draft.channel, reach: draft.audience_reach,
        spec: draft.segments as unknown as Record<string, unknown>,
      });
    } finally { setSaving(false); }
  };
  return (
    <button type="button" className="acw-btn acw-btn-ghost acw-aud-save" disabled={api.busy || saving} onClick={save}>
      {saving ? <Spinner /> : <IconSave />}{saving ? "Сохраняю…" : "Сохранить аудиторию в реестр"}
    </button>
  );
}

// ── Extended operator (telecom) filters — shared by both audience variants ───────

type SegKey = "tariff_type" | "arpu" | "device" | "data_usage" | "tenure"
  | "marital_status" | "occupation" | "education";
const OP_FILTERS: Array<{ key: SegKey; label: string; options: string[] }> = [
  { key: "tariff_type", label: "Тип тарифа", options: ["Предоплата", "Постоплата", "Корпоративный"] },
  { key: "arpu", label: "Средний чек (ARPU)", options: ["до 300 ₽", "300–700 ₽", "700–1500 ₽", "1500+ ₽"] },
  { key: "device", label: "Устройство", options: ["iOS", "Android", "Премиум", "Бюджетные"] },
  { key: "data_usage", label: "Потребление трафика", options: ["Низкое", "Среднее", "Высокое"] },
  { key: "tenure", label: "Стаж с оператором", options: ["до 1 года", "1–3 года", "3+ года"] },
  { key: "marital_status", label: "Семейное положение", options: ["Холост/не замужем", "В браке"] },
  { key: "occupation", label: "Занятость", options: ["Наёмный", "Свой бизнес", "Студент", "Пенсионер"] },
  { key: "education", label: "Образование", options: ["Среднее", "Высшее"] },
];
const TRIGGER_OPTIONS = ["Недавнее пополнение", "Окончание договора", "Смена устройства", "Всплеск трат", "Роуминг"];

function SelectChips({ value, options, onPick, disabled }: {
  value: string | null; options: string[]; onPick: (v: string | null) => void; disabled?: boolean;
}) {
  return (
    <div className="acw-chips">
      {options.map((o) => (
        <button key={o} type="button" className={`acw-chip acw-chip-btn${value === o ? " acw-chip-accent" : " acw-chip-off"}`}
          disabled={disabled} onClick={() => onPick(value === o ? null : o)}>{o}</button>
      ))}
    </div>
  );
}

function OperatorExtraFilters({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const s = draft.segments;
  const activeCount =
    OP_FILTERS.filter((f) => s[f.key]).length + (s.roaming ? 1 : 0) + (s.trigger_events.length ? 1 : 0);
  const [open, setOpen] = useState(activeCount > 0);
  return (
    <div className="acw-extra">
      <button type="button" className="acw-extra-head" onClick={() => setOpen((o) => !o)}>
        <span>Доп. параметры аудитории{activeCount > 0 ? ` · ${activeCount}` : ""}</span>
        <span className="acw-extra-caret">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="acw-extra-body">
          {OP_FILTERS.map((f) => (
            <Field key={f.key} label={f.label}>
              <SelectChips value={s[f.key]} options={f.options} disabled={api.busy}
                onPick={(v) => api.update({ [f.key]: v })} />
            </Field>
          ))}
          <Field label="Триггеры (события)">
            <div className="acw-chips">
              {TRIGGER_OPTIONS.map((t) => {
                const on = s.trigger_events.includes(t);
                return (
                  <button key={t} type="button" className={`acw-chip acw-chip-btn${on ? " acw-chip-accent" : " acw-chip-off"}`}
                    disabled={api.busy} onClick={() => api.update({ toggle_trigger: t })}>{t}</button>
                );
              })}
            </div>
          </Field>
          <div className="acw-toggle-row">
            <span>Были в роуминге / поездках</span>
            <Toggle on={s.roaming} onClick={() => api.update({ roaming: !s.roaming })} disabled={api.busy} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Audience step — Meta (network) ───────────────────────────────────────────────

function MetaAudienceStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const s = draft.segments;
  const m = draft.meta;
  const reach = fmt(draft.audience_reach || 0);
  const advantage = m.audience_mode === "advantage";
  const suggestHint = advantage ? "Подсказка для AdConnect Copilot" : undefined;
  return (
    <>
      <div className="acw-meta-account">
        <span className="acw-meta-account-dot" />
        Рекламный аккаунт ведётся через кабинет оператора (Business Manager) — подключать свой не нужно.
      </div>

      {/* Objective is set on the Brief step; show it here as read-only context. */}
      <div className="acw-objective-pill">
        Цель: <b>{OBJECTIVE_LABEL[m.objective] ?? m.objective}</b>
      </div>

      <AudiencePicker draft={draft} api={api} />

      {/* Audience-building method — Advantage+ vs manual (Meta's two top modes). */}
      <Field label="Метод подбора аудитории">
        <Segmented
          value={m.audience_mode}
          onChange={(v) => api.update({ audience_mode: v })}
          disabled={api.busy}
          options={[
            { value: "advantage", label: "AdConnect Copilot" },
            { value: "manual", label: "Ручная настройка" },
          ]}
        />
        <div className="acw-hint">
          {advantage
            ? "AdConnect Copilot использует данные оператора (Custom Audience) и ваши подсказки (гео, возраст, интересы), чтобы найти больше похожих покупателей."
            : "Вы полностью управляете таргетингом: источник, гео, возраст, интересы и плейсменты."}
        </div>
        <AudienceGauge reach={draft.audience_reach || 0} />
      </Field>

      {/* Audience source — operator Custom Audience seed + optional Lookalike. */}
      <Field label="Источник аудитории">
        <div className="acw-source-card">
          <span className="acw-source-tag">Custom Audience</span>
          <span>Данные оператора · совпадение ≈ 60% · ≈ {reach} профилей</span>
        </div>
        {advantage ? (
          <div className="acw-hint">Lookalike-моделирование встроено в AdConnect Copilot — он сам расширит аудиторию.</div>
        ) : (
          <>
            <div className="acw-toggle-row">
              <span>Похожая аудитория (Lookalike)</span>
              <Toggle on={m.lookalike} onClick={() => api.update({ lookalike: !m.lookalike })} disabled={api.busy} />
            </div>
            {m.lookalike && (
              <div className="acw-look">
                <input
                  type="range" min={1} max={10} step={1} value={m.lookalike_pct}
                  className="acw-range" disabled={api.busy}
                  onChange={(e) => api.update({ lookalike_pct: Number(e.target.value) })}
                />
                <div className="acw-look-ends">
                  <span>1% — ближе к источнику</span>
                  <span className="acw-look-val">{m.lookalike_pct}%</span>
                  <span>10% — шире охват</span>
                </div>
              </div>
            )}
          </>
        )}
      </Field>

      {/* Locations — a *hard control* even under Advantage+; geo first for local SMB. */}
      <div className="acw-geo">
        <Field label="Локации" badge="Жёсткое условие">
          <EditableChips
            items={s.geography}
            empty="Город или регион (можно радиус вокруг точки)"
            onAdd={(v) => api.update({ geography_add: v })}
            onRemove={(v) => api.update({ geography_remove: v })}
            disabled={api.busy}
            placeholder="+ город"
          />
          <div className="acw-hint">Города и регионы — ключевой таргетинг для локального бизнеса.</div>
        </Field>
      </div>

      <Field label="Возраст и пол" hint={suggestHint}>
        <GenderRadios value={s.demographics} onChange={(v) => api.update({ demographics: v })} disabled={api.busy} />
        <div className="acw-sub-field">
          <EditableChips
            items={s.age}
            empty="Возраст (например, 18-30)"
            onAdd={(v) => api.update({ age: [...s.age, v] })}
            onRemove={(v) => api.update({ age: s.age.filter((x) => x !== v) })}
            disabled={api.busy}
            placeholder="+ возраст"
          />
        </div>
      </Field>

      <Field label="Детальный таргетинг" hint={suggestHint}>
        <EditableChips
          items={s.interests}
          labelMap={INTEREST_LABEL}
          empty="Интересы и поведение"
          onAdd={(v) => api.update({ interests: [...s.interests, v] })}
          onRemove={(v) => api.update({ interests: s.interests.filter((x) => x !== v) })}
          disabled={api.busy}
          placeholder="+ интерес"
        />
      </Field>

      <OperatorExtraFilters draft={draft} api={api} />

      {/* Placements — Advantage+ (auto) by default, switchable to manual. */}
      <Field label="Плейсменты">
        <div className="acw-toggle-row">
          <span>Автоматические плейсменты (AdConnect Copilot)</span>
          <Toggle on={m.advantage_placements} onClick={() => api.update({ advantage_placements: !m.advantage_placements })} disabled={api.busy} />
        </div>
        <div className="acw-hint">
          {m.advantage_placements
            ? "AdConnect Copilot распределит показы по площадкам для лучшего результата (рекомендуется)."
            : "Выберите площадки вручную — нажмите, чтобы включить или выключить."}
        </div>
        <div className="acw-chips">
          {ALL_PLACEMENTS.map((p) => {
            const on = draft.meta.placements.includes(p);
            const auto = m.advantage_placements;
            return (
              <button
                key={p}
                type="button"
                className={`acw-chip acw-chip-btn${(auto || on) ? " acw-chip-accent" : " acw-chip-off"}`}
                disabled={api.busy || auto}
                onClick={() => api.update({ toggle_placement: p })}
              >
                <PlatformIcon platform={p} />{PLACEMENT_LABEL[p]}
              </button>
            );
          })}
        </div>
      </Field>
    </>
  );
}

// ── Audience step — operator channels (SMS/Email) ────────────────────────────────

function OperatorSegmentsStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const s = draft.segments;
  return (
    <>
      <AudiencePicker draft={draft} api={api} />
      {s.matched_segment_name && (
        <Field label="Сегмент абонентской базы">
          <div className="acw-chips"><span className="acw-chip acw-chip-accent">{s.matched_segment_name}</span></div>
        </Field>
      )}
      <Field label="География" badge="0.3 ₽">
        <EditableChips
          items={s.geography}
          empty="Регион или город"
          onAdd={(v) => api.update({ geography_add: v })}
          onRemove={(v) => api.update({ geography_remove: v })}
          disabled={api.busy}
          placeholder="+ город"
        />
      </Field>
      <Field label="Демография" badge="0.3 ₽">
        <GenderRadios value={s.demographics} onChange={(v) => api.update({ demographics: v })} disabled={api.busy} />
        <div className="acw-sub-field">
          <EditableChips
            items={s.age}
            empty="Возраст"
            onAdd={(v) => api.update({ age: [...s.age, v] })}
            onRemove={(v) => api.update({ age: s.age.filter((x) => x !== v) })}
            disabled={api.busy}
            placeholder="+ возраст"
          />
        </div>
      </Field>
      <Field label="Доход и пополнения">
        <Chips items={[s.monthly_income, s.deposits_per_month].filter(Boolean) as string[]} empty="Доход / пополнения в месяц" />
      </Field>
      <Field label="Интересы и доп. признаки">
        <EditableChips
          items={s.interests}
          labelMap={INTEREST_LABEL}
          empty="Интересы"
          onAdd={(v) => api.update({ interests: [...s.interests, v] })}
          onRemove={(v) => api.update({ interests: s.interests.filter((x) => x !== v) })}
          disabled={api.busy}
          placeholder="+ интерес"
        />
      </Field>

      <OperatorExtraFilters draft={draft} api={api} />
    </>
  );
}

// ── WhatsApp Business — account/sender setup (mirrors Meta's account badge) ───────

function WhatsAppSetup({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const wa = draft.whatsapp;
  const dedicated = wa.sender_mode === "dedicated";
  return (
    <>
      <div className="acw-meta-account">
        <span className="acw-meta-account-dot" />
        Рассылка идёт под аккаунтом оператора — подключать свой аккаунт WhatsApp не нужно.
        Шаблон проходит согласование в Meta.
      </div>
      <Field label="Отправитель" hint="Общий аккаунт оператора подходит большинству. Крупным рекламодателям оператор заводит выделенного отправителя со своим именем.">
        <Segmented
          value={wa.sender_mode}
          onChange={(v) => api.update({ wa_sender_mode: v })}
          disabled={api.busy}
          options={[
            { value: "shared", label: "AdConnect Promo (общий)" },
            { value: "dedicated", label: "Выделенный отправитель" },
          ]}
        />
        {dedicated && (
          <div className="acw-sub-field">
            <EditableText
              value={wa.sender_name}
              placeholder="Отображаемое имя отправителя (например, бренд)"
              onCommit={(v) => api.update({ wa_sender_name: v })}
              disabled={api.busy}
            />
            <div className="acw-hint">Выделенного отправителя и его верификацию готовит оператор.</div>
          </div>
        )}
      </Field>
    </>
  );
}

function WhatsAppAudienceStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  return (
    <>
      <WhatsAppSetup draft={draft} api={api} />
      <div className="acw-source-card">
        <span className="acw-source-tag">opt-in</span>
        <span>Сообщения уходят только подписчикам с WhatsApp, давшим согласие (покрытие ≈ 70% базы).</span>
      </div>
      <OperatorSegmentsStep draft={draft} api={api} />
    </>
  );
}

function SegmentsStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const content = isNetworkChannel(draft.channel)
    ? <MetaAudienceStep draft={draft} api={api} />
    : draft.channel === "whatsapp"
      ? <WhatsAppAudienceStep draft={draft} api={api} />
      : <OperatorSegmentsStep draft={draft} api={api} />;
  return (
    <>
      {content}
      <div className="acw-aud-savebar"><SaveAudienceButton draft={draft} api={api} /></div>
    </>
  );
}

// ── Message / creative step ──────────────────────────────────────────────────────

function MetaCreativeStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const { generateCreative, generateCopy, uploadCreative } = useChatWorkspaceStore();
  const [busyKind, setBusyKind] = useState<"image" | "video" | "upload" | "copy" | null>(null);
  const [tone, setTone] = useState("recommended");
  const [prompt, setPrompt] = useState(draft.meta.creative.prompt ?? "");
  useEffect(() => { setPrompt(draft.meta.creative.prompt ?? ""); }, [draft.meta.creative.prompt]);
  const fileRef = useRef<HTMLInputElement>(null);
  const creative = draft.meta.creative;
  // Under Advantage+ placements Meta runs across all platforms → offer all formats.
  const places = draft.meta.advantage_placements ? ALL_PLACEMENTS : draft.meta.placements;
  const formats = availableFormats(places);
  const headline = draft.message.text || draft.meta.creative.headline || draft.goal;
  const vertical = FORMAT_META[creative.format]?.ratio === "9:16";

  const gen = async (media_type: MediaType) => {
    setBusyKind(media_type === "video" ? "video" : "image");
    try { await generateCreative({ format: creative.format, media_type, headline, prompt: prompt.trim() || null }); }
    finally { setBusyKind(null); }
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusyKind("upload");
    try { await uploadCreative(file); } finally { setBusyKind(null); }
  };
  const genCopy = async () => {
    setBusyKind("copy");
    try { await generateCopy({ tone }); } finally { setBusyKind(null); }
  };
  const variants = draft.message.variants;

  const disabled = api.busy || busyKind !== null;
  return (
    <>
      <Field label="Формат размещения">
        <div className="acw-hint">Доступные форматы зависят от выбранных площадок.</div>
        <div className="acw-formats">
          {formats.map((f) => {
            const on = creative.format === f;
            return (
              <button
                key={f}
                type="button"
                className={`acw-format${on ? " on" : ""}`}
                disabled={disabled}
                onClick={() => api.update({ format: f })}
              >
                <span className="acw-format-label">{FORMAT_META[f].label}</span>
                <span className="acw-format-ratio">{FORMAT_META[f].ratio}</span>
                <span className="acw-format-hint">{FORMAT_META[f].hint}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Текст объявления" hint="Выберите тон и сгенерируйте варианты — затем выберите лучший и при необходимости отредактируйте.">
        <div className="acw-gen-row">
          <div className="acw-tone">
            {TONES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`acw-tone-chip${tone === t.id ? " on" : ""}`}
                disabled={disabled}
                onClick={() => setTone(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" className="acw-btn acw-btn-primary acw-gen-btn" disabled={disabled} onClick={genCopy}>
            {busyKind === "copy" ? <Spinner /> : "✦"} Сгенерировать варианты
          </button>
        </div>

        {variants.length > 0 && (
          <div className="acw-copy-cards">
            {variants.map((v, i) => {
              const selected = v === draft.message.text;
              return (
                <button
                  key={i}
                  type="button"
                  className={`acw-copy-card${selected ? " on" : ""}`}
                  disabled={disabled}
                  onClick={() => api.update({ message_text: v, headline: v })}
                >
                  <span className="acw-copy-card-badge">{selected ? "✓ Выбран" : `Вариант ${i + 1}`}</span>
                  <span className="acw-copy-card-text">{v}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="acw-sub-field">
          <EditableText
            value={draft.message.text}
            placeholder="Текст объявления — выберите вариант выше или впишите свой…"
            onCommit={(v) => api.update({ message_text: v, headline: v })}
            multiline
            disabled={disabled}
          />
        </div>
      </Field>

      <Field label="Изображение / видео по промпту" hint="Опишите, что изобразить, либо оставьте пустым — ✦ AdConnect Copilot подберёт визуал сам.">
        <textarea
          className="acw-textarea-edit"
          value={prompt}
          placeholder="Например: интерьер фитнес-клуба, утренний свет, улыбающиеся люди на тренировке…"
          disabled={disabled}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>

      <div className="acw-creative-grid">
        <Field label="Медиа">
          <div className="acw-copilot-tag">✦ Генерация на базе AdConnect Copilot</div>
          <div className="acw-media-actions">
            <button type="button" className="acw-btn acw-btn-ghost acw-media-btn" disabled={disabled} onClick={() => gen("image")}>
              {busyKind === "image" ? <Spinner /> : <IconPhoto />}Сгенерировать фото
            </button>
            <button type="button" className="acw-btn acw-btn-ghost acw-media-btn" disabled={disabled} onClick={() => gen("video")}>
              {busyKind === "video" ? <Spinner /> : <IconVideo />}Сгенерировать видео
            </button>
            <button type="button" className="acw-btn acw-btn-ghost acw-media-btn" disabled={disabled} onClick={() => fileRef.current?.click()}>
              {busyKind === "upload" ? <Spinner /> : <IconUpload />}Загрузить файл
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onFile} />
          </div>
          {creative.media_url ? (
            <div className="acw-media-meta">
              {creative.media_type === "video" ? "Видео" : "Изображение"} ·{" "}
              {creative.media_source === "generated" ? "сгенерировано" : "загружено"} ·{" "}
              {FORMAT_META[creative.format].ratio}
            </div>
          ) : (
            <div className="acw-hint">Сгенерируйте или загрузите изображение либо видео для объявления.</div>
          )}
        </Field>

        {/* Ad preview mockup */}
        <div className={`acw-adpreview${vertical ? " vertical" : ""}`}>
          <div className="acw-adpreview-head">
            <span className="acw-adpreview-avatar" />
            <span className="acw-adpreview-brand">{draft.product || "Ваш бренд"}</span>
            <span className="acw-adpreview-sponsored">Реклама</span>
          </div>
          <div className="acw-adpreview-media">
            {creative.media_url ? (
              isVideoFile(creative.media_url) ? (
                <video src={creative.media_url} className="acw-adpreview-asset" muted loop autoPlay playsInline />
              ) : (
                <img src={creative.media_url} className="acw-adpreview-asset" alt="creative" />
              )
            ) : (
              <div className="acw-adpreview-empty">{FORMAT_META[creative.format].label}</div>
            )}
            {headline && <div className="acw-adpreview-overlay">{headline}</div>}
          </div>
          <div className="acw-adpreview-cta">
            <span className="acw-adpreview-cta-text">{ctaLabel(draft.meta.objective, creative.format)}</span>
            <span className="acw-adpreview-cta-arrow">›</span>
          </div>
        </div>
      </div>

    </>
  );
}

// ── WhatsApp Business — carousel creative step ───────────────────────────────────

function WhatsAppButtonsEditor({ card, index, api, disabled }: {
  card: WhatsAppCard; index: number; api: WizardApi; disabled?: boolean;
}) {
  const setButtons = (buttons: WhatsAppButton[]) => api.update({ wa_card_buttons: { index, buttons } });
  const update = (i: number, patch: Partial<WhatsAppButton>) =>
    setButtons(card.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const remove = (i: number) => setButtons(card.buttons.filter((_, j) => j !== i));
  const add = () => setButtons([...card.buttons, { type: "quick_reply", label: "Подробнее", value: null }]);
  return (
    <div className="acw-wa-buttons">
      {card.buttons.map((b, i) => (
        <div key={i} className="acw-wa-button-row">
          <Segmented
            value={b.type}
            onChange={(v) => update(i, { type: v, value: v === "url" ? b.value : null })}
            disabled={disabled}
            options={[{ value: "quick_reply", label: "Ответ" }, { value: "url", label: "Ссылка" }]}
          />
          <div className="acw-wa-btn-fields">
            <EditableText value={b.label} placeholder="Текст кнопки" disabled={disabled}
              onCommit={(v) => update(i, { label: v })} />
            {b.type === "url" && (
              <EditableText value={b.value} placeholder="https://" disabled={disabled}
                onCommit={(v) => update(i, { value: v })} />
            )}
          </div>
          <button type="button" className="acw-chip-x" disabled={disabled} onClick={() => remove(i)} aria-label="Удалить">×</button>
        </div>
      ))}
      {card.buttons.length < 2 && (
        <button type="button" className="acw-btn acw-btn-ghost acw-wa-add-btn" disabled={disabled} onClick={add}>＋ Кнопка</button>
      )}
    </div>
  );
}

function WhatsAppCardEditor({ draft, api, index, disabled, onGen }: {
  draft: CampaignDraft; api: WizardApi; index: number; disabled?: boolean; onGen: (i: number) => void;
}) {
  const card = draft.whatsapp.cards[index];
  return (
    <div className="acw-wa-card">
      <div className="acw-wa-card-head">
        <span className="acw-wa-card-num">Карточка {index + 1}</span>
        <button type="button" className="acw-chip-x" disabled={disabled} onClick={() => api.update({ wa_remove_card: index })} aria-label="Удалить карточку">×</button>
      </div>
      <div className="acw-wa-card-media">
        {card.media_url
          ? <img src={card.media_url} className="acw-wa-card-img" alt="card" />
          : <div className="acw-adpreview-empty">1:1</div>}
      </div>
      <button type="button" className="acw-btn acw-btn-ghost acw-media-btn" disabled={disabled} onClick={() => onGen(index)}>
        <IconPhoto />{card.media_url ? "Перегенерировать фото" : "Сгенерировать фото"}
      </button>
      <EditableText value={card.body} placeholder="Текст карточки…" multiline disabled={disabled}
        onCommit={(v) => api.update({ wa_card_body: { index, body: v } })} />
      <WhatsAppButtonsEditor card={card} index={index} api={api} disabled={disabled} />
    </div>
  );
}

function WhatsAppPreview({ draft }: { draft: CampaignDraft }) {
  const wa = draft.whatsapp;
  const sender = wa.sender_mode === "dedicated" ? (wa.sender_name || "Ваш бренд") : "AdConnect Promo";
  return (
    <div className="acw-wa-preview">
      <div className="acw-wa-preview-head">
        <span className="acw-wa-preview-avatar" />
        <span className="acw-wa-preview-name">{sender}</span>
        <span className="acw-wa-preview-badge">бот</span>
      </div>
      <div className="acw-wa-preview-body">
        {wa.cards.length === 0 ? (
          <div className="acw-hint">Соберите карусель, чтобы увидеть превью сообщения.</div>
        ) : (
          <div className="acw-wa-preview-carousel">
            {wa.cards.map((c, i) => (
              <div key={i} className="acw-wa-preview-card">
                {c.media_url
                  ? <img src={c.media_url} className="acw-wa-preview-img" alt="card" />
                  : <div className="acw-wa-preview-img acw-wa-preview-empty">1:1</div>}
                {c.body && <div className="acw-wa-preview-text">{c.body}</div>}
                {c.buttons.map((b, j) => <div key={j} className="acw-wa-preview-btn">{b.label}</div>)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WhatsAppCreativeStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const { generateCreative, generateCopy } = useChatWorkspaceStore();
  const [tone, setTone] = useState("recommended");
  const [busy, setBusy] = useState(false);
  const wa = draft.whatsapp;
  const disabled = api.busy || busy;

  const genCardImage = async (index: number) => {
    setBusy(true);
    try {
      const body = draft.whatsapp.cards[index]?.body ?? null;
      await generateCreative({ format: "whatsapp_card", media_type: "image", card_index: index, headline: body });
    } finally { setBusy(false); }
  };

  const buildCarousel = async () => {
    setBusy(true);
    try {
      const copy = await generateCopy({ tone });
      const variants = copy?.variants ?? [];
      const n = Math.max(1, Math.min(3, variants.length || 3));
      for (let i = 0; i < n; i += 1) {
        const body = variants[i] ?? null;
        if (body) await api.update({ wa_card_body: { index: i, body } });
        await generateCreative({ format: "whatsapp_card", media_type: "image", card_index: i, headline: body });
      }
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="acw-objective-pill">Шаблон: <b>маркетинговая карусель</b> · до {WA_MAX_CARDS} карточек</div>

      <Field label="Карусель" hint="Каждая карточка — изображение 1:1, текст и до 2 кнопок. Соберите автоматически или отредактируйте вручную.">
        <div className="acw-gen-row">
          <div className="acw-tone">
            {TONES.map((t) => (
              <button key={t.id} type="button" className={`acw-tone-chip${tone === t.id ? " on" : ""}`}
                disabled={disabled} onClick={() => setTone(t.id)}>{t.label}</button>
            ))}
          </div>
          <button type="button" className="acw-btn acw-btn-primary acw-gen-btn" disabled={disabled} onClick={buildCarousel}>
            {busy ? <Spinner /> : "✦"} Собрать карусель
          </button>
        </div>

        <div className="acw-wa-cards">
          {wa.cards.map((_, i) => (
            <WhatsAppCardEditor key={i} draft={draft} api={api} index={i} disabled={disabled} onGen={genCardImage} />
          ))}
          {wa.cards.length < WA_MAX_CARDS && (
            <button type="button" className="acw-wa-add-card" disabled={disabled} onClick={() => api.update({ wa_add_card: {} })}>
              ＋ Добавить карточку
            </button>
          )}
        </div>
      </Field>

      <Field label="Автоответы бота" hint="Когда абонент отвечает или жмёт кнопку, бот оператора продолжает диалог бесплатно (24 ч).">
        <div className="acw-toggle-row">
          <span>Включить автоответ</span>
          <Toggle on={wa.auto_reply_enabled} onClick={() => api.update({ toggle_wa_auto_reply: true })} disabled={disabled} />
        </div>
        {wa.auto_reply_enabled && (
          <div className="acw-sub-field">
            <EditableText value={wa.auto_reply_greeting} multiline disabled={disabled}
              placeholder="Приветствие бота — например: «Здравствуйте! Расскажу подробнее об акции.»"
              onCommit={(v) => api.update({ wa_greeting: v })} />
          </div>
        )}
      </Field>

      <WhatsAppPreview draft={draft} />
    </>
  );
}

function MessageStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  if (isNetworkChannel(draft.channel)) return <MetaCreativeStep draft={draft} api={api} />;
  if (draft.channel === "whatsapp") return <WhatsAppCreativeStep draft={draft} api={api} />;
  const { generateCopy } = useChatWorkspaceStore();
  const [tone, setTone] = useState("recommended");
  const [genBusy, setGenBusy] = useState(false);
  const m = draft.message;
  const busy = api.busy || genBusy;
  const genCopy = async () => {
    setGenBusy(true);
    try { await generateCopy({ tone }); } finally { setGenBusy(false); }
  };
  return (
    <>
      <Field label="Отправитель">
        <EditableText value={m.sender} placeholder="Имя отправителя" onCommit={(v) => api.update({ sender: v })} disabled={busy} />
      </Field>
      <Field label="Текст сообщения" hint="Выберите тон и сгенерируйте варианты — затем выберите лучший или впишите свой.">
        <div className="acw-gen-row">
          <div className="acw-tone">
            {TONES.map((t) => (
              <button key={t.id} type="button" className={`acw-tone-chip${tone === t.id ? " on" : ""}`}
                disabled={busy} onClick={() => setTone(t.id)}>{t.label}</button>
            ))}
          </div>
          <button type="button" className="acw-btn acw-btn-primary acw-gen-btn" disabled={busy} onClick={genCopy}>
            {genBusy ? <Spinner /> : "✦"} Сгенерировать варианты
          </button>
        </div>
        {m.variants.length > 0 && (
          <div className="acw-copy-cards">
            {m.variants.map((v, i) => {
              const selected = v === m.text;
              return (
                <button key={i} type="button" className={`acw-copy-card${selected ? " on" : ""}`}
                  disabled={busy} onClick={() => api.update({ message_text: v })}>
                  <span className="acw-copy-card-badge">{selected ? "✓ Выбран" : `Вариант ${i + 1}`}</span>
                  <span className="acw-copy-card-text">{v}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="acw-sub-field">
          <EditableText value={m.text} placeholder="Текст сообщения — выберите вариант выше или впишите свой…"
            onCommit={(v) => api.update({ message_text: v })} multiline disabled={busy} />
        </div>
      </Field>
    </>
  );
}

// ── Cost step ────────────────────────────────────────────────────────────────────

function CostStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const c = draft.cost;
  const network = isNetworkChannel(draft.channel);
  const whatsapp = draft.channel === "whatsapp";
  return (
    <>
      <Field label="Бюджет">
        <EditableText
          value={c.budget != null ? String(c.budget) : null}
          placeholder="Бюджет кампании, ₽"
          type="number"
          suffix="₽"
          onCommit={(v) => api.update({ budget: v })}
          disabled={api.busy}
        />
        {network ? (
          draft.estimated_impressions > 0 && (
            <div className="acw-hint">≈ {fmt(draft.estimated_impressions)} показов при CPM {draft.cpm} ₽</div>
          )
        ) : (
          <div className="acw-sub-field">
            <EditableText
              value={c.messages_count != null ? String(c.messages_count) : null}
              placeholder={whatsapp ? "Число диалогов" : "Число сообщений"}
              type="number"
              onCommit={(v) => api.update({ messages_count: v })}
              disabled={api.busy}
            />
            {whatsapp && (
              <div className="acw-hint">Платится открытие диалога ({draft.price_per_message} ₽); дальнейшая переписка с ботом — бесплатно.</div>
            )}
          </div>
        )}
      </Field>
      <Field label="Условия кампании">
        <div className="acw-two-col">
          <div className="acw-input-mock">{c.start_date || <span className="acw-placeholder">Дата начала</span>}</div>
          <div className="acw-input-mock">{c.end_date || <span className="acw-placeholder">Дата окончания</span>}</div>
        </div>
        <div className="acw-toggle-row"><span>Равномерное распределение</span><span className={`acw-toggle${c.uniform_distribution ? " on" : ""}`} /></div>
        <div className="acw-toggle-row"><span>Автозапуск</span><span className={`acw-toggle${c.autorun ? " on" : ""}`} /></div>
      </Field>
    </>
  );
}

// ── Confirmation step ────────────────────────────────────────────────────────────

function ConfirmationStep({ draft }: { draft: CampaignDraft }) {
  const s = draft.segments;
  const network = isNetworkChannel(draft.channel);
  const whatsapp = draft.channel === "whatsapp";
  const rows: Array<[string, string]> = [
    ["Канал", channelLabel(draft.channel)],
    ["Локации", s.geography.join(", ") || "Россия"],
    ["Пол", DEMOGRAPHICS_LABEL[s.demographics] ?? s.demographics],
    ["Возраст", s.age.join(", ") || "—"],
    ["Интересы", mapInterests(s.interests).join(", ") || "—"],
  ];
  if (network) {
    const placements = draft.meta.placements.map((p) => PLACEMENT_LABEL[p] ?? p).join(", ");
    rows.push(["Цель", OBJECTIVE_LABEL[draft.meta.objective] ?? draft.meta.objective]);
    rows.push(["Формат", FORMAT_META[draft.meta.creative.format]?.label ?? draft.meta.creative.format]);
    rows.push(["Плейсменты", placements || "Facebook, Instagram"]);
    rows.push(["Похожая аудитория", draft.meta.lookalike ? "Да" : "Нет"]);
    rows.push(["Custom Audience", fmt(draft.audience_reach)]);
    rows.push(["CPM", `${draft.cpm} ₽`]);
    rows.push(["Ожидаемые показы", fmt(draft.estimated_impressions)]);
  } else if (whatsapp) {
    const wa = draft.whatsapp;
    rows.push(["Отправитель", wa.sender_mode === "dedicated" ? (wa.sender_name || "Выделенный") : "AdConnect Promo (общий)"]);
    rows.push(["Шаблон", "Маркетинговая карусель"]);
    rows.push(["Карточек", String(wa.cards.length)]);
    rows.push(["Автоответы бота", wa.auto_reply_enabled ? "Включены" : "Нет"]);
    rows.push(["Достижимо в WhatsApp", fmt(draft.audience_reach)]);
    rows.push(["Цена за диалог", `${draft.price_per_message} ₽`]);
  } else {
    rows.push(["Доход", s.monthly_income || "—"]);
  }
  const creative = draft.meta.creative;
  return (
    <>
      <div className="acw-section-title">Параметры аудитории</div>
      <div className="acw-summary">
        {rows.map(([k, v]) => (
          <div key={k} className="acw-summary-row"><span>{k}</span><span>{v}</span></div>
        ))}
      </div>
      {network && creative.media_url && (
        <Field label="Креатив">
          <div className="acw-confirm-creative">
            {isVideoFile(creative.media_url)
              ? <video src={creative.media_url} className="acw-confirm-thumb" muted loop autoPlay playsInline />
              : <img src={creative.media_url} className="acw-confirm-thumb" alt="creative" />}
            <div className="acw-confirm-creative-meta">
              <div>{FORMAT_META[creative.format]?.label} · {FORMAT_META[creative.format]?.ratio}</div>
              <div className="acw-hint">{creative.media_source === "generated" ? "Сгенерировано" : "Загружено"}</div>
            </div>
          </div>
        </Field>
      )}
      {whatsapp && draft.whatsapp.cards.length > 0 && (
        <Field label="Карусель">
          <WhatsAppPreview draft={draft} />
        </Field>
      )}
      <Field label="Название кампании">
        <div className="acw-input-mock">{draft.name || <span className="acw-placeholder">Название</span>}</div>
      </Field>
      {draft.message.text && (
        <Field label="Сообщение"><div className="acw-textarea-mock">{draft.message.text}</div></Field>
      )}
      {draft.status === "submitted" && (
        <div className="acw-submitted">✓ Отправлено на модерацию</div>
      )}
    </>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────────

export function CampaignWizard({ draft }: { draft: CampaignDraft }) {
  const { updateDraft, sendMessage, sending, draftRev } = useChatWorkspaceStore();
  const reached = activeStep(draft);
  const submitted = draft.status === "submitted";

  // Local view step lets the user walk back/forward through the steps by clicking,
  // independent of the agent. It snaps to the draft's reached step only on
  // agent/session-driven changes (draftRev), never on the user's own canvas edits —
  // so e.g. typing the ad text doesn't yank you off the creative step.
  const [viewStep, setViewStep] = useState<Exclude<WizardStep, "ready">>(reached);
  useEffect(() => { setViewStep(activeStep(draft)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [draftRev]);

  const api: WizardApi = { update: (patch) => void updateDraft(patch), busy: sending };
  const step = submitted ? "confirmation" : viewStep;
  const idx = STEP_ORDER.indexOf(step);
  const isLast = step === "confirmation";

  const content = {
    brief: <BriefStep draft={draft} api={api} />,
    channel: <ChannelStep draft={draft} api={api} />,
    segments: <SegmentsStep draft={draft} api={api} />,
    message: <MessageStep draft={draft} api={api} />,
    cost: <CostStep draft={draft} api={api} />,
    confirmation: <ConfirmationStep draft={draft} />,
  }[step];

  // On the brief step, "Продолжить" requires a product and confirms the brief.
  const briefBlocked = step === "brief" && !(draft.product && draft.product.trim());
  const onContinue = () => {
    if (step === "brief" && !draft.brief_confirmed) updateDraft({ brief_confirmed: true });
    setViewStep(STEP_ORDER[idx + 1]);
  };
  const submit = () => void sendMessage("", { id: "submit_campaign", label: "Отправить на модерацию", kind: "primary", payload: {} });

  return (
    <div className="acw">
      <div className="acw-titlebar">
        <span>{submitted ? draft.name || "Рекламная кампания" : "Создание рекламной кампании"}</span>
        <span className="acw-titlebar-actions">⧉ 🗑</span>
      </div>

      <StepBar draft={draft} current={step} onJump={setViewStep} />

      <div className="acw-grid">
        <div className="acw-content">{content}</div>
        <ReachPanel draft={draft} />
      </div>

      <div className="acw-nav">
        {idx > 0 && !submitted && (
          <button className="acw-btn acw-btn-ghost" type="button" onClick={() => setViewStep(STEP_ORDER[idx - 1])}>
            Назад
          </button>
        )}
        {isLast ? (
          <button
            className={`acw-btn acw-btn-primary${submitted ? " done" : ""}`}
            type="button"
            disabled={submitted || sending}
            onClick={submit}
          >
            {submitted ? "Отправлено" : "Отправить на модерацию"}
          </button>
        ) : (
          <button
            className="acw-btn acw-btn-primary"
            type="button"
            disabled={sending || briefBlocked}
            title={briefBlocked ? "Укажите, что рекламируем" : undefined}
            onClick={onContinue}
          >
            Продолжить
          </button>
        )}
      </div>
    </div>
  );
}

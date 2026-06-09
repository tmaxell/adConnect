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
  type CampaignDraft,
  type MediaType,
  type MetaFormat,
  type WizardStep,
} from "../types/campaign";
import { NETWORK_CHANNELS, OPERATOR_CHANNELS, type ChannelCard } from "./channels";
import { useChatWorkspaceStore } from "../chat-workspace/store/chatWorkspaceStore";

const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", email: "Email", meta: "Meta" };
function channelLabel(c: string | null): string {
  return c ? CHANNEL_LABEL[c] ?? c.toUpperCase() : "—";
}

const OBJECTIVE_LABEL: Record<string, string> = {
  awareness: "Узнаваемость", traffic: "Трафик", engagement: "Вовлечённость",
  leads: "Лиды", sales: "Продажи",
};
const ALL_OBJECTIVES: Array<keyof typeof OBJECTIVE_LABEL> = [
  "awareness", "traffic", "engagement", "leads", "sales",
];
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
  "channel", "segments", "message", "cost", "confirmation",
];

function stepLabel(step: Exclude<WizardStep, "ready">, network: boolean): string {
  switch (step) {
    case "channel": return "Канал";
    case "segments": return network ? "Аудитория" : "Сегменты";
    case "message": return network ? "Креатив" : "Сообщение";
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

function Field({ label, children, badge }: { label: string; children: ReactNode; badge?: string }) {
  return (
    <div className="acw-field">
      <div className="acw-field-head">
        <span className="acw-field-label">{label}</span>
        {badge && <span className="acw-badge">{badge}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Step progress bar ──────────────────────────────────────────────────────────

function StepBar({ draft, current, onJump }: {
  draft: CampaignDraft;
  current: Exclude<WizardStep, "ready">;
  onJump: (s: Exclude<WizardStep, "ready">) => void;
}) {
  const network = isNetworkChannel(draft.channel);
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
              <span className={`acw-step-label${done || active ? " on" : ""}`}>{stepLabel(step, network)}</span>
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
  return (
    <aside className="acw-reach">
      <div className="acw-reach-num">{fmt(draft.audience_reach || 0)}</div>
      <div className="acw-reach-cap">{network ? "Custom Audience" : "Охват аудитории"}</div>
      {network ? (
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

// ── Audience step — Meta (network) ───────────────────────────────────────────────

function MetaAudienceStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const s = draft.segments;
  const reach = fmt(draft.audience_reach || 0);
  return (
    <>
      <div className="acw-meta-account">
        <span className="acw-meta-account-dot" />
        Рекламный аккаунт ведётся через кабинет оператора (Business Manager) — подключать свой не нужно.
      </div>

      <Field label="Цель кампании">
        <div className="acw-chips">
          {ALL_OBJECTIVES.map((o) => (
            <button
              key={o}
              type="button"
              className={`acw-chip acw-chip-btn${draft.meta.objective === o ? " acw-chip-accent" : ""}`}
              disabled={api.busy}
              onClick={() => api.update({ objective: o })}
            >
              {OBJECTIVE_LABEL[o]}
            </button>
          ))}
        </div>
      </Field>

      {/* Locations first — geo is the key lever for local SMB. */}
      <div className="acw-geo">
        <Field label="Локации">
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

      <Field label="Возраст и пол">
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

      <Field label="Детальный таргетинг">
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

      <Field label="Источник аудитории">
        <div className="acw-meta-audience">Custom Audience (данные оператора) · совпадение ≈ 60% · ≈ {reach} профилей</div>
        <div className="acw-toggle-row">
          <span>Похожая аудитория (lookalike)</span>
          <Toggle on={draft.meta.lookalike} onClick={() => api.update({ lookalike: !draft.meta.lookalike })} disabled={api.busy} />
        </div>
      </Field>

      <Field label="Плейсменты">
        <div className="acw-hint">Нажмите, чтобы включить или выключить площадку.</div>
        <div className="acw-chips">
          {ALL_PLACEMENTS.map((p) => {
            const on = draft.meta.placements.includes(p);
            return (
              <button
                key={p}
                type="button"
                className={`acw-chip acw-chip-btn${on ? " acw-chip-accent" : " acw-chip-off"}`}
                disabled={api.busy}
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
        <div className="acw-sub-field"><Chips items={s.children_age} empty="Возраст детей" /></div>
      </Field>
    </>
  );
}

function SegmentsStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  return isNetworkChannel(draft.channel)
    ? <MetaAudienceStep draft={draft} api={api} />
    : <OperatorSegmentsStep draft={draft} api={api} />;
}

// ── Message / creative step ──────────────────────────────────────────────────────

function MetaCreativeStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const { generateCreative, uploadCreative } = useChatWorkspaceStore();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const creative = draft.meta.creative;
  const formats = availableFormats(draft.meta.placements);
  const headline = draft.message.text || draft.meta.creative.headline || draft.goal;
  const vertical = FORMAT_META[creative.format]?.ratio === "9:16";

  const gen = async (media_type: MediaType) => {
    setBusy(true);
    try { await generateCreative({ format: creative.format, media_type, headline }); }
    finally { setBusy(false); }
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try { await uploadCreative(file); } finally { setBusy(false); }
  };

  const disabled = api.busy || busy;
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

      <Field label="Текст объявления">
        <EditableText
          value={draft.message.text}
          placeholder="Заголовок / основной текст объявления…"
          onCommit={(v) => api.update({ message_text: v, headline: v })}
          multiline
          disabled={disabled}
        />
      </Field>

      <div className="acw-creative-grid">
        <Field label="Медиа">
          <div className="acw-media-actions">
            <button type="button" className="acw-btn acw-btn-ghost" disabled={disabled} onClick={() => gen("image")}>
              {busy ? "…" : "✦ Сгенерировать фото"}
            </button>
            <button type="button" className="acw-btn acw-btn-ghost" disabled={disabled} onClick={() => gen("video")}>
              {busy ? "…" : "✦ Сгенерировать видео"}
            </button>
            <button type="button" className="acw-btn acw-btn-ghost" disabled={disabled} onClick={() => fileRef.current?.click()}>
              ⭱ Загрузить файл
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

      {draft.message.variants.length > 0 && (
        <Field label="Сгенерированные варианты текста">
          <div className="acw-variants">
            {draft.message.variants.map((v, i) => (
              <button
                key={i}
                type="button"
                className={`acw-variant${v === draft.message.text ? " selected" : ""}`}
                disabled={disabled}
                onClick={() => api.update({ message_text: v, headline: v })}
              >
                <span className="acw-variant-idx">{i + 1}</span>
                <span>{v}</span>
              </button>
            ))}
          </div>
        </Field>
      )}
    </>
  );
}

function MessageStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const network = isNetworkChannel(draft.channel);
  if (network) return <MetaCreativeStep draft={draft} api={api} />;
  const m = draft.message;
  return (
    <>
      <Field label="Отправитель">
        <EditableText value={m.sender} placeholder="Имя отправителя" onCommit={(v) => api.update({ sender: v })} disabled={api.busy} />
      </Field>
      <Field label="Текст сообщения">
        <EditableText value={m.text} placeholder="Текст сообщения…" onCommit={(v) => api.update({ message_text: v })} multiline disabled={api.busy} />
      </Field>
      {m.variants.length > 0 && (
        <Field label="Сгенерированные варианты">
          <div className="acw-variants">
            {m.variants.map((v, i) => (
              <button
                key={i}
                type="button"
                className={`acw-variant${v === m.text ? " selected" : ""}`}
                disabled={api.busy}
                onClick={() => api.update({ message_text: v })}
              >
                <span className="acw-variant-idx">{i + 1}</span>
                <span>{v}</span>
              </button>
            ))}
          </div>
        </Field>
      )}
    </>
  );
}

// ── Cost step ────────────────────────────────────────────────────────────────────

function CostStep({ draft, api }: { draft: CampaignDraft; api: WizardApi }) {
  const c = draft.cost;
  const network = isNetworkChannel(draft.channel);
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
              placeholder="Число сообщений"
              type="number"
              onCommit={(v) => api.update({ messages_count: v })}
              disabled={api.busy}
            />
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
  } else {
    rows.push(["Доход", s.monthly_income || "—"]);
    rows.push(["Возраст детей", s.children_age.join(", ") || "—"]);
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
    channel: <ChannelStep draft={draft} api={api} />,
    segments: <SegmentsStep draft={draft} api={api} />,
    message: <MessageStep draft={draft} api={api} />,
    cost: <CostStep draft={draft} api={api} />,
    confirmation: <ConfirmationStep draft={draft} />,
  }[step];

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
            disabled={sending}
            onClick={() => setViewStep(STEP_ORDER[idx + 1])}
          >
            Продолжить
          </button>
        )}
      </div>
    </div>
  );
}

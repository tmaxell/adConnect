/**
 * CampaignWizard — live reflection of the agent's `campaign_draft` on the
 * AdConnect campaign wizard. The audience step is channel-aware:
 *  - messaging (SMS/Email): operator-base segments (gео/демография/доход/интересы)
 *    with the per-dimension ₽ surcharge, as in the operator product.
 *  - network (Meta): a Meta-style audience builder following real aggregators —
 *    Локации (гео, первым — критично для локального МСБ) → Возраст и пол →
 *    Детальные интересы → Источник (Custom Audience + lookalike) → Плейсменты.
 *    No per-message ₽ surcharge; pricing is CPM only.
 *
 * Read-only: the agent drives via chat; the canvas displays state.
 */

import { isNetworkChannel, type CampaignDraft, type WizardStep } from "../types/campaign";
import { NETWORK_CHANNELS, OPERATOR_CHANNELS, type ChannelCard } from "./channels";

const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", email: "Email", meta: "Meta" };
function channelLabel(c: string | null): string {
  return c ? CHANNEL_LABEL[c] ?? c.toUpperCase() : "—";
}

const OBJECTIVE_LABEL: Record<string, string> = {
  awareness: "Узнаваемость", traffic: "Трафик", engagement: "Вовлечённость",
  leads: "Лиды", sales: "Продажи",
};
const PLACEMENT_LABEL: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram",
  messenger: "Messenger", audience_network: "Audience Network",
};
const PLATFORM_COLOR: Record<string, string> = {
  facebook: "#1877F2", instagram: "#E4405F",
  messenger: "#00B2FF", audience_network: "#5890FF",
};
const DEMOGRAPHICS_LABEL: Record<string, string> = { all: "Все", men: "Мужчины", women: "Женщины" };
const INTEREST_LABEL: Record<string, string> = {
  sport: "Спорт", travel: "Путешествия", tourism: "Туризм", movies: "Кино", walking: "Прогулки",
  finance: "Финансы", technology: "Технологии", education: "Образование", food: "Еда",
  fashion: "Мода", gaming: "Игры", business: "Бизнес", premium: "Премиум",
  family: "Семья", kids: "Дети", entertainment: "Развлечения",
};
const mapInterests = (items: string[]) => items.map((t) => INTEREST_LABEL[t] ?? t);
const ALL_PLACEMENTS = ["facebook", "instagram", "messenger", "audience_network"];

function PlatformDot({ platform }: { platform: string }) {
  return <span className="acw-dot" style={{ background: PLATFORM_COLOR[platform] ?? "#94a3b8" }} />;
}

const STEP_ORDER: Array<Exclude<WizardStep, "ready">> = [
  "channel", "segments", "message", "cost", "confirmation",
];

function stepLabel(step: Exclude<WizardStep, "ready">, network: boolean): string {
  switch (step) {
    case "channel": return "Канал";
    case "segments": return network ? "Аудитория" : "Сегменты";
    case "message": return "Сообщение";
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

// ── Step progress bar ──────────────────────────────────────────────────────────

function StepBar({ draft }: { draft: CampaignDraft }) {
  const network = isNetworkChannel(draft.channel);
  const current = activeStep(draft);
  const currentIdx = STEP_ORDER.indexOf(current);
  const submitted = draft.status === "submitted";
  return (
    <div className="acw-typecard">
      <div className="acw-typename">{draft.channel ? `Кампания ${channelLabel(draft.channel)}` : "Новая кампания"}</div>
      <div className="acw-steps">
        {STEP_ORDER.map((step, i) => {
          const done = submitted || i < currentIdx;
          const active = !submitted && i === currentIdx;
          return (
            <div key={step} className="acw-step">
              <div className={`acw-step-bar${done ? " done" : ""}${active ? " active" : ""}`} />
              <span className={`acw-step-label${done || active ? " on" : ""}`}>{stepLabel(step, network)}</span>
            </div>
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
                  <span className="acw-platform-name"><PlatformDot platform={p.platform} />{p.label}</span>
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

// ── Chips / rows ─────────────────────────────────────────────────────────────────

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <span className="acw-placeholder">{empty}</span>;
  return (
    <div className="acw-chips">
      {items.map((it) => <span key={it} className="acw-chip">{it}</span>)}
    </div>
  );
}

function Field({ label, children, badge }: { label: string; children: React.ReactNode; badge?: string }) {
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

function GenderRadios({ value }: { value: string }) {
  return (
    <div className="acw-radios">
      {(["all", "men", "women"] as const).map((d) => (
        <label key={d} className="acw-radio-row">
          <span className={`acw-radio${value === d ? " on" : ""}`} />
          <span>{DEMOGRAPHICS_LABEL[d]}</span>
        </label>
      ))}
    </div>
  );
}

// ── Channel step ─────────────────────────────────────────────────────────────────

function ChannelCardView({ card, selected }: { card: ChannelCard; selected: boolean }) {
  const planned = card.status === "planned";
  return (
    <div className={`acw-chan${selected ? " selected" : ""}${planned ? " planned" : ""}`}>
      <div className="acw-chan-top">
        <span className="acw-chan-label">{card.label}</span>
        {planned ? <span className="acw-soon">Скоро</span> : <span className={`acw-radio${selected ? " on" : ""}`} />}
      </div>
      <div className="acw-chan-desc">{card.description}</div>
      {card.audienceLanding && (
        <div className="acw-chan-meta">Аудитория: {card.audienceLanding}</div>
      )}
      {card.note && <div className="acw-chan-note">{card.note}</div>}
    </div>
  );
}

function ChannelStep({ draft }: { draft: CampaignDraft }) {
  return (
    <>
      <div className="acw-section-title">Канал отправки оператора</div>
      <div className="acw-chan-list">
        {OPERATOR_CHANNELS.map((c) => (
          <ChannelCardView key={c.id} card={c} selected={draft.channel === c.id} />
        ))}
      </div>
      <div className="acw-section-title">Внешние рекламные сети</div>
      <div className="acw-chan-list">
        {NETWORK_CHANNELS.map((c) => (
          <ChannelCardView key={c.id} card={c} selected={draft.channel === c.id} />
        ))}
      </div>
    </>
  );
}

// ── Audience step — Meta (network) ───────────────────────────────────────────────

function MetaAudienceStep({ draft }: { draft: CampaignDraft }) {
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
          <span className="acw-chip acw-chip-accent">{OBJECTIVE_LABEL[draft.meta.objective] ?? draft.meta.objective}</span>
        </div>
      </Field>

      {/* Locations first — geo is the key lever for local SMB. */}
      <div className="acw-geo">
        <Field label="Локации">
          <Chips items={s.geography} empty="Город или регион (можно радиус вокруг точки)" />
          <div className="acw-hint">Города и регионы — ключевой таргетинг для локального бизнеса.</div>
        </Field>
      </div>

      <Field label="Возраст и пол">
        <GenderRadios value={s.demographics} />
        <div className="acw-sub-field"><Chips items={s.age} empty="Возраст (например, 18–30)" /></div>
      </Field>

      <Field label="Детальный таргетинг">
        <Chips items={mapInterests(s.interests)} empty="Интересы и поведение" />
      </Field>

      <Field label="Источник аудитории">
        <div className="acw-meta-audience">Custom Audience (данные оператора) · совпадение ≈ 60% · ≈ {reach} профилей</div>
        <div className="acw-toggle-row">
          <span>Похожая аудитория (lookalike)</span>
          <span className={`acw-toggle${draft.meta.lookalike ? " on" : ""}`} />
        </div>
      </Field>

      <Field label="Плейсменты">
        <div className="acw-chips">
          {ALL_PLACEMENTS.map((p) => {
            const on = draft.meta.placements.includes(p);
            return (
              <span key={p} className={`acw-chip${on ? " acw-chip-accent" : " acw-chip-off"}`}>
                <PlatformDot platform={p} />{PLACEMENT_LABEL[p]}
              </span>
            );
          })}
        </div>
      </Field>
    </>
  );
}

// ── Audience step — operator channels (SMS/Email) ────────────────────────────────

function OperatorSegmentsStep({ draft }: { draft: CampaignDraft }) {
  const s = draft.segments;
  return (
    <>
      {s.matched_segment_name && (
        <Field label="Сегмент абонентской базы">
          <div className="acw-chips"><span className="acw-chip acw-chip-accent">{s.matched_segment_name}</span></div>
        </Field>
      )}
      <Field label="География" badge="0.3 ₽">
        <Chips items={s.geography} empty="Регион или город" />
      </Field>
      <Field label="Демография" badge="0.3 ₽">
        <GenderRadios value={s.demographics} />
        <div className="acw-sub-field"><Chips items={s.age} empty="Возраст" /></div>
      </Field>
      <Field label="Доход и пополнения">
        <Chips items={[s.monthly_income, s.deposits_per_month].filter(Boolean) as string[]} empty="Доход / пополнения в месяц" />
      </Field>
      <Field label="Интересы и доп. признаки">
        <Chips items={mapInterests(s.interests)} empty="Интересы" />
        <div className="acw-sub-field"><Chips items={s.children_age} empty="Возраст детей" /></div>
      </Field>
      <div className="acw-toggle-row">
        <span>Триггеры</span>
        <span className={`acw-toggle${s.triggers_enabled ? " on" : ""}`} />
      </div>
    </>
  );
}

function SegmentsStep({ draft }: { draft: CampaignDraft }) {
  return isNetworkChannel(draft.channel)
    ? <MetaAudienceStep draft={draft} />
    : <OperatorSegmentsStep draft={draft} />;
}

// ── Message step ─────────────────────────────────────────────────────────────────

function MessageStep({ draft }: { draft: CampaignDraft }) {
  const m = draft.message;
  const network = isNetworkChannel(draft.channel);
  return (
    <>
      {!network && (
        <Field label="Отправитель">
          <div className="acw-input-mock">{m.sender || <span className="acw-placeholder">Имя отправителя</span>}</div>
        </Field>
      )}
      <Field label={network ? "Текст объявления" : "Текст сообщения"}>
        <div className="acw-textarea-mock">
          {m.text || <span className="acw-placeholder">Агент заполнит текст здесь…</span>}
        </div>
      </Field>
      {m.variants.length > 0 && (
        <Field label="Сгенерированные варианты">
          <div className="acw-variants">
            {m.variants.map((v, i) => (
              <div key={i} className={`acw-variant${v === m.text ? " selected" : ""}`}>
                <span className="acw-variant-idx">{i + 1}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </Field>
      )}
    </>
  );
}

// ── Cost step ────────────────────────────────────────────────────────────────────

function CostStep({ draft }: { draft: CampaignDraft }) {
  const c = draft.cost;
  const network = isNetworkChannel(draft.channel);
  return (
    <>
      <Field label="Бюджет">
        <div className="acw-input-mock">
          {c.budget != null ? `${fmt(c.budget)} ₽` : <span className="acw-placeholder">Бюджет кампании, ₽</span>}
        </div>
        {network ? (
          draft.estimated_impressions > 0 && (
            <div className="acw-hint">≈ {fmt(draft.estimated_impressions)} показов при CPM {draft.cpm} ₽</div>
          )
        ) : (
          <div className="acw-sub-field">
            <div className="acw-input-mock">
              {c.messages_count != null ? `${fmt(c.messages_count)} сообщений` : <span className="acw-placeholder">Число сообщений</span>}
            </div>
          </div>
        )}
      </Field>
      <Field label="Условия кампании">
        <div className="acw-two-col">
          <div className="acw-input-mock">{c.start_date || <span className="acw-placeholder">Дата начала</span>}</div>
          <div className="acw-input-mock">{c.end_date || <span className="acw-placeholder">Дата окончания</span>}</div>
        </div>
        <div className="acw-two-col">
          <div className="acw-input-mock">{c.time_from || <span className="acw-placeholder">С</span>}</div>
          <div className="acw-input-mock">{c.time_to || <span className="acw-placeholder">До</span>}</div>
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
    rows.push(["Плейсменты", placements || "Facebook, Instagram"]);
    rows.push(["Похожая аудитория", draft.meta.lookalike ? "Да" : "Нет"]);
    rows.push(["Custom Audience", fmt(draft.audience_reach)]);
    rows.push(["CPM", `${draft.cpm} ₽`]);
    rows.push(["Ожидаемые показы", fmt(draft.estimated_impressions)]);
  } else {
    rows.push(["Доход", s.monthly_income || "—"]);
    rows.push(["Возраст детей", s.children_age.join(", ") || "—"]);
  }
  return (
    <>
      <div className="acw-section-title">Параметры аудитории</div>
      <div className="acw-summary">
        {rows.map(([k, v]) => (
          <div key={k} className="acw-summary-row"><span>{k}</span><span>{v}</span></div>
        ))}
      </div>
      <Field label="Название кампании">
        <div className="acw-input-mock">{draft.name || <span className="acw-placeholder">Название</span>}</div>
      </Field>
      {draft.message.text && (
        <Field label="Сообщение"><div className="acw-textarea-mock">{draft.message.text}</div></Field>
      )}
      {network && <AnalyticsPreview draft={draft} />}
      {draft.status === "submitted" && (
        <div className="acw-submitted">✓ Отправлено на модерацию</div>
      )}
    </>
  );
}

// Analytics preview — concept of the per-platform reporting the Insights API will
// fill after launch (publisher_platform breakdown). Clearly marked as a preview.
function AnalyticsPreview({ draft }: { draft: CampaignDraft }) {
  const rows = draft.platform_breakdown.length
    ? draft.platform_breakdown
    : [{ platform: "facebook", label: "Facebook", impressions: 0, reach: 0 }];
  const ctr: Record<string, number> = { facebook: 0.012, instagram: 0.016, messenger: 0.008, audience_network: 0.006 };
  const cvr: Record<string, number> = { facebook: 0.03, instagram: 0.035, messenger: 0.02, audience_network: 0.015 };
  const cpm = draft.cpm || 0;
  return (
    <Field label="Аналитика после запуска (предпросмотр)">
      <div className="acw-analytics">
        <div className="acw-analytics-head acw-analytics-row">
          <span>Платформа</span><span>Показы</span><span>Охват</span><span>CTR</span><span>CPM</span><span>Конв.</span>
        </div>
        {rows.map((p) => {
          const clicks = Math.round(p.impressions * (ctr[p.platform] ?? 0.01));
          const conversions = Math.round(clicks * (cvr[p.platform] ?? 0.025));
          return (
            <div key={p.platform} className="acw-analytics-row">
              <span className="acw-platform-name"><PlatformDot platform={p.platform} />{p.label}</span>
              <span>{fmt(p.impressions)}</span>
              <span>{fmt(p.reach)}</span>
              <span>{((ctr[p.platform] ?? 0.01) * 100).toFixed(1)}%</span>
              <span>{cpm} ₽</span>
              <span>{fmt(conversions)}</span>
            </div>
          );
        })}
        <div className="acw-analytics-note">
          Демо-данные. После запуска подтянутся из Meta Insights — breakdown по платформам,
          плейсментам (Feed / Stories / Reels), полу, возрасту и гео.
        </div>
      </div>
    </Field>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────────

export function CampaignWizard({ draft }: { draft: CampaignDraft }) {
  const step = activeStep(draft);
  const submitted = draft.status === "submitted";
  const isLast = step === "confirmation";

  const content = {
    channel: <ChannelStep draft={draft} />,
    segments: <SegmentsStep draft={draft} />,
    message: <MessageStep draft={draft} />,
    cost: <CostStep draft={draft} />,
    confirmation: <ConfirmationStep draft={draft} />,
  }[step];

  return (
    <div className="acw">
      <div className="acw-titlebar">
        <span>{submitted ? draft.name || "Рекламная кампания" : "Создание рекламной кампании"}</span>
        <span className="acw-titlebar-actions">⧉ 🗑</span>
      </div>

      <StepBar draft={draft} />

      <div className="acw-grid">
        <div className="acw-content">{content}</div>
        <ReachPanel draft={draft} />
      </div>

      <div className="acw-nav">
        {step !== "channel" && <button className="acw-btn acw-btn-ghost" type="button">Назад</button>}
        <button className={`acw-btn acw-btn-primary${submitted ? " done" : ""}`} type="button">
          {submitted ? "Отправлено" : isLast ? "Отправить на модерацию" : "Продолжить"}
        </button>
      </div>
    </div>
  );
}

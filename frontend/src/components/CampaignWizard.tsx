/**
 * CampaignWizard — live reflection of the agent's `campaign_draft` on the
 * AdConnect campaign wizard. As the campaign-builder agent fills the draft turn
 * by turn, this canvas shows the matching wizard step pre-filled (channel,
 * segments, message, cost, confirmation) plus the reach/price panel.
 *
 * Read-only: the agent drives via chat; the canvas displays state. The active
 * step follows `draft.step`.
 */

import { isNetworkChannel, type CampaignDraft, type WizardStep } from "../types/campaign";
import { NETWORK_CHANNELS, OPERATOR_CHANNELS, type ChannelCard } from "./channels";

const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", email: "Email", meta: "Meta" };
function channelLabel(c: string | null): string {
  return c ? CHANNEL_LABEL[c] ?? c.toUpperCase() : "New";
}

const OBJECTIVE_LABEL: Record<string, string> = {
  awareness: "Узнаваемость", traffic: "Трафик", engagement: "Вовлечённость",
  leads: "Лиды", sales: "Продажи",
};
const PLACEMENT_LABEL: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram",
  messenger: "Messenger", audience_network: "Audience Network",
};
const ALL_PLACEMENTS = ["facebook", "instagram", "messenger", "audience_network"];

const STEP_LABELS: Record<Exclude<WizardStep, "ready">, string> = {
  channel: "Sending Channel",
  segments: "Segments",
  message: "Message",
  cost: "Cost",
  confirmation: "Confirmation",
};
const STEP_ORDER: Array<Exclude<WizardStep, "ready">> = [
  "channel", "segments", "message", "cost", "confirmation",
];

function fmt(n: number): string {
  return n.toLocaleString("ru-RU").replace(/,/g, " ");
}

function activeStep(draft: CampaignDraft): Exclude<WizardStep, "ready"> {
  return draft.step === "ready" ? "confirmation" : draft.step;
}

// ── Step progress bar ──────────────────────────────────────────────────────────

function StepBar({ draft }: { draft: CampaignDraft }) {
  const current = activeStep(draft);
  const currentIdx = STEP_ORDER.indexOf(current);
  const submitted = draft.status === "submitted";
  return (
    <div className="acw-typecard">
      <div className="acw-typename">{draft.channel ? `${channelLabel(draft.channel)} Campaign` : "New Campaign"}</div>
      <div className="acw-steps">
        {STEP_ORDER.map((step, i) => {
          const done = submitted || i < currentIdx;
          const active = !submitted && i === currentIdx;
          return (
            <div key={step} className="acw-step">
              <div className={`acw-step-bar${done ? " done" : ""}${active ? " active" : ""}`} />
              <span className={`acw-step-label${done || active ? " on" : ""}`}>{STEP_LABELS[step]}</span>
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
      <div className="acw-reach-cap">{network ? "Custom Audience" : "Audience reach"}</div>
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
                  <span>{p.label}</span><span>{fmt(p.impressions)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="acw-price-num">{draft.price_per_message || 0} ₽ <span className="acw-info">ⓘ</span></div>
          <div className="acw-reach-cap">Price per message</div>
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

// ── Segments step ────────────────────────────────────────────────────────────────

function MetaSetup({ draft }: { draft: CampaignDraft }) {
  return (
    <Field label="Meta setup">
      <div className="acw-meta-setup">
        <div className="acw-meta-row">
          <span className="acw-meta-k">Цель</span>
          <span>{OBJECTIVE_LABEL[draft.meta.objective] ?? draft.meta.objective}</span>
        </div>
        <div className="acw-meta-row">
          <span className="acw-meta-k">Плейсменты</span>
          <span className="acw-chips">
            {ALL_PLACEMENTS.map((p) => (
              <span key={p} className={`acw-chip${draft.meta.placements.includes(p) ? " acw-chip-accent" : " acw-chip-off"}`}>
                {PLACEMENT_LABEL[p]}
              </span>
            ))}
          </span>
        </div>
        <div className="acw-toggle-row">
          <span>Похожая аудитория (lookalike)</span>
          <span className={`acw-toggle${draft.meta.lookalike ? " on" : ""}`} />
        </div>
      </div>
    </Field>
  );
}

function SegmentsStep({ draft }: { draft: CampaignDraft }) {
  const s = draft.segments;
  return (
    <>
      {isNetworkChannel(draft.channel) && <MetaSetup draft={draft} />}
      {s.matched_segment_name && (
        <Field label="Template / matched segment">
          <div className="acw-chips"><span className="acw-chip acw-chip-accent">{s.matched_segment_name}</span></div>
        </Field>
      )}
      <Field label="Geography" badge="0.3 ₽">
        <Chips items={s.geography} empty="Region or city" />
      </Field>
      <Field label="Demographics" badge="0.3 ₽">
        <div className="acw-radios">
          {(["all", "men", "women"] as const).map((d) => (
            <label key={d} className="acw-radio-row">
              <span className={`acw-radio${s.demographics === d ? " on" : ""}`} />
              <span>{d === "all" ? "All" : d === "men" ? "Men" : "Woman"}</span>
            </label>
          ))}
        </div>
        <div className="acw-sub-field"><Chips items={s.age} empty="Age" /></div>
      </Field>
      <Field label="Income & Top-Ups">
        <Chips items={[s.monthly_income, s.deposits_per_month].filter(Boolean) as string[]} empty="Monthly income / deposits" />
      </Field>
      <Field label="Interests & Additional Traits">
        <Chips items={s.interests} empty="Interests" />
        <div className="acw-sub-field"><Chips items={s.children_age} empty="Age of the children" /></div>
      </Field>
      <div className="acw-toggle-row">
        <span>Triggers</span>
        <span className={`acw-toggle${s.triggers_enabled ? " on" : ""}`} />
      </div>
    </>
  );
}

// ── Message step ─────────────────────────────────────────────────────────────────

function MessageStep({ draft }: { draft: CampaignDraft }) {
  const m = draft.message;
  return (
    <>
      <Field label="Sender">
        <div className="acw-input-mock">{m.sender || <span className="acw-placeholder">Sender name</span>}</div>
      </Field>
      <Field label="Message text">
        <div className="acw-textarea-mock">
          {m.text || <span className="acw-placeholder">The agent will fill the message text here…</span>}
        </div>
      </Field>
      {m.variants.length > 0 && (
        <Field label="Generated variants">
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
      <Field label="Cost">
        <div className="acw-input-mock">
          {c.budget != null ? `${fmt(c.budget)} ₽` : <span className="acw-placeholder">Your campaign budget, ₽</span>}
        </div>
        {network ? (
          draft.estimated_impressions > 0 && (
            <div className="acw-hint">≈ {fmt(draft.estimated_impressions)} показов при CPM {draft.cpm} ₽</div>
          )
        ) : (
          <div className="acw-sub-field">
            <div className="acw-input-mock">
              {c.messages_count != null ? `${fmt(c.messages_count)} messages` : <span className="acw-placeholder">Number of messages</span>}
            </div>
          </div>
        )}
      </Field>
      <Field label="Ad Campaign Conditions">
        <div className="acw-two-col">
          <div className="acw-input-mock">{c.start_date || <span className="acw-placeholder">Start date</span>}</div>
          <div className="acw-input-mock">{c.end_date || <span className="acw-placeholder">End date</span>}</div>
        </div>
        <div className="acw-two-col">
          <div className="acw-input-mock">{c.time_from || <span className="acw-placeholder">From</span>}</div>
          <div className="acw-input-mock">{c.time_to || <span className="acw-placeholder">To</span>}</div>
        </div>
        <div className="acw-toggle-row"><span>Uniform distribution</span><span className={`acw-toggle${c.uniform_distribution ? " on" : ""}`} /></div>
        <div className="acw-toggle-row"><span>Autorun</span><span className={`acw-toggle${c.autorun ? " on" : ""}`} /></div>
      </Field>
    </>
  );
}

// ── Confirmation step ────────────────────────────────────────────────────────────

function ConfirmationStep({ draft }: { draft: CampaignDraft }) {
  const s = draft.segments;
  const network = isNetworkChannel(draft.channel);
  const rows: Array<[string, string]> = [
    ["Channel", channelLabel(draft.channel)],
    ["Demographics", s.demographics === "all" ? "All" : s.demographics],
    ["Geography", s.geography.join(", ") || "Russia"],
    ["Age", s.age.join(", ") || "—"],
    ["Interests", s.interests.join(", ") || "—"],
  ];
  if (network) {
    const placements = draft.meta.placements.map((p) => PLACEMENT_LABEL[p] ?? p).join(", ");
    rows.push(["Objective", OBJECTIVE_LABEL[draft.meta.objective] ?? draft.meta.objective]);
    rows.push(["Placements", placements || "Facebook, Instagram"]);
    rows.push(["Lookalike", draft.meta.lookalike ? "Да" : "Нет"]);
    rows.push(["Custom Audience", fmt(draft.audience_reach)]);
    rows.push(["CPM", `${draft.cpm} ₽`]);
    rows.push(["Est. impressions", fmt(draft.estimated_impressions)]);
  } else {
    rows.push(["Income", s.monthly_income || "—"]);
    rows.push(["Age of the children", s.children_age.join(", ") || "—"]);
  }
  return (
    <>
      <div className="acw-section-title">Audience parameters</div>
      <div className="acw-summary">
        {rows.map(([k, v]) => (
          <div key={k} className="acw-summary-row"><span>{k}</span><span>{v}</span></div>
        ))}
      </div>
      <Field label="The name of the advertising campaign">
        <div className="acw-input-mock">{draft.name || <span className="acw-placeholder">Campaign name</span>}</div>
      </Field>
      {draft.message.text && (
        <Field label="Message"><div className="acw-textarea-mock">{draft.message.text}</div></Field>
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
  // Illustrative CTR/CPM per platform for the preview.
  const ctr: Record<string, string> = { facebook: "1.2%", instagram: "1.6%", messenger: "0.8%", audience_network: "0.6%" };
  return (
    <Field label="Аналитика после запуска (предпросмотр)">
      <div className="acw-analytics">
        <div className="acw-analytics-head acw-analytics-row">
          <span>Платформа</span><span>Показы</span><span>Охват</span><span>CTR</span>
        </div>
        {rows.map((p) => (
          <div key={p.platform} className="acw-analytics-row">
            <span>{p.label}</span>
            <span>{fmt(p.impressions)}</span>
            <span>{fmt(p.reach)}</span>
            <span>{ctr[p.platform] ?? "1.0%"}</span>
          </div>
        ))}
        <div className="acw-analytics-note">
          Реальные данные подтянутся из Meta Insights (breakdown по платформам и плейсментам) после запуска.
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
        <span>{submitted ? draft.name || "Advertising campaign" : "Create an advertising campaign"}</span>
        <span className="acw-titlebar-actions">⧉ 🗑</span>
      </div>

      <StepBar draft={draft} />

      <div className="acw-grid">
        <div className="acw-content">{content}</div>
        <ReachPanel draft={draft} />
      </div>

      <div className="acw-nav">
        {step !== "channel" && <button className="acw-btn acw-btn-ghost" type="button">Back</button>}
        <button className={`acw-btn acw-btn-primary${submitted ? " done" : ""}`} type="button">
          {submitted ? "Submitted" : isLast ? "Submit for moderation" : "Continue"}
        </button>
      </div>
    </div>
  );
}

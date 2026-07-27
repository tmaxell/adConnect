import { useEffect, useMemo, useRef, useState } from "react";
import {
  useChatWorkspaceStore,
  type ChatEntry,
} from "../chat-workspace/store/chatWorkspaceStore";
import type { ChatAction, ChatTraceEvent, ChatSession } from "../api/chatApi";
import { MarkdownText } from "./MarkdownText";
import { Sources } from "./Sources";
import { t } from "../i18n";

type WidgetMode = "fab" | "panel" | "expanded";
type HistoryMode = "closed" | "open";

function suggestions(): { label: string; prompt: string }[] {
  return [
    { label: t("Создать рекламную кампанию", "Create an ad campaign"), prompt: t("Создай рекламную кампанию для моего бизнеса", "Create an ad campaign for my business") },
    { label: t("Подобрать аудиторию", "Pick an audience"), prompt: t("Подбери аудиторию для моей кампании", "Pick an audience for my campaign") },
    { label: t("Сгенерировать креатив", "Generate a creative"), prompt: t("Сгенерируй варианты текста для моего объявления", "Generate copy variants for my ad") },
    { label: t("Рассчитать охват и бюджет", "Estimate reach and budget"), prompt: t("Помоги рассчитать охват и бюджет кампании", "Help me estimate the campaign's reach and budget") },
    { label: t("Вопрос по платформе", "Ask about the platform"), prompt: t("Как создать рекламную кампанию в AdConnect?", "How do I create an ad campaign in AdConnect?") },
  ];
}

function actionLabel(id: string): string | undefined {
  switch (id) {
    case "save_campaign": return t("Сохранить кампанию", "Save campaign");
    case "save_segment": return t("Сохранить сегмент", "Save segment");
    case "save_target_group": return t("Сохранить таргет-группу", "Save target group");
    case "apply_segment": return t("Применить сегмент", "Apply segment");
    case "build_campaign_from_segment": return t("Создать кампанию из сегмента", "Create campaign from segment");
    case "refine_campaign": return t("Доработать", "Refine");
    case "open_artifact": return t("Открыть артефакт", "Open artifact");
    case "start_campaign": return t("Запустить кампанию", "Start campaign");
    case "pause_campaign": return t("Поставить на паузу", "Pause");
    default: return undefined;
  }
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function groupSessions(sessions: ChatSession[]): { label: string; items: ChatSession[] }[] {
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const today: ChatSession[] = [];
  const yday: ChatSession[] = [];
  const earlier: ChatSession[] = [];
  for (const s of sessions) {
    const d = s.updatedAt ? new Date(s.updatedAt) : null;
    if (!d || Number.isNaN(d.getTime())) earlier.push(s);
    else if (isSameDay(d, now)) today.push(s);
    else if (isSameDay(d, yesterday)) yday.push(s);
    else earlier.push(s);
  }
  return [
    { label: t("Сегодня", "Today"), items: today },
    { label: t("Вчера", "Yesterday"), items: yday },
    { label: t("Ранее", "Earlier"), items: earlier },
  ].filter((g) => g.items.length > 0);
}

// ── SVG icons ────────────────────────────────────────────────────────────────

// AI-sparkle / фрактальный ромб — стандартная AI-иконка (Gemini/Copilot-style):
// крупная 4-лучевая звезда + маленькая в правом-верхнем углу.
const ChatIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M11.25 2.5c.18 4.41 2.34 6.57 6.75 6.75v.5c-4.41.18-6.57 2.34-6.75 6.75h-.5c-.18-4.41-2.34-6.57-6.75-6.75v-.5c4.41-.18 6.57-2.34 6.75-6.75h.5z"
      fill="#fff"
    />
    <path
      d="M18.25 14.5c.1 2.42 1.33 3.65 3.75 3.75v.5c-2.42.1-3.65 1.33-3.75 3.75h-.5c-.1-2.42-1.33-3.65-3.75-3.75v-.5c2.42-.1 3.65-1.33 3.75-3.75h.5z"
      fill="#fff"
      opacity="0.85"
    />
  </svg>
);
const HistoryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
);
const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
  </svg>
);
const MinimizeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 12h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);
const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
  </svg>
);
const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 8l12-5-5 12-2-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none"/>
  </svg>
);
const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 7V3h4M13 9v4h-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const CompressIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M7 3v4H3M9 13v-4h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ── Plan / trace ─────────────────────────────────────────────────────────────

function PlanCard({ trace }: { trace: ChatTraceEvent[] | undefined }) {
  if (!trace || trace.length === 0) return null;
  const visible = trace.filter((t) => ["plan_created", "step_started", "tool_called", "step_completed", "run_completed", "run_failed"].includes(t.event));
  if (visible.length === 0) return null;
  return (
    <details className="fw-plan">
      <summary>{t("План вызова агентов", "Agent invocation plan")} · {visible.length} {t("шагов", "steps")}</summary>
      <div className="fw-plan-steps">
        {visible.map((e, i) => (
          <div key={i} className={`fw-plan-step ${e.status}`}>
            <span>
              <strong>{e.event}</strong>
              {e.detail ? <> · {e.detail}</> : null}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

// ── Action cards ─────────────────────────────────────────────────────────────

function ActionCards({
  actions,
  onAct,
  pending,
}: {
  actions: ChatAction[];
  onAct: (action: ChatAction) => void;
  pending: boolean;
}) {
  if (!actions || actions.length === 0) return null;
  const saveActions = actions.filter((a) => a.id === "save_campaign" || a.id === "save_segment" || a.id === "save_target_group");
  const otherActions = actions.filter((a) => !saveActions.includes(a));

  return (
    <>
      {saveActions.length > 0 && (
        <div className="fw-action-card">
          <div className="fw-action-card-title">{t("Предлагаемые сохранения", "Suggested saves")}</div>
          <div className="fw-action-card-body">
            {t("Агент подготовил артефакт. Сохраните его, чтобы переиспользовать в следующих шагах.", "The agent prepared an artifact. Save it to reuse in the next steps.")}
          </div>
          <div className="fw-action-card-buttons">
            {saveActions.map((a) => (
              <button key={a.id} className="primary" disabled={pending} onClick={() => onAct(a)}>
                {actionLabel(a.id) ?? a.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {otherActions.length > 0 && (
        <div className="fw-quick-actions">
          {otherActions.map((a) => (
            <button key={`${a.id}-${a.label}`} disabled={pending} onClick={() => onAct(a)} className="fw-quick-action">
              {a.label || actionLabel(a.id) || a.id}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function MessageBubble({ msg, onAction, pending, isLast }: { msg: ChatEntry; onAction: (a: ChatAction) => void; pending: boolean; isLast: boolean; }) {
  return (
    <>
      <div className={`fw-msg ${msg.role}`}>
        {msg.role === "user" ? msg.content : <MarkdownText content={msg.content} />}
        <div className="fw-msg-time">{formatTime(msg.createdAt)}</div>
      </div>
      {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
        <Sources citations={msg.citations} />
      )}
      {msg.role === "assistant" && <PlanCard trace={msg.trace} />}
      {msg.role === "assistant" && msg.actions && isLast && (
        <ActionCards actions={msg.actions} onAct={onAction} pending={pending} />
      )}
    </>
  );
}

function ThreadEmpty({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="fw-thread-empty">
      <div className="fw-thread-empty-hint">{t("Спросите про кампании, сегменты, документацию.", "Ask about campaigns, segments, documentation.")}</div>
      <div className="fw-suggestion-grid">
        {suggestions().map((s) => (
          <button key={s.label} className="fw-suggestion" onClick={() => onPick(s.prompt)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryPanel({
  sessions,
  activeId,
  loading,
  onSelect,
  onNew,
  onClose,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => `${s.title} ${s.lastMessagePreview ?? ""}`.toLowerCase().includes(q));
  }, [sessions, query]);
  const groups = groupSessions(filtered);

  return (
    <div className="fw-history">
      <div className="fw-history-toolbar">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Поиск по диалогам", "Search conversations")}
        />
        <button className="fw-btn-primary" onClick={onNew}>+ {t("Новый", "New")}</button>
        <button className="fw-icon-btn" title={t("Закрыть историю", "Close history")} onClick={onClose}><CloseIcon /></button>
      </div>
      <div className="fw-history-list">
        {loading && sessions.length === 0 && (
          <div className="fw-history-empty">{t("Загрузка…", "Loading…")}</div>
        )}
        {!loading && groups.length === 0 && (
          <div className="fw-history-empty">{t("История диалогов пуста", "No conversations yet")}</div>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="fw-history-group-title">{g.label}</div>
            {g.items.map((s) => (
              <button
                key={s.id}
                className={`fw-history-item ${s.id === activeId ? "active" : ""}`}
                onClick={() => onSelect(s.id)}
              >
                <div className="fw-history-item-title">{s.title || t("Без названия", "Untitled")}</div>
                {s.lastMessagePreview && (
                  <div className="fw-history-item-preview">{s.lastMessagePreview}</div>
                )}
                <div className="fw-history-item-meta">
                  <span>{formatTime(s.updatedAt)}</span>
                  {s.status && s.status !== "active" && <span>· {s.status}</span>}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Auto-grow textarea ───────────────────────────────────────────────────────

function AutoGrowTextarea({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
    />
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function FloatingWidget() {
  const {
    sessions,
    activeSessionId,
    messages,
    loadingSessions,
    loadingMessages,
    sending,
    error,
    selectSession,
    createNewChat,
    sendMessage,
    setView,
  } = useChatWorkspaceStore();

  const [mode, setMode] = useState<WidgetMode>("fab");
  const [history, setHistory] = useState<HistoryMode>("closed");
  // В expanded-режиме история по умолчанию открыта как боковая колонка,
  // но её можно свернуть, чтобы окно диалога заняло всю ширину виджета.
  const [expandedSideOpen, setExpandedSideOpen] = useState<boolean>(true);
  const [input, setInput] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages.length, sending]);

  // Dock-режим: даём знать .ac-shell, сколько места под него съели,
  // чтобы шелл с канвасом ужался слева и кампания осталась видимой.
  useEffect(() => {
    if (mode !== "expanded") return;
    const root = document.documentElement;
    // Используем те же min/max, что и в .fw-root-expanded.
    root.style.setProperty("--fw-shell-shrink", "clamp(480px, 50vw, 760px)");
    return () => {
      root.style.removeProperty("--fw-shell-shrink");
    };
  }, [mode]);

  const handlePickSuggestion = (prompt: string) => {
    void sendMessage(prompt);
  };

  const handleAction = (action: ChatAction) => {
    // clarify_reply — отправляем payload.message как обычное user-сообщение, без action.
    if (action.id === "clarify_reply") {
      const text = String((action.payload || {}).message || action.label || "");
      if (text) void sendMessage(text);
      return;
    }
    // open_analytics — навигация на страницу аналитики, без обращения к бэкенду.
    if (action.id === "open_analytics") {
      const cid = (action.payload || {}).campaign_id;
      setView("analytics", typeof cid === "number" ? cid : null);
      return;
    }
    const label = actionLabel(action.id) ?? action.label;
    void sendMessage(label, action);
  };

  const handleSelectSession = async (id: string) => {
    await selectSession(id);
    setHistory("closed");
  };

  const handleNewChat = async () => {
    await createNewChat();
    setHistory("closed");
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendMessage(text);
  };

  if (mode === "fab") {
    return (
      <div className="fw-root">
        <button
          className="fw-fab"
          onClick={() => setMode("panel")}
          aria-label={t("Открыть AdConnect Copilot", "Open AdConnect Copilot")}
          title="AdConnect Copilot"
        >
          <ChatIcon />
        </button>
      </div>
    );
  }

  const isExpanded = mode === "expanded";
  const showSideHistory = isExpanded && expandedSideOpen; // боковая история, скрываемая кнопкой
  const showOverlayHistory = !isExpanded && history === "open";

  return (
    <div className={`fw-root ${isExpanded ? "fw-root-expanded" : ""}`}>
      <div className={`fw-panel ${isExpanded ? "fw-panel-expanded" : ""}`}>
        {showSideHistory && (
          <aside className="fw-side-history">
            <div className="fw-side-history-header">
              <span>{t("История", "History")}</span>
              <button className="fw-btn-primary" onClick={() => void handleNewChat()}>+ {t("Новый", "New")}</button>
            </div>
            <SideHistoryList
              sessions={sessions}
              activeId={activeSessionId}
              loading={loadingSessions}
              onSelect={(id) => void handleSelectSession(id)}
            />
          </aside>
        )}

        <div className="fw-main">
          <header className="fw-header">
            {isExpanded ? (
              <button
                className={`fw-icon-btn ${expandedSideOpen ? "active" : ""}`}
                title={expandedSideOpen ? t("Свернуть историю диалогов", "Collapse conversation history") : t("Показать историю диалогов", "Show conversation history")}
                onClick={() => setExpandedSideOpen(v => !v)}
              >
                <HistoryIcon />
              </button>
            ) : (
              <button
                className={`fw-icon-btn ${history === "open" ? "active" : ""}`}
                title={t("История диалогов", "Conversation history")}
                onClick={() => setHistory(history === "open" ? "closed" : "open")}
              >
                <HistoryIcon />
              </button>
            )}
            <div className="fw-header-title">AdConnect Copilot</div>
            <button className="fw-icon-btn" title={t("Новый диалог", "New conversation")} onClick={() => void handleNewChat()}>
              <PlusIcon />
            </button>
            <button
              className="fw-icon-btn"
              title={isExpanded ? t("Свернуть до компактного режима", "Collapse to compact mode") : t("Развернуть", "Expand")}
              onClick={() => setMode(isExpanded ? "panel" : "expanded")}
            >
              {isExpanded ? <CompressIcon /> : <ExpandIcon />}
            </button>
            <button className="fw-icon-btn" title={t("Свернуть", "Minimize")} onClick={() => setMode("fab")}>
              <MinimizeIcon />
            </button>
          </header>

          <div className="fw-thread" ref={threadRef}>
            {loadingMessages && messages.length === 0 ? (
              <div className="fw-thread-empty">{t("Загрузка…", "Loading…")}</div>
            ) : messages.length === 0 ? (
              <ThreadEmpty onPick={handlePickSuggestion} />
            ) : (
              messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  onAction={handleAction}
                  pending={sending}
                  isLast={i === messages.length - 1}
                />
              ))
            )}
            {sending && <div className="fw-typing">{t("Ассистент думает…", "Assistant is thinking…")}</div>}
          </div>

          {error && <div className="fw-error">{error}</div>}

          <div className="fw-composer">
            <AutoGrowTextarea
              value={input}
              onChange={setInput}
              onSubmit={() => void handleSend()}
              disabled={false}
              placeholder={t("Спросите про кампании, сегменты или документацию…", "Ask about campaigns, segments or documentation…")}
            />
            <button onClick={() => void handleSend()} disabled={sending || !input.trim()} title={t("Отправить", "Send")}>
              <SendIcon />
            </button>
          </div>
        </div>

        {showOverlayHistory && (
          <HistoryPanel
            sessions={sessions}
            activeId={activeSessionId}
            loading={loadingSessions}
            onSelect={(id) => void handleSelectSession(id)}
            onNew={() => void handleNewChat()}
            onClose={() => setHistory("closed")}
          />
        )}
      </div>
    </div>
  );
}

// ── Side history list (для расширенного режима) ──────────────────────────────

function SideHistoryList({
  sessions,
  activeId,
  loading,
  onSelect,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => `${s.title} ${s.lastMessagePreview ?? ""}`.toLowerCase().includes(q));
  }, [sessions, query]);
  const groups = groupSessions(filtered);

  return (
    <div className="fw-side-history-body">
      <input
        className="fw-side-history-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("Поиск по диалогам", "Search conversations")}
      />
      <div className="fw-side-history-list">
        {loading && sessions.length === 0 && <div className="fw-history-empty">{t("Загрузка…", "Loading…")}</div>}
        {!loading && groups.length === 0 && <div className="fw-history-empty">{t("Диалогов нет", "No conversations")}</div>}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="fw-history-group-title">{g.label}</div>
            {g.items.map((s) => (
              <button
                key={s.id}
                className={`fw-history-item ${s.id === activeId ? "active" : ""}`}
                onClick={() => onSelect(s.id)}
              >
                <div className="fw-history-item-title">{s.title || t("Без названия", "Untitled")}</div>
                {s.lastMessagePreview && (
                  <div className="fw-history-item-preview">{s.lastMessagePreview}</div>
                )}
                <div className="fw-history-item-meta">
                  <span>{formatTime(s.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChatApiError,
  createChat,
  generateCopy,
  generateCreative,
  getChat,
  listChats,
  patchDraft,
  sendChat,
  uploadCreative,
  type ChatAction,
  type ChatArtifact,
  type ChatMessage,
  type ChatSession,
  type CopyResult,
  type CreativeResult,
} from "../../api/chatApi";
import type { CampaignFlow } from "../../types/api";
import type { CampaignDraft, MetaFormat, MediaType } from "../../types/campaign";
import { normalizeUpsellFlow } from "../../components/flow/normalizeUpsellFlow";

export interface ChatEntry extends ChatMessage {
  optimistic?: boolean;
}

interface ChatWorkspaceState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatEntry[];
  artifacts: ChatArtifact[];
  draftFlow: CampaignFlow | null;
  campaignDraft: CampaignDraft | null;
  /** Bumps only on agent/session-driven draft changes (not local canvas edits),
   *  so the wizard can follow the agent without yanking the view during clicks. */
  draftRev: number;
  /** Which product screen is shown in the canvas. */
  view: "campaigns" | "analytics" | "profile" | "audiences";
  analyticsCampaignId: number | null;
  setView: (view: "campaigns" | "analytics" | "profile" | "audiences", campaignId?: number | null) => void;
  /** True while the campaign create flow (wizard) is open over the campaigns list. */
  creating: boolean;
  startCreating: () => Promise<void>;
  stopCreating: () => void;
  loadingSessions: boolean;
  loadingMessages: boolean;
  sending: boolean;
  error: string | null;
  selectSession: (id: string) => Promise<void>;
  createNewChat: () => Promise<string>;
  sendMessage: (content: string, action?: ChatAction) => Promise<void>;
  refreshSessions: () => Promise<void>;
  /** Clickable canvas: apply a patch to the draft (creates a session if needed). */
  updateDraft: (patch: Record<string, unknown>) => Promise<void>;
  generateCreative: (params: { format: MetaFormat | "whatsapp_card"; media_type: MediaType; headline?: string | null; prompt?: string | null; card_index?: number | null }) => Promise<CreativeResult | null>;
  generateCopy: (params: { tone?: string | null; brief?: string | null; n?: number }) => Promise<CopyResult | null>;
  uploadCreative: (file: File) => Promise<CreativeResult | null>;
}

const ChatWorkspaceContext = createContext<ChatWorkspaceState | null>(null);

/** Latest `campaign_draft` artifact in the AdConnect wizard shape (has `step`). */
function extractCampaignDraft(artifacts: ChatArtifact[]): CampaignDraft | null {
  for (let i = artifacts.length - 1; i >= 0; i -= 1) {
    const a = artifacts[i];
    if (a.type === "campaign_draft" && a.content && typeof (a.content as { step?: unknown }).step === "string") {
      return a.content as unknown as CampaignDraft;
    }
  }
  return null;
}

function extractDraftFlow(artifacts: ChatArtifact[]): CampaignFlow | null {
  for (let i = artifacts.length - 1; i >= 0; i -= 1) {
    const a = artifacts[i];
    if ((a.type === "draft_flow" || a.type === "campaign_draft") && a.content && Array.isArray((a.content as { activities?: unknown }).activities)) {
      // Старые upsell-артефакты (до коммита 481f51c) лежат в БД линейной
      // цепочкой через nextActivityId — без cases/timeOutNext/subNodes.
      // Нормализатор распознаёт сигнатуру по типам активностей и
      // пересобирает их как DAG, чтобы рендерер корректно показал две ветки.
      const flow = normalizeUpsellFlow(a.content as unknown as CampaignFlow);
      // Безусловно выбрасываем ExcludeFromCampaignActivity из любого
      // draft_flow — на платформе это «удалить клиента из текущей кампании»
      // и для визуализации не нужен (включая случаи, когда сигнатура
      // upsell не совпала и normalizer вернул flow как есть).
      const activities = (flow.activities ?? []).filter(
        a => a.type !== "ExcludeFromCampaignActivity",
      );
      // Если предыдущая нода ссылалась на Exclude через nextActivityId —
      // переподключаем её на то, на что ссылался Exclude (или null).
      const removedIds = new Set(
        (flow.activities ?? [])
          .filter(a => a.type === "ExcludeFromCampaignActivity")
          .map(a => a.id),
      );
      if (removedIds.size > 0) {
        const nextOfRemoved = new Map<string, string | null>();
        for (const a of flow.activities ?? []) {
          if (removedIds.has(a.id)) nextOfRemoved.set(a.id, a.nextActivityId ?? null);
        }
        for (const a of activities) {
          if (a.nextActivityId && removedIds.has(a.nextActivityId)) {
            a.nextActivityId = nextOfRemoved.get(a.nextActivityId) ?? null;
          }
        }
      }
      return { ...flow, activities };
    }
  }
  return null;
}

function toError(err: unknown): string {
  if (err instanceof ChatApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Неизвестная ошибка";
}

export function ChatWorkspaceProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [artifacts, setArtifacts] = useState<ChatArtifact[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRev, setDraftRev] = useState(0);
  const [view, setViewState] = useState<"campaigns" | "analytics" | "profile" | "audiences">("campaigns");
  const [analyticsCampaignId, setAnalyticsCampaignId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const userActedRef = useRef(false);
  const bumpDraft = useCallback(() => setDraftRev((r) => r + 1), []);
  const setView = useCallback((v: "campaigns" | "analytics" | "profile" | "audiences", campaignId: number | null = null) => {
    setViewState(v);
    setAnalyticsCampaignId(campaignId);
    setCreating(false);            // navigating via the sidebar always leaves the create flow
  }, []);

  const refreshSessions = useCallback(async (silent = false) => {
    setLoadingSessions(true);
    try {
      const list = await listChats();
      setSessions(list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")));
      setError(null);
    } catch (e) {
      // Не показываем "сервис недоступен" пока пользователь не начал действовать —
      // backend часто стартует чуть позже фронта.
      if (!silent && userActedRef.current) {
        setError(toError(e));
      }
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  // Initial load: silent retry до 5 раз с шагом 1.5с.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tryLoad = async () => {
      attempts += 1;
      try {
        const list = await listChats();
        if (!cancelled) {
          setSessions(list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")));
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        if (attempts < 5) {
          setTimeout(tryLoad, 1500);
        }
      }
    };
    void tryLoad();
    return () => { cancelled = true; };
  }, []);

  const didAutoSelectRef = useRef(false);

  const selectSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setLoadingMessages(true);
    setError(null);
    try {
      const detail = await getChat(sessionId);
      setMessages(detail.messages.map((m) => ({ ...m })));
      setArtifacts(detail.artifacts);
      bumpDraft();
    } catch (e) {
      setError(toError(e));
      setMessages([]);
      setArtifacts([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [bumpDraft]);

  // Авто-выбор самой свежей сессии на старте. Раньше история подтягивалась
  // только после первого отправленного сообщения — при перезаходе на страницу
  // холст и переписка были пустыми до клика. Делаем один раз через ref,
  // чтобы автоселект не «прыгал» обратно после createNewChat / refreshSessions.
  useEffect(() => {
    if (didAutoSelectRef.current) return;
    if (sessions.length === 0) return;
    if (activeSessionId) { didAutoSelectRef.current = true; return; }
    didAutoSelectRef.current = true;
    void selectSession(sessions[0].id);
  }, [sessions, activeSessionId, selectSession]);

  const createNewChat = useCallback(async () => {
    setError(null);
    try {
      const session = await createChat();
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)]);
      setActiveSessionId(session.id);
      setMessages([]);
      setArtifacts([]);
      bumpDraft();
      return session.id;
    } catch (e) {
      setError(toError(e));
      throw e;
    }
  }, [bumpDraft]);

  const sendMessage = useCallback(
    async (content: string, action?: ChatAction) => {
      if (!content.trim() && !action) return;
      let sessionId = activeSessionId;
      if (!sessionId) {
        sessionId = await createNewChat();
      }
      setError(null);
      setSending(true);
      userActedRef.current = true;

      const userTmpId = `tmp-${Date.now()}`;
      const userMsg: ChatEntry = {
        id: userTmpId,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
        optimistic: true,
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const response = await sendChat(sessionId, content, action);
        const assistantMsg: ChatEntry = {
          id: `srv-${Date.now()}`,
          role: "assistant",
          content: response.assistant_message,
          createdAt: new Date().toISOString(),
          trace: response.trace,
          actions: response.actions_available,
        };
        setMessages((prev) => [...prev.filter((m) => m.id !== userTmpId), { ...userMsg, optimistic: false }, assistantMsg]);
        if (response.artifacts.length > 0) {
          setArtifacts((prev) => {
            const map = new Map<string, ChatArtifact>();
            for (const a of prev) map.set(a.id, a);
            for (const a of response.artifacts) map.set(a.id, a);
            return Array.from(map.values());
          });
        }
        // Подтягиваем canonical state с сервера — citations/trace в metadata теперь там.
        try {
          const detail = await getChat(sessionId);
          setMessages(detail.messages.map((m) => ({ ...m })));
          setArtifacts(detail.artifacts);
          bumpDraft();
          // The Copilot just produced/updated a campaign → open the create flow.
          if (detail.artifacts.some((a) => a.type === "campaign_draft")) setCreating(true);
        } catch {
          // если перезагрузка не удалась — оставляем оптимистичный state
        }
        void refreshSessions(true);
      } catch (e) {
        setError(toError(e));
        setMessages((prev) => prev.filter((m) => m.id !== userTmpId));
      } finally {
        setSending(false);
      }
    },
    [activeSessionId, createNewChat, refreshSessions, bumpDraft],
  );

  // Upsert the canvas-edited draft as the latest campaign_draft artifact so the
  // wizard re-renders immediately (extractCampaignDraft returns the last match).
  const mergeDraftArtifact = useCallback((draft: CampaignDraft) => {
    setArtifacts((prev) => {
      const kept = prev.filter((a) => a.id !== "canvas-draft");
      return [...kept, {
        id: "canvas-draft",
        type: "campaign_draft",
        title: null,
        content: draft as unknown as Record<string, unknown>,
        metadata: {},
      }];
    });
  }, []);

  const updateDraft = useCallback(
    async (patch: Record<string, unknown>) => {
      let sessionId = activeSessionId;
      if (!sessionId) sessionId = await createNewChat();
      userActedRef.current = true;
      try {
        const draft = await patchDraft(sessionId, patch);
        mergeDraftArtifact(draft);
      } catch (e) {
        setError(toError(e));
      }
    },
    [activeSessionId, createNewChat, mergeDraftArtifact],
  );

  // Enter the create flow (wizard) over the campaigns list; ensures a draft exists.
  const startCreating = useCallback(async () => {
    setViewState("campaigns");
    setAnalyticsCampaignId(null);
    await updateDraft({});
    setCreating(true);
  }, [updateDraft]);
  const stopCreating = useCallback(() => setCreating(false), []);

  const generateCreativeAction = useCallback(
    async (params: { format: MetaFormat | "whatsapp_card"; media_type: MediaType; headline?: string | null; prompt?: string | null; card_index?: number | null }) => {
      let sessionId = activeSessionId;
      if (!sessionId) sessionId = await createNewChat();
      userActedRef.current = true;
      try {
        const result = await generateCreative(sessionId, {
          format: params.format,
          media_type: params.media_type === "video" ? "video" : "image",
          headline: params.headline ?? null,
          prompt: params.prompt ?? null,
          card_index: params.card_index ?? null,
        });
        mergeDraftArtifact(result.draft);
        return result;
      } catch (e) {
        setError(toError(e));
        return null;
      }
    },
    [activeSessionId, createNewChat, mergeDraftArtifact],
  );

  const generateCopyAction = useCallback(
    async (params: { tone?: string | null; brief?: string | null; n?: number }) => {
      let sessionId = activeSessionId;
      if (!sessionId) sessionId = await createNewChat();
      userActedRef.current = true;
      try {
        const result = await generateCopy(sessionId, params);
        mergeDraftArtifact(result.draft);
        return result;
      } catch (e) {
        setError(toError(e));
        return null;
      }
    },
    [activeSessionId, createNewChat, mergeDraftArtifact],
  );

  const uploadCreativeAction = useCallback(
    async (file: File) => {
      let sessionId = activeSessionId;
      if (!sessionId) sessionId = await createNewChat();
      userActedRef.current = true;
      try {
        const result = await uploadCreative(sessionId, file);
        mergeDraftArtifact(result.draft);
        return result;
      } catch (e) {
        setError(toError(e));
        return null;
      }
    },
    [activeSessionId, createNewChat, mergeDraftArtifact],
  );

  const draftFlow = useMemo(() => extractDraftFlow(artifacts), [artifacts]);
  const campaignDraft = useMemo(() => extractCampaignDraft(artifacts), [artifacts]);

  const value = useMemo<ChatWorkspaceState>(
    () => ({
      sessions,
      activeSessionId,
      messages,
      artifacts,
      draftFlow,
      campaignDraft,
      draftRev,
      view,
      analyticsCampaignId,
      setView,
      creating,
      startCreating,
      stopCreating,
      loadingSessions,
      loadingMessages,
      sending,
      error,
      selectSession,
      createNewChat,
      sendMessage,
      refreshSessions,
      updateDraft,
      generateCreative: generateCreativeAction,
      generateCopy: generateCopyAction,
      uploadCreative: uploadCreativeAction,
    }),
    [
      sessions,
      activeSessionId,
      messages,
      artifacts,
      draftFlow,
      campaignDraft,
      draftRev,
      view,
      analyticsCampaignId,
      setView,
      creating,
      startCreating,
      stopCreating,
      loadingSessions,
      loadingMessages,
      sending,
      error,
      selectSession,
      createNewChat,
      sendMessage,
      refreshSessions,
      updateDraft,
      generateCreativeAction,
      generateCopyAction,
      uploadCreativeAction,
    ],
  );

  return <ChatWorkspaceContext.Provider value={value}>{children}</ChatWorkspaceContext.Provider>;
}

export function useChatWorkspaceStore() {
  const ctx = useContext(ChatWorkspaceContext);
  if (!ctx) throw new Error("useChatWorkspaceStore must be used inside ChatWorkspaceProvider");
  return ctx;
}

/**
 * Единый API чата для плавающего виджета.
 * Все взаимодействия с агентами идут через POST /api/chat (intent routing на бэкенде).
 */

import type { CampaignDraft } from "../types/campaign";
import type { AnalyticsSummary, CampaignAdvice, CampaignAnalytics } from "../types/analytics";

export interface ChatSession {
  id: string;
  title: string;
  status: string;
  updatedAt: string | null;
  lastMessagePreview: string;
}

export interface SourceCitation {
  id: string;
  title: string;
  source: string;
  heading_path: string[];
  score: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string | null;
  metadata?: Record<string, unknown>;
  trace?: ChatTraceEvent[];
  actions?: ChatAction[];
  citations?: SourceCitation[];
}

export interface ChatArtifact {
  id: string;
  type: string;
  title: string | null;
  content: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface ChatTraceEvent {
  event: string;
  status: "info" | "warning" | "error";
  detail: string | null;
  ts: string | null;
  metadata: Record<string, unknown>;
}

export interface ChatAction {
  id: string;
  label: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface ChatSessionDetail {
  session: ChatSession;
  messages: ChatMessage[];
  artifacts: ChatArtifact[];
}

export interface ChatResponse {
  assistant_message: string;
  trace: ChatTraceEvent[];
  artifacts: ChatArtifact[];
  actions_available: ChatAction[];
  session_id: string;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const REQUEST_TIMEOUT_MS = 30_000;

export class ChatApiError extends Error {
  status: number | null;
  retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const asString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const asNullableString = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.text().catch(() => "");
      throw new ChatApiError(
        res.status >= 500 ? "Сервис временно недоступен" : `Ошибка запроса (${res.status})`,
        res.status,
        res.status >= 500,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ChatApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ChatApiError("Превышено время ожидания ответа", null, true);
    }
    if (err instanceof TypeError) {
      throw new ChatApiError("Проблемы с соединением", null, true);
    }
    throw new ChatApiError("Неизвестная ошибка", null, false);
  } finally {
    window.clearTimeout(timer);
  }
}

function normalizeSession(raw: unknown): ChatSession {
  const o = isObject(raw) ? raw : {};
  return {
    id: asString(o.id, `tmp-${Math.random().toString(36).slice(2, 9)}`),
    title: asString(o.title, "Новый диалог"),
    status: asString(o.status, "active"),
    updatedAt: asNullableString(o.updated_at ?? o.updatedAt),
    lastMessagePreview: asString(o.last_message_preview ?? o.lastMessagePreview),
  };
}

function normalizeCitations(raw: unknown): SourceCitation[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    const o = isObject(item) ? item : {};
    return {
      id: asString(o.id, `cite-${i}`),
      title: asString(o.title, asString(o.source, "Источник")),
      source: asString(o.source),
      heading_path: Array.isArray(o.heading_path) ? o.heading_path.map((v) => asString(v)) : [],
      score: typeof o.score === "number" ? o.score : 0,
    };
  });
}

function normalizeMessage(raw: unknown, idx: number): ChatMessage {
  const o = isObject(raw) ? raw : {};
  const role = o.role === "assistant" || o.role === "system" ? o.role : "user";
  const metadata = isObject(o.metadata) ? o.metadata : {};
  const trace = normalizeTrace(o.trace);
  const actionsRaw = Array.isArray(metadata.actions) ? metadata.actions : (Array.isArray(o.actions_available) ? o.actions_available : []);
  const actions = normalizeActions(actionsRaw);
  const citations = normalizeCitations(metadata.citations);
  return {
    id: asString(o.id, `m-${idx}`),
    role,
    content: asString(o.content),
    createdAt: asNullableString(o.created_at ?? o.createdAt),
    metadata,
    trace: trace.length > 0 ? trace : undefined,
    actions: actions.length > 0 ? actions : undefined,
    citations: citations.length > 0 ? citations : undefined,
  };
}

function normalizeArtifact(raw: unknown, idx: number): ChatArtifact {
  const o = isObject(raw) ? raw : {};
  return {
    id: asString(o.id, `art-${idx}`),
    type: asString(o.type, "unknown"),
    title: asNullableString(o.title),
    content: isObject(o.content) ? o.content : null,
    metadata: isObject(o.metadata) ? o.metadata : {},
  };
}

function normalizeTrace(raw: unknown): ChatTraceEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = isObject(item) ? item : {};
    const status = o.status === "warning" || o.status === "error" ? o.status : "info";
    return {
      event: asString(o.event, "step"),
      status,
      detail: asNullableString(o.detail),
      ts: asNullableString(o.ts),
      metadata: isObject(o.metadata) ? o.metadata : {},
    };
  });
}

function normalizeActions(raw: unknown): ChatAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = isObject(item) ? item : {};
    return {
      id: asString(o.id),
      label: asString(o.label, asString(o.id)),
      kind: asString(o.kind, "default"),
      payload: isObject(o.payload) ? o.payload : {},
    };
  });
}

export async function createChat(title?: string): Promise<ChatSession> {
  const data = await http<unknown>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ title: title ?? "Новый диалог" }),
  });
  return normalizeSession(data);
}

export async function listChats(): Promise<ChatSession[]> {
  const data = await http<unknown>("/api/sessions");
  const list = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.sessions) ? data.sessions : [];
  return list.map(normalizeSession);
}

export async function getChat(sessionId: string): Promise<ChatSessionDetail> {
  const data = await http<unknown>(`/api/sessions/${encodeURIComponent(sessionId)}`);
  const o = isObject(data) ? data : {};
  const session = normalizeSession({ ...o, id: sessionId });
  const messages = Array.isArray(o.messages) ? o.messages.map(normalizeMessage) : [];
  const artifacts: ChatArtifact[] = [];
  if (Array.isArray(o.artifacts)) {
    o.artifacts.forEach((a, i) => artifacts.push(normalizeArtifact(a, i)));
  }
  if (isObject(o.draft_flow)) {
    artifacts.push({ id: `${sessionId}-draft-flow`, type: "draft_flow", title: null, content: o.draft_flow, metadata: {} });
  }
  return { session, messages, artifacts };
}

export async function sendChat(sessionId: string, message: string, action?: ChatAction): Promise<ChatResponse> {
  const data = await http<unknown>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, message, action }),
  });
  const o = isObject(data) ? data : {};
  return {
    assistant_message: asString(o.assistant_message),
    trace: normalizeTrace(o.trace),
    artifacts: Array.isArray(o.artifacts) ? o.artifacts.map(normalizeArtifact) : [],
    actions_available: normalizeActions(o.actions_available),
    session_id: asString(o.session_id, sessionId),
  };
}

// ── Interactive draft (clickable canvas) ─────────────────────────────────────
// The canvas mutates the same `campaign_draft` artifact as the chat agent, so the
// user can build a campaign by clicking — not only by talking to the copilot.

/** Apply a small patch (a channel pick, placement toggle, budget…) to the draft. */
export async function patchDraft(
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<CampaignDraft> {
  const data = await http<unknown>(`/api/sessions/${encodeURIComponent(sessionId)}/draft`, {
    method: "PATCH",
    body: JSON.stringify({ patch }),
  });
  const o = isObject(data) ? data : {};
  return o.draft as CampaignDraft;
}

export interface CreativeResult {
  url: string;
  media_type: "image" | "video";
  draft: CampaignDraft;
}

/** Mock-generate a creative for the given format → returns a placeholder asset URL. */
export async function generateCreative(
  sessionId: string,
  params: { format: string; media_type: "image" | "video"; headline?: string | null; prompt?: string | null },
): Promise<CreativeResult> {
  const data = await http<unknown>(
    `/api/sessions/${encodeURIComponent(sessionId)}/creative/generate`,
    { method: "POST", body: JSON.stringify(params) },
  );
  const o = isObject(data) ? data : {};
  return {
    url: asString(o.url),
    media_type: o.media_type === "video" ? "video" : "image",
    draft: o.draft as CampaignDraft,
  };
}

export interface CopyResult {
  variants: string[];
  draft: CampaignDraft;
}

/** Generate tone-aware ad-copy variants for the creative step (text generation). */
export async function generateCopy(
  sessionId: string,
  params: { tone?: string | null; brief?: string | null; n?: number },
): Promise<CopyResult> {
  const data = await http<unknown>(
    `/api/sessions/${encodeURIComponent(sessionId)}/creative/copy`,
    { method: "POST", body: JSON.stringify(params) },
  );
  const o = isObject(data) ? data : {};
  return {
    variants: Array.isArray(o.variants) ? o.variants.map((v) => asString(v)) : [],
    draft: o.draft as CampaignDraft,
  };
}

/** Upload a real image/video file → attaches it to the draft's Meta creative. */
export async function uploadCreative(sessionId: string, file: File): Promise<CreativeResult> {
  const form = new FormData();
  form.append("file", file);
  // Bypass http() — it forces JSON content-type; FormData sets its own boundary.
  const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/creative/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new ChatApiError(
      res.status === 413 ? "Файл слишком большой (макс. 25 МБ)"
        : res.status === 415 ? "Поддерживаются только изображения или видео"
        : `Не удалось загрузить файл (${res.status})`,
      res.status,
      res.status >= 500,
    );
  }
  const raw = await res.json();
  const o = isObject(raw) ? raw : {};
  return {
    url: asString(o.url),
    media_type: o.media_type === "video" ? "video" : "image",
    draft: o.draft as CampaignDraft,
  };
}

// ── Campaigns (Ad Campaigns list) ─────────────────────────────────────────────

export interface CampaignSummary {
  id: number;
  name: string;
  channel: string | null;
  status: string;
  audienceReach: number;
  pricePerMessage: number;
  estimatedCost: number;
  budget: number | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
}

function normalizeCampaign(raw: unknown): CampaignSummary {
  const o = isObject(raw) ? raw : {};
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  return {
    id: typeof o.id === "number" ? o.id : 0,
    name: asString(o.name, "Рекламная кампания"),
    channel: asNullableString(o.channel),
    status: asString(o.status, "moderation"),
    audienceReach: num(o.audience_reach),
    pricePerMessage: num(o.price_per_message),
    estimatedCost: num(o.estimated_cost),
    budget: typeof o.budget === "number" ? o.budget : null,
    startDate: asNullableString(o.start_date),
    endDate: asNullableString(o.end_date),
    createdAt: asNullableString(o.created_at),
  };
}

export async function listCampaigns(): Promise<CampaignSummary[]> {
  const data = await http<unknown>("/api/campaigns");
  const list = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.campaigns) ? data.campaigns : [];
  return list.map(normalizeCampaign);
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  return http<AnalyticsSummary>("/api/analytics");
}

export async function getCampaignAnalytics(campaignId: number): Promise<CampaignAnalytics> {
  return http<CampaignAnalytics>(`/api/analytics/${campaignId}`);
}

export async function getCampaignAdvice(campaignId: number): Promise<CampaignAdvice> {
  return http<CampaignAdvice>(`/api/analytics/${campaignId}/advice`, { method: "POST" });
}

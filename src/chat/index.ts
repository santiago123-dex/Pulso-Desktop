import { Channel, invoke } from "@tauri-apps/api/core";
import type { Artifact } from "../artifacts";

export type AgentMode = "normal" | "plan";
export type MessageStatus = "thinking" | "streaming" | "done" | "error";

export interface AttachedImage {
  id: string;
  path: string;
  name: string;
  mime: string;
  previewUrl: string;
  dataBase64: string;
}

export interface ToolStep {
  id: string;
  name: string;
  detail: string;
  state: "active" | "done" | "error";
}

export interface DiffSummaryInfo {
  filesCount: number;
  added: number;
  removed: number;
  artifactId: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  tools?: ToolStep[];
  diff?: DiffSummaryInfo;
  images?: AttachedImage[];
  mode: AgentMode;
  status: MessageStatus;
  createdAt: number;
  durationMs?: number;
  error?: string;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  updatedAt: number;
  sessionId?: string;
  messages: ChatMessage[];
  artifacts: Artifact[];
}

export interface ProjectGroup {
  id: string;
  name: string;
  path: string | null;
  trusted: boolean;
}

export type ChatStreamEvent =
  | { type: "started"; run_id: string }
  | { type: "thinking"; text: string; replace?: boolean }
  | { type: "tool"; id: string; name: string; detail: string; state: "active" | "done" | "error" }
  | { type: "delta"; text: string; replace?: boolean }
  | {
      type: "diff_summary";
      files_count: number;
      added: number;
      removed: number;
      diff_text: string;
    }
  | { type: "done"; duration_ms: number; session_id?: string | null }
  | { type: "error"; message: string };

export function createConversation(projectId: string, title: string): Conversation {
  return {
    id: crypto.randomUUID(),
    projectId,
    title,
    updatedAt: Date.now(),
    messages: [],
    artifacts: [],
  };
}

export function detectModeFromInput(input: string, currentMode: AgentMode): AgentMode {
  const trimmed = input.trim();
  if (trimmed === "/plan" || trimmed.startsWith("/plan ")) {
    return "plan";
  }
  return currentMode;
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 60) return "ahora";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatInlineMarkdown(raw: string): string {
  return escapeHtml(raw)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/**
 * Renderiza Markdown ligero (bloques de código con botón copiar, código inline, negritas y listas)
 * siempre escapando HTML para evitar inyección.
 */
export function renderMarkdown(markdown: string, copyLabel: string): string {
  const segments = markdown.split(/(```[\s\S]*?```)/g);
  return segments
    .map((seg) => {
      if (seg.startsWith("```") && seg.endsWith("```")) {
        const inner = seg.slice(3, -3);
        const firstNewline = inner.indexOf("\n");
        const lang = firstNewline >= 0 ? inner.slice(0, firstNewline).trim() || "text" : "text";
        const code = (firstNewline >= 0 ? inner.slice(firstNewline + 1) : inner).replace(/\n$/, "");
        const lowerLang = lang.toLowerCase();
        const isPreviewable = lowerLang === "html" || lowerLang === "svg";
        return `<div class="code-card">
          <div class="code-card-header">
            <span>${escapeHtml(lang)}</span>
            <div style="display:flex;gap:6px;">
              ${
                isPreviewable
                  ? `<button
                      type="button"
                      class="pill-btn"
                      data-preview-kind="${lowerLang}"
                      data-preview-code="${escapeHtml(code)}"
                      style="padding:2px 8px;font-size:11px;"
                    >Vista previa</button>`
                  : ""
              }
              <button
                type="button"
                class="pill-btn"
                data-copy-code="${escapeHtml(code)}"
                style="padding:2px 8px;font-size:11px;"
              >${escapeHtml(copyLabel)}</button>
            </div>
          </div>
          <pre>${escapeHtml(code)}</pre>
        </div>`;
      }

      const trimmed = seg.trim();
      if (!trimmed) return "";

      const lines = seg.split("\n");
      const htmlParts: string[] = [];
      let inList = false;

      for (const line of lines) {
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        const heading = line.match(/^(#{1,3})\s+(.*)$/);

        if (bullet) {
          if (!inList) {
            htmlParts.push('<ul class="md-list">');
            inList = true;
          }
          htmlParts.push(`<li>${formatInlineMarkdown(bullet[1])}</li>`);
        } else {
          if (inList) {
            htmlParts.push("</ul>");
            inList = false;
          }
          if (heading) {
            const level = Math.min(3, heading[1].length) + 1;
            htmlParts.push(`<h${level} class="md-h">${formatInlineMarkdown(heading[2])}</h${level}>`);
          } else if (line.trim().length > 0) {
            htmlParts.push(`<p class="md-p">${formatInlineMarkdown(line)}</p>`);
          }
        }
      }
      if (inList) htmlParts.push("</ul>");
      return htmlParts.join("");
    })
    .join("");
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function saveChatImage(
  name: string,
  mime: string,
  dataBase64: string
): Promise<{ path: string; name: string; mime: string }> {
  if (!isTauriRuntime()) {
    return { path: "", name, mime };
  }
  return invoke<{ path: string; name: string; mime: string }>("save_chat_image", {
    name,
    mime,
    dataBase64,
  });
}

export async function sendChatStream(
  params: {
    runId: string;
    providerId: string;
    modelId?: string;
    mode: AgentMode;
    prompt: string;
    history: Array<{ role: string; content: string }>;
    sessionId?: string;
    images?: AttachedImage[];
  },
  onEvent: (ev: ChatStreamEvent) => void
): Promise<void> {
  if (!isTauriRuntime()) {
    onEvent({ type: "started", run_id: params.runId });
    await new Promise((r) => setTimeout(r, 450));
    onEvent({
      type: "delta",
      text: "Ejecuta `npm run tauri dev` para conectarte con el backend Rust y usar tus proveedores reales.",
      replace: false,
    });
    onEvent({ type: "done", duration_ms: 450 });
    return;
  }

  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = onEvent;

  await invoke("send_chat_message", {
    request: {
      runId: params.runId,
      providerId: params.providerId,
      modelId: params.modelId ?? null,
      mode: params.mode,
      prompt: params.prompt,
      history: params.history,
      sessionId: params.sessionId ?? null,
      images: (params.images ?? []).map((img) => ({
        path: img.path,
        name: img.name,
        mime: img.mime,
        dataBase64: img.dataBase64,
      })),
    },
    onEvent: channel,
  });
}

export async function cancelChatRun(runId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("cancel_chat_run", { runId });
}

export interface SavedAutomation {
  id: string;
  name: string;
  prompt: string;
  mode: AgentMode;
}

export interface PersistedMcpServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  target: string;
  enabled: boolean;
}

export interface PersistedAppState {
  locale: "es" | "en";
  providerId: string;
  modelId: string;
  activeConversationId: string;
  projects: ProjectGroup[];
  conversations: Conversation[];
  mcpServers?: PersistedMcpServer[];
  automations?: SavedAutomation[];
}

export async function loadPersistedState(): Promise<PersistedAppState | null> {
  if (!isTauriRuntime()) {
    try {
      const raw = localStorage.getItem("pulso_desktop_state");
      return raw ? (JSON.parse(raw) as PersistedAppState) : null;
    } catch {
      return null;
    }
  }
  try {
    return await invoke<PersistedAppState | null>("load_app_state");
  } catch {
    return null;
  }
}

export async function savePersistedState(state: PersistedAppState): Promise<void> {
  // Evitar guardar blobs base64 gigantes en el archivo de estado
  const sanitized: PersistedAppState = {
    ...state,
    conversations: state.conversations.map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({
        ...m,
        status: m.status === "thinking" || m.status === "streaming" ? "done" : m.status,
        images: m.images?.map((img) => ({
          ...img,
          previewUrl: "",
          dataBase64: "",
        })),
      })),
    })),
  };

  if (!isTauriRuntime()) {
    try {
      localStorage.setItem("pulso_desktop_state", JSON.stringify(sanitized));
    } catch {
      // Ignorar si excede cuota
    }
    return;
  }
  try {
    await invoke("save_app_state", { state: sanitized });
  } catch {
    // No interrumpir flujo si falla guardado
  }
}

export async function loadSavedImagePreview(path: string): Promise<string> {
  if (!isTauriRuntime() || !path) return "";
  try {
    return await invoke<string>("read_chat_image_data_url", { path });
  } catch {
    return "";
  }
}

import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { buildSandboxedDocument, type Artifact } from "./artifacts";
import {
  cancelChatRun,
  createConversation,
  detectModeFromInput,
  escapeHtml,
  formatRelativeTime,
  loadPersistedState,
  loadSavedImagePreview,
  renderMarkdown,
  saveChatImage,
  savePersistedState,
  sendChatStream,
  type AgentMode,
  type AttachedImage,
  type ChatMessage,
  type Conversation,
  type ProjectGroup,
  type SavedAutomation,
} from "./chat";
import { getLocale, setLocale, t, type Locale } from "./locales/i18n";
import {
  checkDesktopUpdate,
  defaultSettings,
  deleteProviderApiKey,
  describeProviderConnection,
  fallbackProviders,
  fetchAntigravityQuota,
  fetchDetectedProviders,
  installDesktopUpdate,
  saveProviderApiKey,
  type DesktopUpdateInfo,
  type McpServerItem,
  type ProviderStatus,
  type QuotaGroup,
} from "./settings";
import {
  getWorkspaceStatus,
  inspectProjectSkills,
  listWorkspaceFiles,
  openInPulsoEditor,
  pickAndSetWorkspace,
  trustActiveWorkspace,
  type ProjectSkillsReport,
} from "./workspace";

const icons = {
  pulsoLogo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></svg>`,
  sidebar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  folderPlus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  panelRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z"/></svg>`,
  arrowUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
  winMin: `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 6h8"/></svg>`,
  winMax: `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1"/></svg>`,
  winClose: `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>`,
  chevronUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 13l4 4L19 7"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 20"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>`,
};

const defaultProject: ProjectGroup = {
  id: "default",
  name: "Pulso-Desktop",
  path: null,
  trusted: false,
};

const projects: ProjectGroup[] = [defaultProject];
const initialConv = createConversation(defaultProject.id, "Inicio de Pulso Desktop");
const conversations: Conversation[] = [initialConv];

let providers: ProviderStatus[] = [...fallbackProviders];
let activeConversationId = initialConv.id;
let agentMode: AgentMode = "normal";
let providerId = defaultSettings.providerId;
let modelId = defaultSettings.modelId;
let providerMenuOpen = false;
let settingsOpen = false;
let skillsModalOpen = false;
let automationsModalOpen = false;
let openTopMenu: "workspace" | "view" | "window" | null = null;
let availableUpdate: DesktopUpdateInfo | null = null;
let updateModalOpen = false;
let checkingUpdate = false;
let installingUpdate = false;
let updateStatusMsg = "";
let refreshingProviders = false;
let loadingQuota = false;
let quotaGroups: QuotaGroup[] = [];
let skillsReport: ProjectSkillsReport = { trusted: false, entries: [] };
let mcpServers: McpServerItem[] = [];
let automations: SavedAutomation[] = [
  {
    id: "auto-git-review",
    name: "Revisar cambios de Git",
    prompt: "Revisa los cambios actuales en git diff, detecta posibles errores y sugiere mejoras concretas.",
    mode: "plan",
  },
  {
    id: "auto-arch",
    name: "Resumir arquitectura del proyecto",
    prompt: "Explora el proyecto activo y resume su arquitectura, módulos principales y cómo ejecutarlo.",
    mode: "plan",
  },
  {
    id: "auto-tests",
    name: "Auditar pruebas y seguridad",
    prompt: "Revisa la cobertura de pruebas y posibles problemas de seguridad en el proyecto actual.",
    mode: "plan",
  },
];
let lightboxImageUrl: string | null = null;
let suggestKind: "slash" | "file" | null = null;
let suggestItems: Array<{ value: string; label: string; hint: string }> = [];
let suggestIndex = 0;
let artifactsOpen = defaultSettings.artifactsOpen;
let sidebarOpen = defaultSettings.sidebarOpen;
let selectedArtifactId: string | null = null;
let activeRunId: string | null = null;
let draftText = "";
let pendingImages: AttachedImage[] = [];
let searchQuery = "";
let persistTimer: number | null = null;

function schedulePersist(): void {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void savePersistedState({
      locale: getLocale(),
      providerId,
      modelId,
      activeConversationId,
      projects,
      conversations,
      mcpServers,
      automations,
    });
  }, 250);
}

function getActiveConversation(): Conversation {
  return (
    conversations.find((c) => c.id === activeConversationId) ?? conversations[0]
  );
}

function getProject(projectId: string): ProjectGroup {
  return projects.find((p) => p.id === projectId) ?? projects[0];
}

function getActiveProvider(): ProviderStatus {
  return providers.find((p) => p.id === providerId) ?? providers[0];
}

function getActiveModelLabel(): string {
  const prov = getActiveProvider();
  const found = prov.models.find((m) => m.id === modelId);
  if (found && found.id !== "default") {
    return `${prov.name} · ${found.label}`;
  }
  return prov.name;
}

function folderBasename(fullPath: string): string {
  const normalized = fullPath.replaceAll("\\", "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || fullPath;
}

function renderArtifactContent(artifact: Artifact): string {
  if (artifact.kind === "html" || artifact.kind === "svg") {
    const srcdoc = escapeHtml(buildSandboxedDocument(artifact));
    return `<iframe class="artifact-frame" sandbox="" srcdoc="${srcdoc}"></iframe>`;
  }
  if (artifact.kind === "diff") {
    const lines = artifact.content
      .split("\n")
      .map((line) => {
        const escaped = escapeHtml(line);
        if (line.startsWith("+")) return `<span class="diff-add">${escaped}</span>`;
        if (line.startsWith("-")) return `<span class="diff-del">${escaped}</span>`;
        return escaped;
      })
      .join("\n");
    return `<pre>${lines}</pre>`;
  }
  return `<pre>${escapeHtml(artifact.content)}</pre>`;
}

function renderAssistantInner(msg: ChatMessage, locale: Locale): string {
  const thinkingHtml = msg.thinking
    ? `<details class="thinking-details" ${msg.status === "thinking" ? "open" : ""}>
        <summary>${locale === "en" ? "Thinking" : "Pensamiento"}</summary>
        <div class="thinking-body">${escapeHtml(msg.thinking)}</div>
      </details>`
    : "";

  const toolsHtml =
    msg.tools && msg.tools.length > 0
      ? `<div class="tools-list">
          ${msg.tools
            .map(
              (tool) => `
            <div class="tool-pill">
              <span class="tool-dot ${tool.state}"></span>
              <span class="tool-name">${escapeHtml(tool.name)}</span>
              ${
                tool.detail
                  ? `<span class="tool-detail" title="${escapeHtml(tool.detail)}">${escapeHtml(
                      tool.detail
                    )}</span>`
                  : ""
              }
            </div>`
            )
            .join("")}
        </div>`
      : "";

  if (msg.status === "thinking" && !msg.content) {
    return `${thinkingHtml}${toolsHtml}<div class="thinking-row">
      <div class="thinking-dots"><span></span><span></span><span></span></div>
      <span class="thinking-label">${locale === "en" ? "Thinking..." : "Pensando..."}</span>
    </div>`;
  }

  const body = msg.content
    ? `<div class="msg-text">${renderMarkdown(msg.content, t("chat.copyCode"))}${
        msg.status === "streaming" ? '<span class="stream-cursor"></span>' : ""
      }</div>`
    : "";

  const diffHtml = msg.diff
    ? `<div class="changes-card">
        <div class="changes-stats">
          <span>${msg.diff.filesCount} ${t("chat.filesChanged")}</span>
          <span class="stat-add">+${msg.diff.added}</span>
          <span class="stat-del">-${msg.diff.removed}</span>
        </div>
        <button
          type="button"
          class="pill-btn"
          data-open-artifact="${msg.diff.artifactId}"
        >${t("chat.review")}</button>
      </div>`
    : "";

  const errBlock = msg.error
    ? `<div class="msg-error">${escapeHtml(msg.error)}</div>`
    : "";

  const durationSec = msg.durationMs ? (msg.durationMs / 1000).toFixed(1) : null;
  const meta =
    msg.status === "done" && durationSec
      ? `<div class="worked-meta">${
          locale === "en" ? `Worked for ${durationSec}s` : `Trabajó ${durationSec}s`
        } &rsaquo;</div>`
      : "";

  return `${thinkingHtml}${toolsHtml}${body}${diffHtml}${errBlock}${meta}`;
}

function updateStreamingMessageDom(msg: ChatMessage): void {
  const el = document.querySelector<HTMLElement>(`[data-msg-id="${msg.id}"]`);
  if (!el) return;
  el.innerHTML = renderAssistantInner(msg, getLocale());
  bindCopyButtons(el);
  el.querySelectorAll<HTMLButtonElement>("[data-open-artifact]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedArtifactId = btn.dataset.openArtifact ?? null;
      artifactsOpen = true;
      render();
    });
  });
  const scroller = document.getElementById("chat-scroll");
  if (scroller) {
    scroller.scrollTop = scroller.scrollHeight;
  }
}

function renderSettingsModal(locale: Locale): string {
  if (!settingsOpen) return "";
  return `
    <div id="settings-backdrop" class="modal-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true">
        <div class="modal-header">
          <span>${locale === "en" ? "Providers & Models" : "Proveedores y modelos"}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <button id="refresh-providers-btn" type="button" class="pill-btn">
              ${icons.refresh}
              <span>${
                refreshingProviders
                  ? locale === "en"
                    ? "Detecting..."
                    : "Detectando..."
                  : locale === "en"
                    ? "Re-detect"
                    : "Re-detectar"
              }</span>
            </button>
            <button id="close-settings-btn" type="button" class="icon-btn">${icons.close}</button>
          </div>
        </div>
        <div class="modal-body">
          <div class="provider-card-sub">
            ${
              locale === "en"
                ? "Pulso Desktop automatically inherits your connected accounts and API keys from Pulso Editor when nothing is configured here yet."
                : "Pulso Desktop detecta tus cuentas conectadas y hereda automáticamente las claves API de Pulso Editor si todavía no configuraste una aquí."
            }
          </div>
          ${providers
            .map((prov) => {
              const canUseKey = prov.authModes.includes("api_key");
              return `
                <div class="provider-card">
                  <div class="provider-card-head">
                    <div>
                      <div class="provider-card-title">
                        <span class="status-dot ${prov.connected ? "on" : "off"}"></span>
                        <span>${escapeHtml(prov.name)}</span>
                      </div>
                      <div class="provider-card-sub">${escapeHtml(
                        describeProviderConnection(prov, locale)
                      )}</div>
                    </div>
                    ${
                      prov.keySource === "desktop"
                        ? `<button
                            type="button"
                            class="pill-btn"
                            data-delete-key="${prov.id}"
                          >${locale === "en" ? "Remove key" : "Quitar clave"}</button>`
                        : ""
                    }
                  </div>
                  ${
                    canUseKey
                      ? `<form class="key-row" data-key-form="${prov.id}">
                          <input
                            type="password"
                            class="key-input"
                            placeholder="${
                              locale === "en"
                                ? `API key for ${prov.name} (optional if using account)`
                                : `API key de ${prov.name} (opcional si usas tu cuenta)`
                            }"
                          />
                          <button type="submit" class="pill-btn">
                            ${locale === "en" ? "Save" : "Guardar"}
                          </button>
                        </form>`
                      : ""
                  }
                </div>
              `;
            })
            .join("")}
          <div class="provider-card">
            <div class="provider-card-head">
              <div class="provider-card-title">
                <span>${locale === "en" ? "Antigravity Quota" : "Cuota de Antigravity"}</span>
              </div>
              <button id="refresh-quota-btn" type="button" class="pill-btn">
                ${icons.refresh}
                <span>${
                  loadingQuota
                    ? locale === "en"
                      ? "Loading..."
                      : "Consultando..."
                    : locale === "en"
                      ? "Check quota"
                      : "Consultar cuota"
                }</span>
              </button>
            </div>
            ${
              quotaGroups.length === 0
                ? `<div class="provider-card-sub">${
                    locale === "en"
                      ? "Click 'Check quota' to view remaining usage buckets."
                      : "Pulsa 'Consultar cuota' para ver tu consumo disponible."
                  }</div>`
                : quotaGroups
                    .map(
                      (g) => `
                  <div class="quota-group">
                    <div style="font-size:12px;font-weight:600;">${escapeHtml(g.name)}</div>
                    ${g.buckets
                      .map(
                        (b) => `
                      <div class="quota-row">
                        <div class="quota-row-top">
                          <span>${escapeHtml(b.name || b.window)}</span>
                          <span>${b.remainingPercent}%</span>
                        </div>
                        <div class="quota-bar">
                          <div class="quota-fill" style="width:${b.remainingPercent}%;"></div>
                        </div>
                      </div>`
                      )
                      .join("")}
                  </div>`
                    )
                    .join("")
            }
          </div>
          <div class="provider-card">
            <div class="provider-card-head">
              <div>
                <div class="provider-card-title">
                  <span>${locale === "en" ? "Updates" : "Actualizaciones"}</span>
                </div>
                <div class="provider-card-sub">
                  ${escapeHtml(
                    updateStatusMsg ||
                      (availableUpdate
                        ? locale === "en"
                          ? `Version v${availableUpdate.version} available`
                          : `Versión v${availableUpdate.version} disponible`
                        : locale === "en"
                          ? "Installed version: v0.3.0"
                          : "Versión instalada: v0.3.0")
                  )}
                </div>
              </div>
              <button id="check-update-btn" type="button" class="pill-btn">
                ${icons.refresh}
                <span>${
                  checkingUpdate
                    ? locale === "en"
                      ? "Checking..."
                      : "Buscando..."
                    : locale === "en"
                      ? "Check updates"
                      : "Buscar actualizaciones"
                }</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderUpdateModal(locale: Locale): string {
  if (!updateModalOpen || !availableUpdate) return "";
  return `
    <div id="update-backdrop" class="modal-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true">
        <div class="modal-header">
          <span>${
            locale === "en"
              ? `Update available (v${availableUpdate.version})`
              : `Actualización disponible (v${availableUpdate.version})`
          }</span>
          <button id="close-update-btn" type="button" class="icon-btn">${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="provider-card-sub">
            ${
              locale === "en"
                ? `You have v${availableUpdate.current} installed and v${availableUpdate.version} is ready. Pulso Desktop will download the installer and update automatically.`
                : `Tienes instalada la v${availableUpdate.current} y está disponible la v${availableUpdate.version}. Pulso Desktop descargará el instalador y se actualizará automáticamente.`
            }
          </div>
          ${
            availableUpdate.notes
              ? `<div class="artifact-card">
                  <div class="artifact-card-title">${locale === "en" ? "Release notes" : "Novedades"}</div>
                  <pre style="white-space:pre-wrap;">${escapeHtml(availableUpdate.notes)}</pre>
                </div>`
              : ""
          }
          ${updateStatusMsg ? `<div class="msg-error">${escapeHtml(updateStatusMsg)}</div>` : ""}
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button id="cancel-update-btn" type="button" class="pill-btn">
              ${locale === "en" ? "Later" : "Más tarde"}
            </button>
            <button
              id="confirm-install-update-btn"
              type="button"
              class="pill-btn pill-update"
              ${installingUpdate ? "disabled" : ""}
            >
              ${
                installingUpdate
                  ? locale === "en"
                    ? "Downloading..."
                    : "Descargando..."
                  : locale === "en"
                    ? "Download & Install"
                    : "Descargar e instalar"
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSkillsModal(locale: Locale): string {
  if (!skillsModalOpen) return "";
  return `
    <div id="skills-backdrop" class="modal-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true">
        <div class="modal-header">
          <span>${t("sidebar.customizations")}</span>
          <button id="close-skills-btn" type="button" class="icon-btn">${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="provider-card">
            <div class="provider-card-head">
              <div class="provider-card-title">
                <span class="status-dot ${skillsReport.trusted ? "on" : "off"}"></span>
                <span>AGENTS.md &amp; Skills</span>
              </div>
            </div>
            ${
              !skillsReport.trusted
                ? `<div class="provider-card-sub">${
                    locale === "en"
                      ? "Mark the active folder as Trusted before loading project instructions or skills."
                      : "Marca la carpeta activa como Confiable para cargar AGENTS.md y skills del proyecto."
                  }</div>`
                : skillsReport.entries.length === 0
                  ? `<div class="provider-card-sub">${
                      locale === "en"
                        ? "No AGENTS.md or skills found in this project."
                        : "No se encontraron AGENTS.md ni skills en este proyecto."
                    }</div>`
                  : skillsReport.entries
                      .map(
                        (s) => `
                    <div class="tool-pill">
                      <span class="tool-dot done"></span>
                      <span class="tool-name">${escapeHtml(s.name)}</span>
                      <span class="tool-detail">${escapeHtml(s.path)}</span>
                    </div>`
                      )
                      .join("")
            }
          </div>

          <div class="provider-card">
            <div class="provider-card-title">
              <span>${locale === "en" ? "MCP Servers" : "Servidores MCP"}</span>
            </div>
            ${
              mcpServers.length === 0
                ? `<div class="provider-card-sub">${
                    locale === "en"
                      ? "Add stdio or HTTP MCP servers with sanitized environment variables."
                      : "Agrega servidores MCP (stdio o HTTP) con entorno saneado."
                  }</div>`
                : mcpServers
                    .map(
                      (srv) => `
                  <div class="provider-card-head">
                    <div>
                      <div style="font-size:12.5px;font-weight:500;">${escapeHtml(srv.name)}</div>
                      <div class="provider-card-sub">${escapeHtml(srv.transport)} · ${escapeHtml(
                        srv.target
                      )}</div>
                    </div>
                    <button type="button" class="pill-btn" data-remove-mcp="${srv.id}">
                      ${locale === "en" ? "Remove" : "Quitar"}
                    </button>
                  </div>`
                    )
                    .join("")
            }
            <form id="add-mcp-form" class="key-row">
              <input id="mcp-name-input" class="key-input" placeholder="${
                locale === "en" ? "Name (e.g. filesystem)" : "Nombre (ej. filesystem)"
              }" />
              <input id="mcp-target-input" class="key-input" placeholder="${
                locale === "en" ? "Command or URL" : "Comando o URL"
              }" />
              <button type="submit" class="pill-btn">${locale === "en" ? "Add" : "Agregar"}</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAutomationsModal(locale: Locale): string {
  if (!automationsModalOpen) return "";
  return `
    <div id="automations-backdrop" class="modal-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true">
        <div class="modal-header">
          <span>${t("sidebar.automations")}</span>
          <button id="close-automations-btn" type="button" class="icon-btn">${icons.close}</button>
        </div>
        <div class="modal-body">
          <div class="provider-card-sub">
            ${
              locale === "en"
                ? "Run reusable workflows with one click or save your own quick actions."
                : "Ejecuta flujos reutilizables en un clic o guarda tus propias acciones rápidas."
            }
          </div>
          ${automations
            .map(
              (auto) => `
            <div class="provider-card">
              <div class="provider-card-head">
                <div>
                  <div class="provider-card-title">
                    <span>${escapeHtml(auto.name)}</span>
                  </div>
                  <div class="provider-card-sub">${escapeHtml(auto.prompt)}</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                  <button type="button" class="pill-btn pill-ok" data-run-auto="${auto.id}">
                    ${locale === "en" ? "Run" : "Ejecutar"}
                  </button>
                  <button type="button" class="pill-btn" data-delete-auto="${auto.id}">
                    ${locale === "en" ? "Remove" : "Quitar"}
                  </button>
                </div>
              </div>
            </div>`
            )
            .join("")}
          <form id="add-auto-form" class="provider-card">
            <div class="provider-card-title">
              <span>${locale === "en" ? "New automation" : "Nueva automatización"}</span>
            </div>
            <input id="auto-name-input" class="key-input" placeholder="${
              locale === "en" ? "Title (e.g. Daily PR review)" : "Nombre (ej. Revisión antes de commit)"
            }" />
            <input id="auto-prompt-input" class="key-input" placeholder="${
              locale === "en" ? "Prompt to run..." : "Instrucción a ejecutar..."
            }" />
            <div style="display:flex;justify-content:flex-end;">
              <button type="submit" class="pill-btn">${locale === "en" ? "Save" : "Guardar"}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderLightbox(): string {
  if (!lightboxImageUrl) return "";
  return `
    <div id="lightbox-backdrop" class="modal-backdrop">
      <img class="lightbox-img" src="${lightboxImageUrl}" alt="Vista ampliada" />
    </div>
  `;
}

function render(): void {
  const root = document.getElementById("app");
  if (!root) return;

  const existingInput = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  if (existingInput) {
    draftText = existingInput.value;
  }

  const current = getActiveConversation();
  const activeProject = getProject(current.projectId);
  const activeProvider = getActiveProvider();
  const locale = getLocale();
  document.documentElement.lang = locale;

  const shellClasses = [
    "app-shell",
    artifactsOpen ? "artifacts-open" : "",
    sidebarOpen ? "" : "sidebar-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  const activeArtifact =
    current.artifacts.find((a) => a.id === selectedArtifactId) ??
    current.artifacts[current.artifacts.length - 1] ??
    null;

  root.innerHTML = `
    <div class="window-frame">
      <div class="window-titlebar" data-tauri-drag-region>
        <div class="titlebar-menus">
          <span class="titlebar-brand">Pulso</span>
          <div class="titlebar-menu-wrap">
            <button
              type="button"
              class="titlebar-menu-btn ${openTopMenu === "workspace" ? "open" : ""}"
              data-top-menu="workspace"
            >${locale === "es" ? "Proyecto" : "Workspace"}</button>
            ${
              openTopMenu === "workspace"
                ? `<div class="titlebar-dropdown">
                    <button type="button" data-menu-act="new-chat">${t("sidebar.newChat")}</button>
                    <button type="button" data-menu-act="add-folder">${t("sidebar.addProject")}</button>
                    <button type="button" data-menu-act="open-editor">${
                      locale === "en" ? "Open in Pulso Editor" : "Abrir en Pulso Editor"
                    }</button>
                    <button type="button" data-menu-act="open-skills">${t("sidebar.customizations")}</button>
                    <button type="button" data-menu-act="open-settings">${t("sidebar.settings")}</button>
                  </div>`
                : ""
            }
          </div>
          <div class="titlebar-menu-wrap">
            <button
              type="button"
              class="titlebar-menu-btn ${openTopMenu === "view" ? "open" : ""}"
              data-top-menu="view"
            >${locale === "es" ? "Ver" : "View"}</button>
            ${
              openTopMenu === "view"
                ? `<div class="titlebar-dropdown">
                    <button type="button" data-menu-act="toggle-sidebar">${t("header.toggleSidebar")}</button>
                    <button type="button" data-menu-act="toggle-artifacts">${t("artifacts.title")}</button>
                    <button type="button" data-menu-act="toggle-lang">${
                      locale === "es" ? "Cambiar a Inglés (EN)" : "Switch to Spanish (ES)"
                    }</button>
                  </div>`
                : ""
            }
          </div>
          <div class="titlebar-menu-wrap">
            <button
              type="button"
              class="titlebar-menu-btn ${openTopMenu === "window" ? "open" : ""}"
              data-top-menu="window"
            >${locale === "es" ? "Ventana" : "Window"}</button>
            ${
              openTopMenu === "window"
                ? `<div class="titlebar-dropdown">
                    <button type="button" data-menu-act="win-min">${locale === "en" ? "Minimize" : "Minimizar"}</button>
                    <button type="button" data-menu-act="win-max">${locale === "en" ? "Maximize / Restore" : "Maximizar / Restaurar"}</button>
                    <button type="button" data-menu-act="win-close">${locale === "en" ? "Close" : "Cerrar"}</button>
                  </div>`
                : ""
            }
          </div>
        </div>
        <div class="titlebar-drag" data-tauri-drag-region></div>
        <div class="window-controls">
          <button id="win-min-btn" class="win-btn" type="button" aria-label="Minimizar">${icons.winMin}</button>
          <button id="win-max-btn" class="win-btn" type="button" aria-label="Maximizar">${icons.winMax}</button>
          <button id="win-close-btn" class="win-btn win-close" type="button" aria-label="Cerrar">${icons.winClose}</button>
        </div>
      </div>

      <div class="${shellClasses}">
        <aside class="sidebar">
          <div class="sidebar-top">
            <div class="brand-mark">
              <span class="brand-logo">${icons.pulsoLogo}</span>
              <span>${t("app.title")}</span>
            </div>
            <div class="sidebar-tools">
              <button
                id="collapse-sidebar-btn"
                class="icon-btn"
                title="${t("header.toggleSidebar")}"
              >${icons.sidebar}</button>
            </div>
          </div>

          <button id="new-chat-btn" class="new-chat-btn">
            ${icons.plus}
            <span>${t("sidebar.newChat")}</span>
          </button>

          <div class="sidebar-search">
            ${icons.search}
            <input
              id="sidebar-search-input"
              type="text"
              value="${escapeHtml(searchQuery)}"
              placeholder="${locale === "en" ? "Search conversations..." : "Buscar conversaciones..."}"
            />
          </div>

          <nav class="sidebar-nav">
            <button id="open-automations-btn" class="nav-item" type="button">
              ${icons.clock}
              <span>${t("sidebar.automations")}</span>
            </button>
            <button id="open-skills-btn" class="nav-item" type="button">
              ${icons.sliders}
              <span>${t("sidebar.customizations")}</span>
            </button>
          </nav>

          <div class="projects-header">
            <span>${t("sidebar.projects")}</span>
            <button
              id="add-project-btn"
              class="icon-btn"
              title="${t("sidebar.addProject")}"
            >${icons.folderPlus}</button>
          </div>

          <div class="projects-scroll">
            ${projects
              .map((project) => {
                const q = searchQuery.trim().toLowerCase();
                const projectConvs = conversations.filter(
                  (c) =>
                    c.projectId === project.id &&
                    (!q || c.title.toLowerCase().includes(q))
                );
                const trustClass = project.trusted ? "trusted" : "untrusted";
                return `
                  <section class="project-group">
                    <div class="project-title" title="${escapeHtml(project.path ?? project.name)}">
                      ${icons.folder}
                      <span class="conv-title">${escapeHtml(project.name)}</span>
                      ${
                        project.path
                          ? `<span class="trust-dot ${trustClass}" title="${
                              project.trusted ? t("sidebar.trusted") : t("sidebar.untrusted")
                            }"></span>`
                          : ""
                      }
                    </div>
                    ${
                      projectConvs.length === 0
                        ? `<div class="conv-empty">${t("sidebar.noConversations")}</div>`
                        : projectConvs
                            .map(
                              (conv) => `
                          <div class="conv-item-wrap">
                            <button
                              class="conv-row ${conv.id === current.id ? "active" : ""}"
                              data-conv-id="${conv.id}"
                            >
                              <span class="conv-title">${escapeHtml(conv.title)}</span>
                              <span class="conv-time">${formatRelativeTime(conv.updatedAt)}</span>
                            </button>
                            <div class="conv-actions">
                              <button
                                type="button"
                                class="conv-act-btn"
                                data-rename-conv="${conv.id}"
                                title="${locale === "en" ? "Rename" : "Renombrar"}"
                              >${icons.edit}</button>
                              <button
                                type="button"
                                class="conv-act-btn"
                                data-delete-conv="${conv.id}"
                                title="${locale === "en" ? "Delete" : "Eliminar"}"
                              >${icons.trash}</button>
                            </div>
                          </div>`
                            )
                            .join("")
                    }
                  </section>
                `;
              })
              .join("")}
          </div>

          <div class="sidebar-footer">
            <button id="open-settings-btn" class="nav-item" type="button" style="width:auto;padding:6px 8px;">
              ${icons.settings}
              <span>${t("sidebar.settings")}</span>
            </button>
            <div class="lang-pill" role="group" aria-label="${t("settings.language")}">
              <button type="button" data-set-lang="es" class="${locale === "es" ? "active" : ""}">ES</button>
              <button type="button" data-set-lang="en" class="${locale === "en" ? "active" : ""}">EN</button>
            </div>
          </div>
        </aside>

        <main class="main-stage">
          <header class="topbar">
            <div class="topbar-left">
              ${
                !sidebarOpen
                  ? `<button id="expand-sidebar-btn" class="icon-btn" title="${t(
                      "header.toggleSidebar"
                    )}">${icons.sidebar}</button>`
                  : ""
              }
              <span class="breadcrumb-project">${escapeHtml(activeProject.name)}</span>
              <span class="breadcrumb-sep">/</span>
              <span class="breadcrumb-conv">${escapeHtml(current.title)}</span>
            </div>

            <div class="topbar-right">
              ${
                availableUpdate
                  ? `<button id="topbar-update-btn" class="pill-btn pill-update" type="button">
                      ${
                        locale === "en"
                          ? `Update to v${availableUpdate.version} &rarr;`
                          : `Actualizar a v${availableUpdate.version} &rarr;`
                      }
                    </button>`
                  : ""
              }
              ${
                activeProject.path
                  ? activeProject.trusted
                    ? `<span class="pill-btn pill-ok">${icons.shield} ${t("sidebar.trusted")}</span>`
                    : `<button id="trust-workspace-btn" class="pill-btn pill-warn">${icons.shield} ${t(
                        "sidebar.trustAction"
                      )}</button>`
                  : `<button id="header-folder-btn" class="pill-btn">${icons.folderPlus} ${t(
                      "sidebar.addProject"
                    )}</button>`
              }
              <button id="open-editor-btn" class="pill-btn" type="button">
                <span>${locale === "en" ? "Open Editor" : "Abrir en Pulso Editor"}</span>
              </button>
              <button id="toggle-artifacts-btn" class="pill-btn">
                ${icons.panelRight}
                <span>${t("header.artifacts")}</span>
              </button>
            </div>
          </header>

          <section id="chat-scroll" class="chat-scroll">
            <div class="chat-column">
              ${
                current.messages.length === 0
                  ? `<div class="empty-state msg-animate">
                      <h2>${t("chat.emptyTitle")}</h2>
                      <p>${t("chat.emptySubtitle")}</p>
                    </div>`
                  : current.messages
                      .map((msg) => {
                        if (msg.role === "user") {
                          const imgsHtml =
                            msg.images && msg.images.length > 0
                              ? `<div class="msg-images">${msg.images
                                  .map(
                                    (img) =>
                                      `<img class="msg-image" src="${img.previewUrl}" alt="${escapeHtml(
                                        img.name
                                      )}" />`
                                  )
                                  .join("")}</div>`
                              : "";
                          return `<div class="msg-user-wrap msg-animate"><article class="msg-user">${imgsHtml}${escapeHtml(
                            msg.content
                          )}</article></div>`;
                        }
                        return `
                          <article class="msg-assistant msg-animate" data-msg-id="${msg.id}">
                            ${renderAssistantInner(msg, locale)}
                          </article>
                        `;
                      })
                      .join("")
              }
            </div>
          </section>

          <footer class="composer-dock">
            <form id="composer-form" class="composer-box">
              ${
                suggestKind && suggestItems.length > 0
                  ? `<div class="composer-suggest">
                      ${suggestItems
                        .map(
                          (item, idx) => `
                        <button
                          type="button"
                          class="suggest-item ${idx === suggestIndex ? "active" : ""}"
                          data-suggest-idx="${idx}"
                        >
                          <span class="conv-title">${escapeHtml(item.label)}</span>
                          <span class="suggest-hint">${escapeHtml(item.hint)}</span>
                        </button>`
                        )
                        .join("")}
                    </div>`
                  : ""
              }
              <input
                id="image-file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                style="display:none;"
              />
              ${
                pendingImages.length > 0
                  ? `<div class="composer-attachments">
                      ${pendingImages
                        .map(
                          (img) => `
                        <div class="attach-thumb" title="${escapeHtml(img.name)}">
                          <img src="${img.previewUrl}" alt="${escapeHtml(img.name)}" />
                          <button
                            type="button"
                            class="attach-remove"
                            data-remove-image="${img.id}"
                            aria-label="Quitar imagen"
                          >${icons.close}</button>
                        </div>`
                        )
                        .join("")}
                    </div>`
                  : ""
              }
              <textarea
                id="chat-input"
                class="composer-input"
                rows="2"
                placeholder="${t("chat.placeholder")}"
              >${escapeHtml(draftText)}</textarea>
              <div class="composer-bar">
                <div class="composer-left">
                  <button
                    id="composer-image-btn"
                    type="button"
                    class="icon-btn"
                    title="${locale === "en" ? "Attach image (or paste Ctrl+V)" : "Adjuntar foto (o pegar Ctrl+V)"}"
                  >${icons.image}</button>
                  <button
                    id="composer-folder-btn"
                    type="button"
                    class="icon-btn"
                    title="${t("sidebar.addProject")}"
                  >${icons.plus}</button>
                  <div class="model-picker">
                    <button
                      id="provider-trigger-btn"
                      type="button"
                      class="model-trigger ${providerMenuOpen ? "open" : ""}"
                      aria-haspopup="listbox"
                      aria-expanded="${providerMenuOpen}"
                    >
                      <span class="status-dot ${activeProvider.connected ? "on" : "off"}"></span>
                      <span>${escapeHtml(getActiveModelLabel())}</span>
                      ${providerMenuOpen ? icons.chevronUp : icons.chevronDown}
                    </button>
                    ${
                      providerMenuOpen
                        ? `<div class="model-menu" role="listbox">
                            <div class="model-section-title">${
                              locale === "en" ? "Providers" : "Proveedores"
                            }</div>
                            ${providers
                              .map(
                                (prov) => `
                              <button
                                type="button"
                                role="option"
                                aria-selected="${prov.id === providerId}"
                                class="model-option ${prov.id === providerId ? "selected" : ""}"
                                data-provider-id="${prov.id}"
                              >
                                <div class="model-option-main">
                                  <div class="model-option-top">
                                    <span class="status-dot ${prov.connected ? "on" : "off"}"></span>
                                    <span>${escapeHtml(prov.name)}</span>
                                  </div>
                                  <span class="model-option-sub">${escapeHtml(
                                    describeProviderConnection(prov, locale)
                                  )}</span>
                                </div>
                                ${
                                  prov.id === providerId
                                    ? `<span class="model-check">${icons.check}</span>`
                                    : ""
                                }
                              </button>`
                              )
                              .join("")}
                            ${
                              activeProvider.models.length > 0
                                ? `<div class="model-section-title">${
                                    locale === "en" ? "Models" : "Modelos"
                                  } (${escapeHtml(activeProvider.name)})</div>
                                  ${activeProvider.models
                                    .map(
                                      (m) => `
                                    <button
                                      type="button"
                                      class="model-option ${m.id === modelId ? "selected" : ""}"
                                      data-model-id="${escapeHtml(m.id)}"
                                    >
                                      <span class="conv-title" style="font-size:12.5px;">${escapeHtml(
                                        m.label
                                      )}</span>
                                      ${
                                        m.id === modelId
                                          ? `<span class="model-check">${icons.check}</span>`
                                          : ""
                                      }
                                    </button>`
                                    )
                                    .join("")}`
                                : ""
                            }
                            <button
                              id="menu-open-settings-btn"
                              type="button"
                              class="model-option"
                              style="border-top:1px solid var(--border-subtle);margin-top:4px;padding-top:8px;"
                            >
                              <span style="font-size:12px;color:var(--text-secondary);">
                                ${
                                  locale === "en"
                                    ? "Configure accounts & API keys..."
                                    : "Configurar cuentas y API keys..."
                                }
                              </span>
                            </button>
                          </div>`
                        : ""
                    }
                  </div>
                </div>
                <div class="composer-right">
                  <button
                    id="toggle-mode-btn"
                    type="button"
                    class="mode-pill ${agentMode === "plan" ? "is-plan" : ""}"
                  >
                    ${icons.shield}
                    <span>${agentMode === "plan" ? t("chat.modePlan") : t("chat.modeNormal")}</span>
                  </button>
                  ${
                    activeRunId
                      ? `<button id="stop-run-btn" type="button" class="send-circle is-stop" title="${
                          locale === "en" ? "Stop" : "Detener"
                        }">${icons.stop}</button>`
                      : `<button type="submit" class="send-circle" title="${t("chat.send")}">
                          ${icons.arrowUp}
                        </button>`
                  }
                </div>
              </div>
            </form>
          </footer>
        </main>

        <aside class="artifacts-panel" aria-hidden="${!artifactsOpen}">
          <div class="artifacts-header">
            <span>${t("artifacts.title")}</span>
            <button
              id="close-artifacts-btn"
              class="icon-btn"
              title="${t("artifacts.close")}"
            >${icons.close}</button>
          </div>
          ${
            current.artifacts.length > 1
              ? `<div class="artifact-tabs">
                  ${current.artifacts
                    .map(
                      (art) => `
                    <button
                      type="button"
                      class="artifact-tab ${activeArtifact?.id === art.id ? "active" : ""}"
                      data-open-artifact="${art.id}"
                    >${escapeHtml(art.title)}</button>`
                    )
                    .join("")}
                </div>`
              : ""
          }
          <div class="artifacts-body">
            ${
              activeArtifact
                ? `<div class="artifact-card">
                    <div class="artifact-card-title">${escapeHtml(activeArtifact.title)}</div>
                    ${renderArtifactContent(activeArtifact)}
                  </div>`
                : `<div class="artifacts-empty">${t("artifacts.empty")}</div>`
            }
          </div>
        </aside>
      </div>
      ${renderSettingsModal(locale)}
      ${renderSkillsModal(locale)}
      ${renderAutomationsModal(locale)}
      ${renderUpdateModal(locale)}
      ${renderLightbox()}
    </div>
  `;

  bindEvents();
}

function bindCopyButtons(scope: ParentNode): void {
  scope.querySelectorAll<HTMLButtonElement>("[data-copy-code]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.dataset.copyCode ?? "";
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = t("chat.copied");
        setTimeout(() => {
          btn.textContent = t("chat.copyCode");
        }, 1200);
      } catch {
        // Ignorar si no hay permiso de portapapeles
      }
    });
  });

  scope.querySelectorAll<HTMLButtonElement>("[data-preview-code]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.previewKind === "svg" ? "svg" : "html";
      const code = btn.dataset.previewCode ?? "";
      const current = getActiveConversation();
      const id = crypto.randomUUID();
      current.artifacts.push({
        id,
        title: kind === "svg" ? "Vista previa SVG" : "Vista previa HTML",
        kind,
        content: code,
      });
      selectedArtifactId = id;
      artifactsOpen = true;
      schedulePersist();
      render();
    });
  });
}

function getSlashCommands(locale: Locale): Array<{ value: string; label: string; hint: string }> {
  return [
    {
      value: "/plan",
      label: "/plan",
      hint: locale === "en" ? "Read-only exploration mode" : "Modo solo lectura",
    },
    {
      value: "/normal",
      label: "/normal",
      hint: locale === "en" ? "Normal edit mode" : "Modo normal",
    },
    {
      value: "/nuevo",
      label: "/nuevo",
      hint: locale === "en" ? "Start a new conversation" : "Crear nueva conversación",
    },
    {
      value: "/limpiar",
      label: "/limpiar",
      hint: locale === "en" ? "Clear current messages" : "Limpiar mensajes actuales",
    },
    {
      value: "/ajustes",
      label: "/ajustes",
      hint: locale === "en" ? "Open Settings" : "Abrir Ajustes",
    },
  ];
}

function applySuggestion(item: { value: string }): void {
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  if (!input) return;

  if (suggestKind === "slash") {
    suggestKind = null;
    suggestItems = [];
    if (item.value === "/plan") {
      agentMode = "plan";
      input.value = "";
      draftText = "";
      render();
      return;
    }
    if (item.value === "/normal") {
      agentMode = "normal";
      input.value = "";
      draftText = "";
      render();
      return;
    }
    if (item.value === "/nuevo") {
      const current = getActiveConversation();
      const conv = createConversation(current.projectId, t("sidebar.newChat"));
      conversations.unshift(conv);
      activeConversationId = conv.id;
      input.value = "";
      draftText = "";
      schedulePersist();
      render();
      return;
    }
    if (item.value === "/limpiar") {
      const current = getActiveConversation();
      current.messages = [];
      current.sessionId = undefined;
      input.value = "";
      draftText = "";
      schedulePersist();
      render();
      return;
    }
    if (item.value === "/ajustes") {
      settingsOpen = true;
      input.value = "";
      draftText = "";
      render();
      return;
    }
  } else if (suggestKind === "file") {
    const val = input.value;
    const replaced = val.replace(/@[^\s@]*$/, `@${item.value} `);
    input.value = replaced;
    draftText = replaced;
    suggestKind = null;
    suggestItems = [];
    render();
    const next = document.getElementById("chat-input") as HTMLTextAreaElement | null;
    if (next) {
      next.focus();
      next.setSelectionRange(replaced.length, replaced.length);
    }
  }
}

async function refreshProviders(autoSelectIfUnset: boolean): Promise<void> {
  refreshingProviders = true;
  if (settingsOpen) render();
  const detected = await fetchDetectedProviders();
  providers = detected;
  refreshingProviders = false;

  const currentProv = providers.find((p) => p.id === providerId);
  if (autoSelectIfUnset && (!currentProv || !currentProv.connected)) {
    const firstConnected = providers.find((p) => p.connected);
    if (firstConnected) {
      providerId = firstConnected.id;
      modelId = firstConnected.models[0]?.id ?? "";
    }
  } else if (currentProv && currentProv.models.length > 0) {
    if (!currentProv.models.some((m) => m.id === modelId)) {
      modelId = currentProv.models[0].id;
    }
  }
  render();
}

async function handleSelectWorkspace(): Promise<void> {
  const status = await pickAndSetWorkspace();
  if (!status || !status.path) return;

  let existing = projects.find((p) => p.path === status.path);
  if (!existing) {
    existing = {
      id: crypto.randomUUID(),
      name: folderBasename(status.path),
      path: status.path,
      trusted: status.trusted,
    };
    projects.unshift(existing);
  } else {
    existing.trusted = status.trusted;
  }

  const conv = createConversation(existing.id, t("sidebar.newChat"));
  conversations.unshift(conv);
  activeConversationId = conv.id;
  schedulePersist();
  render();
}

async function addImageFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files);
  for (const file of list) {
    if (pendingImages.length >= 5) break;
    if (!file.type.startsWith("image/")) continue;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
      reader.readAsDataURL(file);
    });
    if (!dataUrl) continue;
    try {
      const saved = await saveChatImage(file.name || "imagen.png", file.type, dataUrl);
      pendingImages.push({
        id: crypto.randomUUID(),
        path: saved.path,
        name: saved.name,
        mime: saved.mime,
        previewUrl: dataUrl,
        dataBase64: dataUrl,
      });
    } catch {
      // Ignorar formato no soportado o imagen > 10 MB
    }
  }
  render();
}

async function submitMessage(): Promise<void> {
  if (activeRunId) return;
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  if (!input) return;
  const text = input.value.trim();
  if (!text && pendingImages.length === 0) return;

  const attached = [...pendingImages];
  pendingImages = [];
  draftText = "";
  input.value = "";

  const current = getActiveConversation();
  const effectiveMode = detectModeFromInput(text, agentMode);
  agentMode = effectiveMode;

  if (current.messages.length === 0) {
    current.title = (text || attached[0]?.name || "Imagen").slice(0, 42);
  }

  const history = current.messages
    .filter((m) => m.status === "done" && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  const effectivePrompt = text || "Analiza las imágenes adjuntas.";
  current.updatedAt = Date.now();
  current.messages.push({
    id: crypto.randomUUID(),
    role: "user",
    content: text,
    images: attached.length > 0 ? attached : undefined,
    mode: effectiveMode,
    status: "done",
    createdAt: Date.now(),
  });

  const assistantMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    mode: effectiveMode,
    status: "thinking",
    createdAt: Date.now(),
  };
  current.messages.push(assistantMsg);

  const runId = crypto.randomUUID();
  activeRunId = runId;
  render();

  const scroller = document.getElementById("chat-scroll");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;

  try {
    await sendChatStream(
      {
        runId,
        providerId,
        modelId,
        mode: effectiveMode,
        prompt: effectivePrompt,
        history,
        sessionId: current.sessionId,
        images: attached,
      },
      (ev) => {
        if (ev.type === "thinking") {
          if (ev.replace) {
            assistantMsg.thinking = ev.text;
          } else {
            assistantMsg.thinking = (assistantMsg.thinking ?? "") + ev.text;
          }
          updateStreamingMessageDom(assistantMsg);
        } else if (ev.type === "tool") {
          const list = assistantMsg.tools ?? [];
          const existing = list.find((item) => item.id === ev.id);
          if (existing) {
            existing.state = ev.state;
            if (ev.detail) existing.detail = ev.detail;
          } else {
            list.push({
              id: ev.id,
              name: ev.name,
              detail: ev.detail,
              state: ev.state,
            });
          }
          assistantMsg.tools = list;
          updateStreamingMessageDom(assistantMsg);
        } else if (ev.type === "delta") {
          assistantMsg.status = "streaming";
          if (ev.replace) {
            assistantMsg.content = ev.text;
          } else {
            assistantMsg.content += ev.text;
          }
          updateStreamingMessageDom(assistantMsg);
        } else if (ev.type === "diff_summary") {
          const artifactId = crypto.randomUUID();
          current.artifacts.push({
            id: artifactId,
            title: `git diff (${ev.files_count})`,
            kind: "diff",
            content: ev.diff_text,
          });
          assistantMsg.diff = {
            filesCount: ev.files_count,
            added: ev.added,
            removed: ev.removed,
            artifactId,
          };
          selectedArtifactId = artifactId;
          updateStreamingMessageDom(assistantMsg);
        } else if (ev.type === "done") {
          assistantMsg.status = "done";
          assistantMsg.durationMs = ev.duration_ms;
          if (ev.session_id) {
            current.sessionId = ev.session_id;
          }
          activeRunId = null;
          schedulePersist();
          render();
        } else if (ev.type === "error") {
          assistantMsg.status = "error";
          assistantMsg.error = ev.message;
          activeRunId = null;
          schedulePersist();
          render();
        }
      }
    );
  } catch (err) {
    if (assistantMsg.status !== "error") {
      assistantMsg.status = "error";
      assistantMsg.error = typeof err === "string" ? err : String(err);
    }
    activeRunId = null;
    render();
  }
}

function bindEvents(): void {
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  document.getElementById("win-min-btn")?.addEventListener("click", () => {
    if (inTauri) void getCurrentWindow().minimize();
  });
  document.getElementById("win-max-btn")?.addEventListener("click", () => {
    if (inTauri) void getCurrentWindow().toggleMaximize();
  });
  document.getElementById("win-close-btn")?.addEventListener("click", () => {
    if (inTauri) void getCurrentWindow().close();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-set-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.setLang as Locale | undefined;
      if (lang) {
        setLocale(lang);
        schedulePersist();
        render();
      }
    });
  });

  const searchInput = document.getElementById("sidebar-search-input") as HTMLInputElement | null;
  searchInput?.addEventListener("input", () => {
    searchQuery = searchInput.value;
    const pos = searchInput.selectionStart ?? searchQuery.length;
    render();
    const next = document.getElementById("sidebar-search-input") as HTMLInputElement | null;
    if (next) {
      next.focus();
      next.setSelectionRange(pos, pos);
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-rename-conv]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.renameConv;
      const conv = conversations.find((c) => c.id === id);
      if (!conv) return;
      const nextTitle = window.prompt(
        getLocale() === "en" ? "New conversation title:" : "Nuevo título de la conversación:",
        conv.title
      );
      if (nextTitle && nextTitle.trim()) {
        conv.title = nextTitle.trim();
        schedulePersist();
        render();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-delete-conv]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.deleteConv;
      const idx = conversations.findIndex((c) => c.id === id);
      if (idx < 0) return;
      conversations.splice(idx, 1);
      if (conversations.length === 0) {
        conversations.push(createConversation(projects[0].id, t("sidebar.newChat")));
      }
      if (activeConversationId === id) {
        activeConversationId = conversations[0].id;
      }
      schedulePersist();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-open-artifact]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedArtifactId = btn.dataset.openArtifact ?? null;
      artifactsOpen = true;
      render();
    });
  });

  document.getElementById("provider-trigger-btn")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    providerMenuOpen = !providerMenuOpen;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-provider-id]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.providerId;
      if (id) {
        providerId = id;
        const prov = getActiveProvider();
        modelId = prov.models[0]?.id ?? "";
        render();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-model-id]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.modelId;
      if (id) {
        modelId = id;
        providerMenuOpen = false;
        schedulePersist();
        render();
      }
    });
  });

  document.getElementById("menu-open-settings-btn")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    providerMenuOpen = false;
    settingsOpen = true;
    render();
  });

  document.getElementById("open-settings-btn")?.addEventListener("click", () => {
    settingsOpen = true;
    render();
  });

  document.getElementById("close-settings-btn")?.addEventListener("click", () => {
    settingsOpen = false;
    render();
  });

  document.getElementById("settings-backdrop")?.addEventListener("click", (ev) => {
    if (ev.target === ev.currentTarget) {
      settingsOpen = false;
      render();
    }
  });

  document.getElementById("refresh-providers-btn")?.addEventListener("click", () => {
    void refreshProviders(false);
  });

  document.getElementById("refresh-quota-btn")?.addEventListener("click", async () => {
    loadingQuota = true;
    render();
    quotaGroups = await fetchAntigravityQuota();
    loadingQuota = false;
    render();
  });

  document.getElementById("check-update-btn")?.addEventListener("click", async () => {
    checkingUpdate = true;
    updateStatusMsg = "";
    render();
    try {
      const found = await checkDesktopUpdate();
      availableUpdate = found;
      if (found) {
        updateStatusMsg = "";
        settingsOpen = false;
        updateModalOpen = true;
      } else {
        updateStatusMsg =
          getLocale() === "en"
            ? "Pulso Desktop is up to date."
            : "Pulso Desktop está actualizado.";
      }
    } catch (err) {
      updateStatusMsg = typeof err === "string" ? err : String(err);
    } finally {
      checkingUpdate = false;
      render();
    }
  });

  document.getElementById("topbar-update-btn")?.addEventListener("click", () => {
    updateStatusMsg = "";
    updateModalOpen = true;
    render();
  });

  document.getElementById("close-update-btn")?.addEventListener("click", () => {
    updateModalOpen = false;
    render();
  });

  document.getElementById("cancel-update-btn")?.addEventListener("click", () => {
    updateModalOpen = false;
    render();
  });

  document.getElementById("update-backdrop")?.addEventListener("click", (ev) => {
    if (ev.target === ev.currentTarget && !installingUpdate) {
      updateModalOpen = false;
      render();
    }
  });

  document.getElementById("confirm-install-update-btn")?.addEventListener("click", async () => {
    if (!availableUpdate || installingUpdate) return;
    installingUpdate = true;
    updateStatusMsg = "";
    render();
    try {
      await installDesktopUpdate(availableUpdate);
    } catch (err) {
      updateStatusMsg = typeof err === "string" ? err : String(err);
      installingUpdate = false;
      render();
    }
  });

  document.getElementById("open-skills-btn")?.addEventListener("click", async () => {
    skillsModalOpen = true;
    render();
    skillsReport = await inspectProjectSkills();
    render();
  });

  document.getElementById("close-skills-btn")?.addEventListener("click", () => {
    skillsModalOpen = false;
    render();
  });

  document.getElementById("skills-backdrop")?.addEventListener("click", (ev) => {
    if (ev.target === ev.currentTarget) {
      skillsModalOpen = false;
      render();
    }
  });

  document.getElementById("add-mcp-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const nameEl = document.getElementById("mcp-name-input") as HTMLInputElement | null;
    const targetEl = document.getElementById("mcp-target-input") as HTMLInputElement | null;
    const name = nameEl?.value.trim() ?? "";
    const target = targetEl?.value.trim() ?? "";
    if (!name || !target) return;
    mcpServers.push({
      id: crypto.randomUUID(),
      name,
      transport: target.startsWith("http://") || target.startsWith("https://") ? "http" : "stdio",
      target,
      enabled: true,
    });
    schedulePersist();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-remove-mcp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      mcpServers = mcpServers.filter((m) => m.id !== btn.dataset.removeMcp);
      schedulePersist();
      render();
    });
  });

  document.getElementById("open-automations-btn")?.addEventListener("click", () => {
    automationsModalOpen = true;
    render();
  });

  document.getElementById("close-automations-btn")?.addEventListener("click", () => {
    automationsModalOpen = false;
    render();
  });

  document.getElementById("automations-backdrop")?.addEventListener("click", (ev) => {
    if (ev.target === ev.currentTarget) {
      automationsModalOpen = false;
      render();
    }
  });

  document.getElementById("add-auto-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const nameEl = document.getElementById("auto-name-input") as HTMLInputElement | null;
    const promptEl = document.getElementById("auto-prompt-input") as HTMLInputElement | null;
    const name = nameEl?.value.trim() ?? "";
    const prompt = promptEl?.value.trim() ?? "";
    if (!name || !prompt) return;
    automations.push({
      id: crypto.randomUUID(),
      name,
      prompt,
      mode: "plan",
    });
    schedulePersist();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-delete-auto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      automations = automations.filter((a) => a.id !== btn.dataset.deleteAuto);
      schedulePersist();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-run-auto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const auto = automations.find((a) => a.id === btn.dataset.runAuto);
      if (!auto) return;
      automationsModalOpen = false;
      agentMode = auto.mode;
      draftText = auto.prompt;
      render();
      void submitMessage();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-top-menu]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const target = btn.dataset.topMenu as "workspace" | "view" | "window";
      openTopMenu = openTopMenu === target ? null : target;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-menu-act]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const act = btn.dataset.menuAct;
      openTopMenu = null;
      if (act === "new-chat") {
        const current = getActiveConversation();
        const conv = createConversation(current.projectId, t("sidebar.newChat"));
        conversations.unshift(conv);
        activeConversationId = conv.id;
        schedulePersist();
      } else if (act === "add-folder") {
        await handleSelectWorkspace();
        return;
      } else if (act === "open-editor") {
        const err = await openInPulsoEditor();
        if (err) window.alert(err);
      } else if (act === "open-skills") {
        skillsModalOpen = true;
        render();
        skillsReport = await inspectProjectSkills();
      } else if (act === "open-settings") {
        settingsOpen = true;
      } else if (act === "toggle-sidebar") {
        sidebarOpen = !sidebarOpen;
      } else if (act === "toggle-artifacts") {
        artifactsOpen = !artifactsOpen;
      } else if (act === "toggle-lang") {
        setLocale(getLocale() === "es" ? "en" : "es");
        schedulePersist();
      } else if (act === "win-min" && inTauri) {
        void getCurrentWindow().minimize();
      } else if (act === "win-max" && inTauri) {
        void getCurrentWindow().toggleMaximize();
      } else if (act === "win-close" && inTauri) {
        void getCurrentWindow().close();
      }
      render();
    });
  });

  document.getElementById("open-editor-btn")?.addEventListener("click", async () => {
    const err = await openInPulsoEditor();
    if (err) {
      window.alert(err);
    }
  });

  document.querySelectorAll<HTMLImageElement>(".msg-image").forEach((img) => {
    img.addEventListener("click", () => {
      lightboxImageUrl = img.src;
      render();
    });
  });

  document.getElementById("lightbox-backdrop")?.addEventListener("click", () => {
    lightboxImageUrl = null;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-suggest-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.suggestIdx ?? "-1");
      if (idx >= 0 && suggestItems[idx]) {
        applySuggestion(suggestItems[idx]);
      }
    });
  });

  document.querySelectorAll<HTMLFormElement>("[data-key-form]").forEach((form) => {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const pid = form.dataset.keyForm;
      const input = form.querySelector<HTMLInputElement>(".key-input");
      if (!pid || !input || !input.value.trim()) return;
      await saveProviderApiKey(pid, input.value.trim());
      input.value = "";
      await refreshProviders(false);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-delete-key]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pid = btn.dataset.deleteKey;
      if (!pid) return;
      await deleteProviderApiKey(pid);
      await refreshProviders(false);
    });
  });

  document.getElementById("collapse-sidebar-btn")?.addEventListener("click", () => {
    sidebarOpen = false;
    render();
  });

  document.getElementById("expand-sidebar-btn")?.addEventListener("click", () => {
    sidebarOpen = true;
    render();
  });

  document.getElementById("new-chat-btn")?.addEventListener("click", () => {
    const current = getActiveConversation();
    const conv = createConversation(current.projectId, t("sidebar.newChat"));
    conversations.unshift(conv);
    activeConversationId = conv.id;
    schedulePersist();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-conv-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.convId;
      if (id) {
        activeConversationId = id;
        selectedArtifactId = null;
        schedulePersist();
        render();
      }
    });
  });

  document.getElementById("toggle-artifacts-btn")?.addEventListener("click", () => {
    artifactsOpen = !artifactsOpen;
    render();
  });

  document.getElementById("close-artifacts-btn")?.addEventListener("click", () => {
    artifactsOpen = false;
    render();
  });

  bindCopyButtons(document);

  document.getElementById("toggle-mode-btn")?.addEventListener("click", () => {
    agentMode = agentMode === "normal" ? "plan" : "normal";
    render();
  });

  document.getElementById("add-project-btn")?.addEventListener("click", handleSelectWorkspace);
  document.getElementById("header-folder-btn")?.addEventListener("click", handleSelectWorkspace);
  document.getElementById("composer-folder-btn")?.addEventListener("click", handleSelectWorkspace);

  document.getElementById("trust-workspace-btn")?.addEventListener("click", async () => {
    const activeProject = getProject(getActiveConversation().projectId);
    if (!activeProject.path) return;
    await trustActiveWorkspace(activeProject.path);
    activeProject.trusted = true;
    render();
  });

  document.getElementById("stop-run-btn")?.addEventListener("click", async () => {
    if (!activeRunId) return;
    const id = activeRunId;
    activeRunId = null;
    await cancelChatRun(id);
    render();
  });

  const fileInput = document.getElementById("image-file-input") as HTMLInputElement | null;
  document.getElementById("composer-image-btn")?.addEventListener("click", () => {
    fileInput?.click();
  });
  fileInput?.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length > 0) {
      void addImageFiles(fileInput.files);
      fileInput.value = "";
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-remove-image]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.removeImage;
      pendingImages = pendingImages.filter((img) => img.id !== id);
      render();
    });
  });

  const composerBox = document.getElementById("composer-form");
  composerBox?.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    composerBox.classList.add("drag-over");
  });
  composerBox?.addEventListener("dragleave", () => {
    composerBox.classList.remove("drag-over");
  });
  composerBox?.addEventListener("drop", (ev) => {
    ev.preventDefault();
    composerBox.classList.remove("drag-over");
    if (ev.dataTransfer?.files && ev.dataTransfer.files.length > 0) {
      void addImageFiles(ev.dataTransfer.files);
    }
  });

  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  const autoResize = () => {
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(180, Math.max(36, input.scrollHeight))}px`;
  };
  autoResize();

  input?.addEventListener("input", async () => {
    autoResize();
    const val = input.value;
    draftText = val;
    const pos = input.selectionStart ?? val.length;
    const before = val.slice(0, pos);

    const slashMatch = before.match(/^\/([^\s]*)$/);
    if (slashMatch) {
      const q = slashMatch[1].toLowerCase();
      suggestKind = "slash";
      suggestItems = getSlashCommands(getLocale()).filter((c) =>
        c.label.toLowerCase().includes(q)
      );
      suggestIndex = 0;
      render();
      const next = document.getElementById("chat-input") as HTMLTextAreaElement | null;
      if (next) {
        next.focus();
        next.setSelectionRange(pos, pos);
      }
      return;
    }

    const fileMatch = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (fileMatch) {
      const q = fileMatch[1];
      const files = await listWorkspaceFiles(q);
      suggestKind = "file";
      suggestItems = files.slice(0, 12).map((f) => ({
        value: f,
        label: `@${f}`,
        hint: "archivo",
      }));
      suggestIndex = 0;
      render();
      const next = document.getElementById("chat-input") as HTMLTextAreaElement | null;
      if (next) {
        next.focus();
        next.setSelectionRange(pos, pos);
      }
      return;
    }

    if (suggestKind !== null) {
      suggestKind = null;
      suggestItems = [];
      render();
      const next = document.getElementById("chat-input") as HTMLTextAreaElement | null;
      if (next) {
        next.focus();
        next.setSelectionRange(pos, pos);
      }
    }
  });

  input?.addEventListener("paste", (ev) => {
    const items = ev.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      ev.preventDefault();
      void addImageFiles(files);
    }
  });

  input?.addEventListener("keydown", (ev) => {
    if (suggestKind && suggestItems.length > 0) {
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        suggestIndex = (suggestIndex + 1) % suggestItems.length;
        render();
        (document.getElementById("chat-input") as HTMLTextAreaElement | null)?.focus();
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length;
        render();
        (document.getElementById("chat-input") as HTMLTextAreaElement | null)?.focus();
        return;
      }
      if (ev.key === "Enter" || ev.key === "Tab") {
        ev.preventDefault();
        applySuggestion(suggestItems[suggestIndex]);
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        suggestKind = null;
        suggestItems = [];
        render();
        (document.getElementById("chat-input") as HTMLTextAreaElement | null)?.focus();
        return;
      }
    }
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void submitMessage();
    }
  });

  composerBox?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitMessage();
  });
}

async function bootstrap(): Promise<void> {
  const saved = await loadPersistedState();
  if (saved) {
    if (saved.locale === "es" || saved.locale === "en") {
      setLocale(saved.locale);
    }
    if (saved.providerId) providerId = saved.providerId;
    if (saved.modelId) modelId = saved.modelId;
    if (Array.isArray(saved.projects) && saved.projects.length > 0) {
      projects.splice(0, projects.length, ...saved.projects);
    }
    if (Array.isArray(saved.conversations) && saved.conversations.length > 0) {
      conversations.splice(0, conversations.length, ...saved.conversations);
    }
    if (Array.isArray(saved.mcpServers)) {
      mcpServers = saved.mcpServers;
    }
    if (Array.isArray(saved.automations) && saved.automations.length > 0) {
      automations = saved.automations;
    }
    if (
      saved.activeConversationId &&
      conversations.some((c) => c.id === saved.activeConversationId)
    ) {
      activeConversationId = saved.activeConversationId;
    } else if (conversations[0]) {
      activeConversationId = conversations[0].id;
    }
  }

  const status = await getWorkspaceStatus();
  if (status.path && !projects.some((p) => p.path === status.path)) {
    projects[0].name = folderBasename(status.path);
    projects[0].path = status.path;
    projects[0].trusted = status.trusted;
  }

  render();

  // Restaurar vistas previas de imágenes guardadas en disco para la conversación activa
  const active = getActiveConversation();
  let restoredAnyImage = false;
  for (const msg of active.messages) {
    if (!msg.images) continue;
    for (const img of msg.images) {
      if (!img.previewUrl && img.path) {
        const url = await loadSavedImagePreview(img.path);
        if (url) {
          img.previewUrl = url;
          restoredAnyImage = true;
        }
      }
    }
  }
  if (restoredAnyImage) render();

  await refreshProviders(!saved?.providerId);

  // Comprobación silenciosa de nuevas versiones en segundo plano
  window.setTimeout(async () => {
    try {
      const found = await checkDesktopUpdate();
      if (found) {
        availableUpdate = found;
        render();
      }
    } catch {
      // Silencioso en segundo plano si no hay internet
    }
  }, 4000);
}

document.addEventListener("click", () => {
  if (providerMenuOpen || openTopMenu) {
    providerMenuOpen = false;
    openTopMenu = null;
    render();
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    if (lightboxImageUrl) {
      lightboxImageUrl = null;
      render();
    } else if (openTopMenu) {
      openTopMenu = null;
      render();
    } else if (providerMenuOpen) {
      providerMenuOpen = false;
      render();
    } else if (settingsOpen) {
      settingsOpen = false;
      render();
    } else if (skillsModalOpen) {
      skillsModalOpen = false;
      render();
    } else if (automationsModalOpen) {
      automationsModalOpen = false;
      render();
    }
  }
});

void bootstrap();

import { invoke } from "@tauri-apps/api/core";
import type { Locale } from "../locales/i18n";

export type ProviderAuthMode = "account" | "api_key" | "local";
export type SecretSource = "desktop" | "pulso_editor" | "env" | "none";

export interface ModelInfo {
  id: string;
  label: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  authModes: ProviderAuthMode[];
  local: boolean;
  connected: boolean;
  accountConnected: boolean;
  plan: string;
  keySource: SecretSource;
  models: ModelInfo[];
}

export const fallbackProviders: ProviderStatus[] = [
  {
    id: "antigravity",
    name: "Antigravity",
    authModes: ["account", "api_key"],
    local: false,
    connected: false,
    accountConnected: false,
    plan: "",
    keySource: "none",
    models: [{ id: "default", label: "Predeterminado" }],
  },
  {
    id: "openai",
    name: "OpenAI",
    authModes: ["account", "api_key"],
    local: false,
    connected: false,
    accountConnected: false,
    plan: "",
    keySource: "none",
    models: [
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    authModes: ["account", "api_key"],
    local: false,
    connected: false,
    accountConnected: false,
    plan: "",
    keySource: "none",
    models: [
      { id: "sonnet", label: "Claude Sonnet" },
      { id: "opus", label: "Claude Opus" },
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    authModes: ["local"],
    local: true,
    connected: false,
    accountConnected: false,
    plan: "",
    keySource: "none",
    models: [],
  },
];

export interface AppSettings {
  locale: Locale;
  providerId: string;
  modelId: string;
  artifactsOpen: boolean;
  sidebarOpen: boolean;
}

export const defaultSettings: AppSettings = {
  locale: "es",
  providerId: "antigravity",
  modelId: "default",
  artifactsOpen: false,
  sidebarOpen: true,
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function fetchDetectedProviders(): Promise<ProviderStatus[]> {
  if (!isTauriRuntime()) {
    return fallbackProviders;
  }
  try {
    const list = await invoke<ProviderStatus[]>("list_providers");
    return list.length > 0 ? list : fallbackProviders;
  } catch {
    return fallbackProviders;
  }
}

export async function saveProviderApiKey(providerId: string, value: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_provider_secret", { providerId, value });
}

export async function deleteProviderApiKey(providerId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("delete_provider_secret", { providerId });
}

export function describeProviderConnection(prov: ProviderStatus, locale: Locale): string {
  if (prov.accountConnected) {
    const label = prov.plan || prov.name;
    return locale === "en" ? `Connected · ${label}` : `Conectado · ${label}`;
  }
  if (prov.keySource === "pulso_editor") {
    return locale === "en" ? "Inherited from Pulso Editor" : "Heredado de Pulso Editor";
  }
  if (prov.keySource === "desktop") {
    return locale === "en" ? "API key saved" : "API key guardada";
  }
  if (prov.keySource === "env") {
    return locale === "en" ? "API key from environment" : "API key desde entorno";
  }
  if (prov.local && prov.connected) {
    return locale === "en"
      ? `Local · ${prov.models.length} models`
      : `Local · ${prov.models.length} modelos`;
  }
  if (prov.local) {
    return locale === "en" ? "No local models detected" : "Sin modelos locales detectados";
  }
  return locale === "en" ? "Account / plan or API key" : "Cuenta / plan o API key";
}

export interface QuotaBucket {
  name: string;
  window: string;
  remainingPercent: number;
  resetTime: string;
}

export interface QuotaGroup {
  name: string;
  buckets: QuotaBucket[];
}

export interface McpServerItem {
  id: string;
  name: string;
  transport: "stdio" | "http";
  target: string;
  enabled: boolean;
}

export async function fetchAntigravityQuota(): Promise<QuotaGroup[]> {
  if (!isTauriRuntime()) return [];
  try {
    return await invoke<QuotaGroup[]>("get_antigravity_quota");
  } catch {
    return [];
  }
}

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface WorkspaceStatus {
  path: string | null;
  trusted: boolean;
}

export interface SkillEntry {
  kind: string;
  name: string;
  path: string;
}

export interface ProjectSkillsReport {
  trusted: boolean;
  entries: SkillEntry[];
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getWorkspaceStatus(): Promise<WorkspaceStatus> {
  if (!isTauriRuntime()) {
    return { path: null, trusted: false };
  }
  return invoke<WorkspaceStatus>("get_workspace_status");
}

export async function pickAndSetWorkspace(): Promise<WorkspaceStatus | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Seleccionar carpeta de proyecto",
  });
  if (typeof selected !== "string") {
    return null;
  }
  return invoke<WorkspaceStatus>("set_active_workspace", { path: selected });
}

export async function trustActiveWorkspace(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("trust_workspace", { path });
}

export async function listWorkspaceFiles(query: string): Promise<string[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  try {
    return await invoke<string[]>("list_workspace_files", { query });
  } catch {
    return [];
  }
}

export async function inspectProjectSkills(): Promise<ProjectSkillsReport> {
  if (!isTauriRuntime()) {
    return { trusted: false, entries: [] };
  }
  try {
    return await invoke<ProjectSkillsReport>("inspect_project_skills");
  } catch {
    return { trusted: false, entries: [] };
  }
}

export async function openInPulsoEditor(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return "Disponible solo en la aplicación de escritorio.";
  }
  try {
    await invoke("open_in_pulso_editor");
    return null;
  } catch (err) {
    return typeof err === "string" ? err : String(err);
  }
}

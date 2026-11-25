pub mod agent;
pub mod mcp;
pub mod providers;
pub mod security;
pub mod storage;
pub mod updates;
pub mod workspace_tools;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Manager, State};

use crate::agent::runner::{ActiveRuns, ChatStreamEvent, SendMessageRequest};
use crate::security::fsguard::FsGuard;
use crate::security::trusted_folders::{TrustedFolderEntry, TrustedFoldersStore};

pub struct AppState {
    pub active_workspace: Mutex<Option<FsGuard>>,
    pub trusted_folders: Mutex<TrustedFoldersStore>,
    pub active_runs: Arc<ActiveRuns>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    pub path: Option<String>,
    pub trusted: bool,
}

#[tauri::command]
fn get_workspace_status(state: State<'_, AppState>) -> Result<WorkspaceStatus, String> {
    let guard = state
        .active_workspace
        .lock()
        .map_err(|_| "No se pudo bloquear el estado del espacio de trabajo".to_string())?;
    let trusted_store = state
        .trusted_folders
        .lock()
        .map_err(|_| "No se pudo bloquear el almacén de carpetas confiables".to_string())?;

    match guard.as_ref() {
        Some(fs) => {
            let root = fs.root();
            Ok(WorkspaceStatus {
                path: Some(root.to_string_lossy().to_string()),
                trusted: trusted_store.is_trusted(root),
            })
        }
        None => Ok(WorkspaceStatus {
            path: None,
            trusted: false,
        }),
    }
}

#[tauri::command]
fn set_active_workspace(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceStatus, String> {
    let fs_guard = FsGuard::new(PathBuf::from(&path))?;
    let canonical_root = fs_guard.root().to_path_buf();

    let trusted = {
        let store = state
            .trusted_folders
            .lock()
            .map_err(|_| "No se pudo bloquear el almacén de carpetas confiables".to_string())?;
        store.is_trusted(&canonical_root)
    };

    let mut active = state
        .active_workspace
        .lock()
        .map_err(|_| "No se pudo actualizar el espacio de trabajo activo".to_string())?;
    *active = Some(fs_guard);

    Ok(WorkspaceStatus {
        path: Some(canonical_root.to_string_lossy().to_string()),
        trusted,
    })
}

#[tauri::command]
fn trust_workspace(path: String, state: State<'_, AppState>) -> Result<TrustedFolderEntry, String> {
    let mut store = state
        .trusted_folders
        .lock()
        .map_err(|_| "No se pudo bloquear el almacén de carpetas confiables".to_string())?;
    store.trust(&PathBuf::from(path))
}

#[tauri::command]
fn list_trusted_workspaces(state: State<'_, AppState>) -> Result<Vec<TrustedFolderEntry>, String> {
    let store = state
        .trusted_folders
        .lock()
        .map_err(|_| "No se pudo bloquear el almacén de carpetas confiables".to_string())?;
    Ok(store.list())
}

#[tauri::command]
async fn list_providers() -> Vec<providers::ProviderInfo> {
    providers::detect_all_providers().await
}

#[tauri::command]
fn has_provider_secret(provider_id: String) -> Result<bool, String> {
    security::secrets::has_secret(&provider_id)
}

#[tauri::command]
fn save_provider_secret(provider_id: String, value: String) -> Result<(), String> {
    security::secrets::save_secret(&provider_id, &value)
}

#[tauri::command]
fn delete_provider_secret(provider_id: String) -> Result<(), String> {
    security::secrets::delete_secret(&provider_id)
}

#[tauri::command]
async fn send_chat_message(
    request: SendMessageRequest,
    on_event: Channel<ChatStreamEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cwd = state
        .active_workspace
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|fs| fs.root().to_path_buf()))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));

    let runs = state.active_runs.clone();
    agent::runner::run_chat(request, cwd, runs, on_event).await
}

#[tauri::command]
fn cancel_chat_run(run_id: String, state: State<'_, AppState>) -> bool {
    state.active_runs.cancel(&run_id)
}

#[tauri::command]
fn save_chat_image(
    app: tauri::AppHandle,
    name: Option<String>,
    mime: String,
    data_base64: String,
) -> Result<agent::runner::SavedImage, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver app_data_dir: {e}"))?;
    agent::runner::save_chat_image_to_dir(&dir, name, mime, data_base64)
}

#[tauri::command]
fn load_app_state(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver app_data_dir: {e}"))?;
    storage::load_state(&dir)
}

#[tauri::command]
fn save_app_state(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver app_data_dir: {e}"))?;
    storage::save_state(&dir, &state)
}

#[tauri::command]
fn read_chat_image_data_url(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver app_data_dir: {e}"))?;
    storage::read_saved_image_data_url(&dir, &path)
}

#[tauri::command]
fn list_workspace_files(
    query: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let root = state
        .active_workspace
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|fs| fs.root().to_path_buf()))
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "No hay una carpeta activa".to_string())?;
    Ok(workspace_tools::list_files_under(
        &root,
        query.as_deref().unwrap_or(""),
        30,
    ))
}

#[tauri::command]
fn inspect_project_skills(
    state: State<'_, AppState>,
) -> Result<workspace_tools::ProjectSkillsReport, String> {
    let root = state
        .active_workspace
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|fs| fs.root().to_path_buf()))
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "No hay una carpeta activa".to_string())?;
    let trusted = state
        .trusted_folders
        .lock()
        .map(|s| s.is_trusted(&root))
        .unwrap_or(false);
    Ok(workspace_tools::inspect_skills(&root, trusted))
}

#[tauri::command]
fn open_in_pulso_editor(state: State<'_, AppState>) -> Result<(), String> {
    let target = state
        .active_workspace
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|fs| fs.root().to_path_buf()))
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "No hay una carpeta activa".to_string())?;

    let bin = providers::resolve_cli_binary("pulso")
        .or_else(|| providers::resolve_cli_binary("pulso-editor"))
        .ok_or_else(|| {
            "No se encontró el ejecutable `pulso` en el PATH para abrir Pulso Editor.".to_string()
        })?;

    providers::background_command(&bin)
        .arg(&target)
        .spawn()
        .map_err(|e| format!("No se pudo abrir Pulso Editor: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn get_plan_usage(provider_id: String) -> Result<Vec<providers::QuotaGroup>, String> {
    tauri::async_runtime::spawn_blocking(move || providers::usage::plan_usage(&provider_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_desktop_update(
    app: tauri::AppHandle,
) -> Result<Option<updates::DesktopUpdateInfo>, String> {
    updates::check(&app).await
}

#[tauri::command]
async fn install_desktop_update(app: tauri::AppHandle) -> Result<(), String> {
    updates::install(&app).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("No se pudo resolver app_data_dir: {e}"))?;
            let trusted_path = app_data_dir.join("trusted-folders.json");
            let trusted_store = TrustedFoldersStore::load(trusted_path)
                .unwrap_or_else(|_| TrustedFoldersStore::in_memory());

            app.manage(AppState {
                active_workspace: Mutex::new(None),
                trusted_folders: Mutex::new(trusted_store),
                active_runs: Arc::new(ActiveRuns::default()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_workspace_status,
            set_active_workspace,
            trust_workspace,
            list_trusted_workspaces,
            list_providers,
            has_provider_secret,
            save_provider_secret,
            delete_provider_secret,
            send_chat_message,
            cancel_chat_run,
            save_chat_image,
            load_app_state,
            save_app_state,
            read_chat_image_data_url,
            list_workspace_files,
            inspect_project_skills,
            open_in_pulso_editor,
            get_plan_usage,
            check_desktop_update,
            install_desktop_update,
        ])
        .run(tauri::generate_context!())
        .expect("Error al iniciar Pulso Desktop");
}

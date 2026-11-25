//! Actualizaciones automáticas: lee `latest.json` de las releases de GitHub de este repositorio (ver `plugins.updater` en
//! tauri.conf.json), **comprueba la firma** del instalador con la clave pública que lleva la aplicación y, si la persona acepta, lo
//! instala y reinicia. Un instalador sin firma válida se rechaza antes de ejecutarlo. Solo en la versión instalada: las compilaciones
//! de desarrollo no se actualizan. Ver docs/DISTRIBUCION.md.
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: String,
}

/// Cuántos caracteres de las notas de la versión se enseñan en el aviso.
const MAX_NOTES: usize = 1200;

fn ensure_installed() -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Las actualizaciones solo funcionan en la versión instalada de Pulso Desktop.".into());
    }
    Ok(())
}

fn clip_notes(notes: Option<&str>) -> String {
    notes.unwrap_or("").trim().chars().take(MAX_NOTES).collect()
}

async fn find(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let updater = app.updater().map_err(|e| format!("No se pudo preparar el actualizador: {e}"))?;
    updater.check().await.map_err(|e| format!("No se pudo comprobar si hay una versión nueva: {e}"))
}

pub async fn check(app: &AppHandle) -> Result<Option<DesktopUpdateInfo>, String> {
    ensure_installed()?;
    Ok(find(app).await?.map(|u| DesktopUpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: clip_notes(u.body.as_deref()),
    }))
}

/// Descarga, **verifica la firma**, instala y reinicia. En Windows el instalador cierra la aplicación por su cuenta, así que antes se
/// detienen las respuestas de IA en marcha (sus procesos quedarían sueltos).
pub async fn install(app: &AppHandle) -> Result<(), String> {
    ensure_installed()?;
    let update = find(app).await?.ok_or_else(|| "Ya no hay ninguna versión nueva pendiente.".to_string())?;
    // `download` comprueba la firma: si no es válida, falla aquí y no se instala nada.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| format!("No se pudo descargar o verificar la actualización: {e}"))?;
    app.state::<crate::AppState>().active_runs.cancel_all();
    update.install(bytes).map_err(|e| format!("No se pudo instalar la actualización: {e}"))?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El actualizador tiene que apuntar a las releases de ESTE repositorio por HTTPS: no a las del Editor, que comparten nombres de
    /// etiqueta y la marca «Latest».
    #[test]
    fn el_actualizador_apunta_a_las_releases_de_pulso_desktop() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let up = &conf["plugins"]["updater"];
        let endpoints: Vec<&str> = up["endpoints"].as_array().unwrap().iter().map(|e| e.as_str().unwrap()).collect();
        assert_eq!(
            endpoints,
            ["https://github.com/santiago123-dex/Pulso-Desktop/releases/latest/download/latest.json"]
        );
        assert!(!up["pubkey"].as_str().unwrap().trim().is_empty(), "falta la clave pública");
        assert_eq!(up["windows"]["installMode"], "passive");
    }

    #[test]
    fn las_notas_se_recortan_y_pueden_faltar() {
        assert_eq!(clip_notes(None), "");
        assert_eq!(clip_notes(Some("  hola \n")), "hola");
        assert_eq!(clip_notes(Some(&"ñ".repeat(MAX_NOTES + 50))).chars().count(), MAX_NOTES);
    }
}

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;

const STATE_FILE: &str = "desktop-state.json";
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

pub fn load_state(app_data_dir: &Path) -> Result<Option<serde_json::Value>, String> {
    let path = app_data_dir.join(STATE_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("No se pudo leer el estado guardado: {e}"))?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Estado guardado con formato inválido: {e}"))?;
    Ok(Some(parsed))
}

pub fn save_state(app_data_dir: &Path, state: &serde_json::Value) -> Result<(), String> {
    fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("No se pudo crear el directorio de datos: {e}"))?;
    let path = app_data_dir.join(STATE_FILE);
    let tmp = app_data_dir.join(format!("{STATE_FILE}.tmp"));
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Error al serializar el estado: {e}"))?;
    fs::write(&tmp, json).map_err(|e| format!("Error al escribir estado temporal: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Error al guardar estado: {e}"))?;
    Ok(())
}

/// Lee una imagen previamente guardada en `app_data_dir()/ai-images/` y devuelve su `data:` URL.
pub fn read_saved_image_data_url(app_data_dir: &Path, requested: &str) -> Result<String, String> {
    let dir = app_data_dir.join("ai-images");
    let dir_canon = fs::canonicalize(&dir)
        .map_err(|_| "No se encontró la carpeta de imágenes.".to_string())?;
    let target = fs::canonicalize(PathBuf::from(requested))
        .map_err(|_| "No se encontró la imagen adjunta.".to_string())?;
    if !target.starts_with(&dir_canon) || !target.is_file() {
        return Err("Acceso denegado a la imagen solicitada.".to_string());
    }

    let mime = match target
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => return Err("Formato de imagen no soportado.".to_string()),
    };

    let meta = fs::metadata(&target).map_err(|e| e.to_string())?;
    if meta.len() as usize > MAX_IMAGE_BYTES {
        return Err("La imagen supera el límite de 10 MB.".to_string());
    }
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn guarda_y_recupera_estado_atomicamente() {
        let dir = tempdir().unwrap();
        assert!(load_state(dir.path()).unwrap().is_none());

        let payload = serde_json::json!({
            "locale": "es",
            "providerId": "antigravity",
            "conversations": [{ "id": "c1", "title": "Prueba" }]
        });
        save_state(dir.path(), &payload).unwrap();

        let loaded = load_state(dir.path()).unwrap().unwrap();
        assert_eq!(loaded["providerId"], "antigravity");
        assert_eq!(loaded["conversations"][0]["title"], "Prueba");
    }
}

use keyring::Entry;
use serde::Serialize;

const DESKTOP_SERVICE: &str = "dev.pulso.desktop";
const EDITOR_SERVICE: &str = "pulso-editor";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecretSource {
    Desktop,
    PulsoEditor,
    Env,
    None,
}

fn validate_key(key: &str) -> Result<&str, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err("Identificador de secreto inválido".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("El identificador de secreto contiene caracteres no permitidos".to_string());
    }
    Ok(trimmed)
}

fn env_vars_for_provider(provider_id: &str) -> &'static [&'static str] {
    match provider_id {
        "openai" => &["OPENAI_API_KEY"],
        "anthropic" | "claude" => &["ANTHROPIC_API_KEY"],
        "antigravity" | "google" => &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        _ => &[],
    }
}

fn read_entry(service: &str, user: &str) -> Option<String> {
    let entry = Entry::new(service, user).ok()?;
    let value = entry.get_password().ok()?;
    let trimmed = value.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// Resuelve la API key de un proveedor en orden de prioridad:
/// 1) Almacén de Pulso Desktop
/// 2) Almacén de Pulso Editor (`pulso-editor` / `provider-key:<id>`)
/// 3) Variables de entorno estándar
/// Nunca devuelve el valor al frontend; solo se usa internamente en Rust.
pub fn resolve_provider_key(provider_id: &str) -> Option<(String, SecretSource)> {
    let valid = validate_key(provider_id).ok()?;

    if let Some(val) = read_entry(DESKTOP_SERVICE, &format!("provider-key:{valid}"))
        .or_else(|| read_entry(DESKTOP_SERVICE, valid))
    {
        return Some((val, SecretSource::Desktop));
    }

    let editor_ids: Vec<&str> = match valid {
        "claude" => vec!["anthropic", "claude"],
        "antigravity" => vec!["google", "antigravity"],
        other => vec![other],
    };
    for eid in editor_ids {
        if let Some(val) = read_entry(EDITOR_SERVICE, &format!("provider-key:{eid}")) {
            return Some((val, SecretSource::PulsoEditor));
        }
    }

    for env_name in env_vars_for_provider(valid) {
        if let Ok(val) = std::env::var(env_name) {
            let trimmed = val.trim().to_string();
            if !trimmed.is_empty() {
                return Some((trimmed, SecretSource::Env));
            }
        }
    }

    None
}

pub fn secret_source(provider_id: &str) -> SecretSource {
    resolve_provider_key(provider_id)
        .map(|(_, src)| src)
        .unwrap_or(SecretSource::None)
}

pub fn save_secret(key: &str, value: &str) -> Result<(), String> {
    let valid_key = validate_key(key)?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("La clave API no puede estar vacía".to_string());
    }
    let entry = Entry::new(DESKTOP_SERVICE, &format!("provider-key:{valid_key}"))
        .map_err(|e| format!("No se pudo inicializar el almacén seguro: {e}"))?;
    entry
        .set_password(trimmed)
        .map_err(|e| format!("No se pudo guardar el secreto en el sistema: {e}"))
}

pub fn has_secret(key: &str) -> Result<bool, String> {
    let valid_key = validate_key(key)?;
    Ok(resolve_provider_key(valid_key).is_some())
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    let valid_key = validate_key(key)?;
    for user in [format!("provider-key:{valid_key}"), valid_key.to_string()] {
        let entry = Entry::new(DESKTOP_SERVICE, &user)
            .map_err(|e| format!("No se pudo inicializar el almacén seguro: {e}"))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(format!("No se pudo eliminar el secreto: {e}")),
        }
    }
    Ok(())
}

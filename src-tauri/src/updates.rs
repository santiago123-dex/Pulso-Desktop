use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;

use crate::providers::background_command;

const RELEASES_API: &str =
    "https://api.github.com/repos/santiago123-dex/Pulso-Editor-releases/releases?per_page=15";
const ALLOWED_DOWNLOAD_PREFIX: &str =
    "https://github.com/santiago123-dex/Pulso-Editor-releases/releases/download/";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: String,
    pub release_url: String,
    pub download_url: String,
    pub asset_name: String,
}

pub fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let cleaned = raw
        .trim()
        .trim_start_matches("desktop-")
        .trim_start_matches('v')
        .trim_start_matches('V');
    let core = cleaned.split('-').next().unwrap_or(cleaned);
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

pub fn is_newer_version(candidate: &str, current: &str) -> bool {
    match (parse_semver(candidate), parse_semver(current)) {
        (Some(cand), Some(curr)) => cand > curr,
        _ => false,
    }
}

fn is_desktop_installer(name: &str) -> bool {
    let low = name.to_ascii_lowercase();
    (low.contains("pulso.desktop") || low.contains("pulso desktop") || low.contains("pulso-desktop"))
        && low.ends_with(".exe")
}

pub async fn check_for_desktop_update() -> Result<Option<DesktopUpdateInfo>, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(format!("Pulso-Desktop/{current}"))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("No se pudo consultar actualizaciones en GitHub: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub respondió {} al buscar actualizaciones.",
            resp.status()
        ));
    }

    let releases: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    let mut best: Option<((u64, u64, u64), DesktopUpdateInfo)> = None;

    for rel in releases {
        if rel.get("draft").and_then(|x| x.as_bool()) == Some(true) {
            continue;
        }
        let tag = rel
            .get("tag_name")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let Some(ver_tuple) = parse_semver(tag) else {
            continue;
        };
        if !is_newer_version(tag, &current) {
            continue;
        }

        let Some(assets) = rel.get("assets").and_then(|a| a.as_array()) else {
            continue;
        };
        let desktop_asset = assets.iter().find(|a| {
            a.get("name")
                .and_then(|n| n.as_str())
                .is_some_and(is_desktop_installer)
        });
        let Some(asset) = desktop_asset else {
            continue;
        };

        let asset_name = asset
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("Pulso.Desktop-setup.exe")
            .to_string();
        let download_url = asset
            .get("browser_download_url")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        if !download_url.starts_with(ALLOWED_DOWNLOAD_PREFIX) {
            continue;
        }

        let release_url = rel
            .get("html_url")
            .and_then(|x| x.as_str())
            .unwrap_or("https://github.com/santiago123-dex/Pulso-Editor-releases/releases")
            .to_string();
        let notes = rel
            .get("body")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .chars()
            .take(1200)
            .collect();

        let clean_ver = format!("{}.{}.{}", ver_tuple.0, ver_tuple.1, ver_tuple.2);
        let info = DesktopUpdateInfo {
            version: clean_ver,
            current: current.clone(),
            notes,
            release_url,
            download_url,
            asset_name,
        };

        if best.as_ref().is_none_or(|(b_ver, _)| ver_tuple > *b_ver) {
            best = Some((ver_tuple, info));
        }
    }

    Ok(best.map(|(_, info)| info))
}

pub async fn download_and_launch_installer(
    download_url: String,
    asset_name: String,
) -> Result<String, String> {
    if !download_url.starts_with(ALLOWED_DOWNLOAD_PREFIX) {
        return Err("URL de descarga no permitida.".to_string());
    }

    let safe_name: String = asset_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    let file_name = if safe_name.to_ascii_lowercase().ends_with(".exe") {
        safe_name
    } else {
        "Pulso.Desktop-update-setup.exe".to_string()
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .user_agent(format!("Pulso-Desktop/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar el instalador: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Error al descargar el instalador (HTTP {}).",
            resp.status()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Error leyendo la descarga: {e}"))?;
    if bytes.is_empty() {
        return Err("El archivo descargado está vacío.".to_string());
    }

    let dest: PathBuf = std::env::temp_dir().join(&file_name);
    std::fs::write(&dest, &bytes)
        .map_err(|e| format!("No se pudo guardar el instalador en temporales: {e}"))?;

    background_command(dest.to_string_lossy().as_ref())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar el instalador: {e}"))?;

    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compara_versiones_desktop_y_v() {
        assert!(is_newer_version("v0.3.1", "0.3.0"));
        assert!(is_newer_version("desktop-v0.4.0", "0.3.0"));
        assert!(!is_newer_version("v0.3.0", "0.3.0"));
        assert!(!is_newer_version("v0.2.0", "0.3.0"));
    }

    #[test]
    fn detecta_nombre_de_instalador_desktop() {
        assert!(is_desktop_installer("Pulso.Desktop_0.3.1_x64-setup.exe"));
        assert!(is_desktop_installer("Pulso Desktop_0.4.0_x64-setup.exe"));
        assert!(!is_desktop_installer("Pulso.Editor_0.3.1_x64-setup.exe"));
    }
}

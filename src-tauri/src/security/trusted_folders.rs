use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrustedFolderEntry {
    pub path: String,
    pub trusted_at_epoch_secs: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct TrustedFoldersFile {
    folders: Vec<TrustedFolderEntry>,
}

/// Administra `trusted-folders.json` para exigir confianza explícita por proyecto.
#[derive(Debug)]
pub struct TrustedFoldersStore {
    storage_path: Option<PathBuf>,
    entries: Vec<TrustedFolderEntry>,
}

impl TrustedFoldersStore {
    pub fn in_memory() -> Self {
        Self {
            storage_path: None,
            entries: Vec::new(),
        }
    }

    pub fn load(storage_path: PathBuf) -> Result<Self, String> {
        if !storage_path.exists() {
            return Ok(Self {
                storage_path: Some(storage_path),
                entries: Vec::new(),
            });
        }

        let raw = fs::read_to_string(&storage_path)
            .map_err(|e| format!("No se pudo leer trusted-folders.json: {e}"))?;
        let parsed: TrustedFoldersFile = serde_json::from_str(&raw)
            .map_err(|e| format!("Formato inválido en trusted-folders.json: {e}"))?;

        Ok(Self {
            storage_path: Some(storage_path),
            entries: parsed.folders,
        })
    }

    pub fn is_trusted(&self, folder: &Path) -> bool {
        let Ok(canonical) = fs::canonicalize(folder) else {
            return false;
        };
        let key = canonical.to_string_lossy();
        self.entries.iter().any(|entry| entry.path == key)
    }

    pub fn trust(&mut self, folder: &Path) -> Result<TrustedFolderEntry, String> {
        let canonical = fs::canonicalize(folder)
            .map_err(|e| format!("No se pudo canonizar la carpeta a confiar: {e}"))?;
        if !canonical.is_dir() {
            return Err("Solo se puede confiar en directorios existentes".to_string());
        }

        let key = canonical.to_string_lossy().to_string();
        if let Some(existing) = self.entries.iter().find(|entry| entry.path == key) {
            return Ok(existing.clone());
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let entry = TrustedFolderEntry {
            path: key,
            trusted_at_epoch_secs: now,
        };
        self.entries.push(entry.clone());
        self.persist()?;
        Ok(entry)
    }

    pub fn revoke(&mut self, folder: &Path) -> Result<bool, String> {
        let target = fs::canonicalize(folder)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| folder.to_string_lossy().to_string());

        let before = self.entries.len();
        self.entries.retain(|entry| entry.path != target);
        let removed = self.entries.len() != before;
        if removed {
            self.persist()?;
        }
        Ok(removed)
    }

    pub fn list(&self) -> Vec<TrustedFolderEntry> {
        self.entries.clone()
    }

    fn persist(&self) -> Result<(), String> {
        let Some(path) = &self.storage_path else {
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("No se pudo crear el directorio de datos: {e}"))?;
        }
        let payload = TrustedFoldersFile {
            folders: self.entries.clone(),
        };
        let json = serde_json::to_string_pretty(&payload)
            .map_err(|e| format!("Error al serializar trusted-folders.json: {e}"))?;
        fs::write(path, json)
            .map_err(|e| format!("Error al guardar trusted-folders.json: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn persiste_y_revoca_carpetas_confiables() {
        let data_dir = tempdir().unwrap();
        let project_dir = tempdir().unwrap();
        let store_file = data_dir.path().join("trusted-folders.json");

        let mut store = TrustedFoldersStore::load(store_file.clone()).unwrap();
        assert!(!store.is_trusted(project_dir.path()));

        store.trust(project_dir.path()).unwrap();
        assert!(store.is_trusted(project_dir.path()));

        let reloaded = TrustedFoldersStore::load(store_file.clone()).unwrap();
        assert!(reloaded.is_trusted(project_dir.path()));

        let mut reloaded_mut = TrustedFoldersStore::load(store_file).unwrap();
        assert!(reloaded_mut.revoke(project_dir.path()).unwrap());
        assert!(!reloaded_mut.is_trusted(project_dir.path()));
    }
}

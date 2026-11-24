use std::path::{Component, Path, PathBuf};

/// Garantiza que todas las operaciones de archivos permanezcan dentro de la carpeta raíz aprobada.
#[derive(Debug, Clone)]
pub struct FsGuard {
    root: PathBuf,
}

impl FsGuard {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        let canonical = std::fs::canonicalize(&root)
            .map_err(|e| format!("La carpeta raíz no existe o no es accesible: {e}"))?;
        if !canonical.is_dir() {
            return Err("La ruta seleccionada no es un directorio válido".to_string());
        }
        Ok(Self { root: canonical })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resuelve una ruta relativa o absoluta verificando que nunca salga de `self.root`.
    pub fn resolve(&self, requested: &Path) -> Result<PathBuf, String> {
        let candidate = if requested.is_absolute() {
            requested.to_path_buf()
        } else {
            self.root.join(requested)
        };

        // Si el destino ya existe, canonizamos directamente (resuelve symlinks reales).
        if candidate.exists() {
            let canonical = std::fs::canonicalize(&candidate)
                .map_err(|e| format!("No se pudo resolver la ruta solicitada: {e}"))?;
            return self.ensure_within_root(canonical);
        }

        // Si el destino aún no existe (p. ej. archivo nuevo), validamos el ancestro existente
        // y normalizamos los segmentos restantes rechazando escapes con `..`.
        let mut existing = candidate.clone();
        let mut tail: Vec<std::ffi::OsString> = Vec::new();
        while !existing.exists() {
            let name = existing
                .file_name()
                .ok_or_else(|| "La ruta solicitada no es válida".to_string())?
                .to_os_string();
            tail.push(name);
            if !existing.pop() {
                return Err("No se encontró un directorio padre válido dentro del proyecto".to_string());
            }
        }

        let canonical_parent = std::fs::canonicalize(&existing)
            .map_err(|e| format!("No se pudo resolver el directorio padre: {e}"))?;
        let mut resolved = self.ensure_within_root(canonical_parent)?;

        for segment in tail.into_iter().rev() {
            let seg_path = Path::new(&segment);
            for comp in seg_path.components() {
                match comp {
                    Component::Normal(part) => resolved.push(part),
                    _ => return Err("Ruta bloqueada por contener segmentos no permitidos".to_string()),
                }
            }
        }

        self.ensure_within_root(resolved)
    }

    fn ensure_within_root(&self, target: PathBuf) -> Result<PathBuf, String> {
        if target.starts_with(&self.root) {
            Ok(target)
        } else {
            Err("Acceso denegado: la ruta está fuera de la carpeta aprobada".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn permite_archivos_dentro_de_la_raiz() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("notas.md");
        fs::write(&file, "hola").unwrap();

        let guard = FsGuard::new(dir.path().to_path_buf()).unwrap();
        let resolved = guard.resolve(Path::new("notas.md")).unwrap();
        assert_eq!(resolved, fs::canonicalize(file).unwrap());
    }

    #[test]
    fn permite_archivo_nuevo_dentro_de_subdirectorio() {
        let dir = tempdir().unwrap();
        let guard = FsGuard::new(dir.path().to_path_buf()).unwrap();

        let resolved = guard.resolve(Path::new("docs/nuevo.md")).unwrap();
        assert!(resolved.starts_with(guard.root()));
        assert!(resolved.ends_with(Path::new("docs").join("nuevo.md")));
    }

    #[test]
    fn bloquea_path_traversal_con_punto_punto() {
        let parent = tempdir().unwrap();
        let workspace = parent.path().join("proyecto");
        let outside = parent.path().join("secreto.txt");
        fs::create_dir(&workspace).unwrap();
        fs::write(&outside, "privado").unwrap();

        let guard = FsGuard::new(workspace).unwrap();
        let err = guard.resolve(Path::new("../secreto.txt")).unwrap_err();
        assert!(err.contains("fuera de la carpeta aprobada"));
    }

    #[test]
    fn bloquea_ruta_absoluta_fuera_de_la_raiz() {
        let ws_dir = tempdir().unwrap();
        let other_dir = tempdir().unwrap();
        let outside = other_dir.path().join("externo.txt");
        fs::write(&outside, "externo").unwrap();

        let guard = FsGuard::new(ws_dir.path().to_path_buf()).unwrap();
        let err = guard.resolve(&outside).unwrap_err();
        assert!(err.contains("fuera de la carpeta aprobada"));
    }
}

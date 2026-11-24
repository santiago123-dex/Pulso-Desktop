use std::fs;
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    pub kind: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSkillsReport {
    pub trusted: bool,
    pub entries: Vec<SkillEntry>,
}

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".vite",
    "__pycache__",
];

/// Lista rutas relativas dentro de la carpeta aprobada para menciones `@archivo`.
pub fn list_files_under(root: &Path, query: &str, limit: usize) -> Vec<String> {
    let mut results = Vec::new();
    let q = query.trim().to_ascii_lowercase();
    walk_dir(root, root, &q, limit, 0, &mut results);
    results
}

fn walk_dir(
    root: &Path,
    dir: &Path,
    query: &str,
    limit: usize,
    depth: usize,
    out: &mut Vec<String>,
) {
    if depth > 6 || out.len() >= limit {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut items: Vec<_> = entries.flatten().collect();
    items.sort_by_key(|e| e.file_name());

    for entry in items {
        if out.len() >= limit {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if IGNORED_DIRS.iter().any(|d| d.eq_ignore_ascii_case(&name)) {
                continue;
            }
            walk_dir(root, &path, query, limit, depth + 1, out);
        } else if path.is_file() {
            if let Ok(rel) = path.strip_prefix(root) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                if query.is_empty() || rel_str.to_ascii_lowercase().contains(query) {
                    out.push(rel_str);
                }
            }
        }
    }
}

/// Detecta `AGENTS.md` y skills del proyecto únicamente si la carpeta es confiable.
pub fn inspect_skills(root: &Path, trusted: bool) -> ProjectSkillsReport {
    if !trusted {
        return ProjectSkillsReport {
            trusted: false,
            entries: Vec::new(),
        };
    }

    let mut entries = Vec::new();
    let agents_md = root.join("AGENTS.md");
    if agents_md.is_file() {
        entries.push(SkillEntry {
            kind: "instruction".to_string(),
            name: "AGENTS.md".to_string(),
            path: "AGENTS.md".to_string(),
        });
    }

    for base in [".agents/skills", ".pulso/skills", ".claude/skills"] {
        let dir = root.join(base);
        if let Ok(read) = fs::read_dir(&dir) {
            for item in read.flatten() {
                let p = item.path();
                let skill_file = p.join("SKILL.md");
                if p.is_dir() && skill_file.is_file() {
                    let name = item.file_name().to_string_lossy().to_string();
                    let rel = skill_file
                        .strip_prefix(root)
                        .map(|r| r.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_else(|_| format!("{base}/{name}/SKILL.md"));
                    entries.push(SkillEntry {
                        kind: "skill".to_string(),
                        name,
                        path: rel,
                    });
                }
            }
        }
    }

    ProjectSkillsReport {
        trusted: true,
        entries,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn lista_archivos_ignorando_node_modules() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        fs::write(dir.path().join("src/main.ts"), "").unwrap();
        fs::write(dir.path().join("node_modules/pkg/index.js"), "").unwrap();

        let files = list_files_under(dir.path(), "main", 20);
        assert_eq!(files, vec!["src/main.ts".to_string()]);
    }

    #[test]
    fn oculta_skills_si_carpeta_no_es_confiable() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("AGENTS.md"), "# reglas").unwrap();

        let untrusted = inspect_skills(dir.path(), false);
        assert!(!untrusted.trusted);
        assert!(untrusted.entries.is_empty());

        let trusted = inspect_skills(dir.path(), true);
        assert!(trusted.trusted);
        assert_eq!(trusted.entries.len(), 1);
        assert_eq!(trusted.entries[0].name, "AGENTS.md");
    }
}

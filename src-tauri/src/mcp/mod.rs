use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "transport", rename_all = "snake_case")]
pub enum McpTransport {
    Stdio {
        command: String,
        args: Vec<String>,
        env: BTreeMap<String, String>,
    },
    Http {
        url: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub transport: McpTransport,
}

/// Filtra variables de entorno antes de lanzar un proceso MCP `stdio`
/// para no filtrar secretos o tokens no declarados explícitamente.
pub fn build_sanitized_env(
    explicit_env: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    for key in ["PATH", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"] {
        if let Ok(val) = std::env::var(key) {
            env.insert(key.to_string(), val);
        }
    }
    for (k, v) in explicit_env {
        env.insert(k.clone(), v.clone());
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entorno_saneado_conserva_variables_explicitas() {
        let mut explicit = BTreeMap::new();
        explicit.insert("MCP_TOKEN".to_string(), "valor-de-prueba".to_string());

        let result = build_sanitized_env(&explicit);
        assert_eq!(
            result.get("MCP_TOKEN").map(String::as_str),
            Some("valor-de-prueba")
        );
    }
}

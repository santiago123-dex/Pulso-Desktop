use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::security::secrets::{secret_source, SecretSource};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderAuthMode {
    Account,
    ApiKey,
    Local,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub auth_modes: Vec<ProviderAuthMode>,
    pub local: bool,
    pub connected: bool,
    pub account_connected: bool,
    pub plan: String,
    pub key_source: SecretSource,
    pub models: Vec<ModelInfo>,
}

pub fn background_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn resolve_cli_binary(name: &str) -> Option<String> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(p) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&p));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        dirs.push(local.join("agy").join("bin"));
        dirs.push(local.join("Programs").join("OpenAI").join("Codex").join("bin"));
        dirs.push(local.join("Microsoft").join("WindowsApps"));
        dirs.push(local.join("pnpm"));
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = PathBuf::from(home);
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".bun").join("bin"));
    }

    let exts: &[&str] = if cfg!(windows) {
        &[".exe", ".cmd", ".bat", ""]
    } else {
        &[""]
    };

    for dir in dirs {
        for ext in exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn capture_output(program: &str, args: &[&str], timeout_secs: u64) -> Option<(bool, String)> {
    let mut child = background_command(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let mut out = child.stdout.take()?;
    let mut err = child.stderr.take()?;
    let t_out = thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        s
    });
    let t_err = thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let status = loop {
        match child.try_wait().ok()? {
            Some(st) => break st,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => thread::sleep(Duration::from_millis(25)),
        }
    };
    let stdout = t_out.join().unwrap_or_default();
    let stderr = t_err.join().unwrap_or_default();
    let combined = if stdout.trim().is_empty() {
        stderr
    } else {
        stdout
    };
    Some((status.success(), combined))
}

pub fn parse_agy_models(text: &str) -> Vec<ModelInfo> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || !line.contains('\t') {
            continue;
        }
        let Some((id, label)) = line.split_once('\t') else {
            continue;
        };
        let id = id.trim();
        let label = label.trim();
        if id.is_empty()
            || !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        {
            continue;
        }
        if !out.iter().any(|m: &ModelInfo| m.id == id) {
            out.push(ModelInfo {
                id: id.to_string(),
                label: if label.is_empty() {
                    id.to_string()
                } else {
                    label.to_string()
                },
            });
        }
    }
    out
}

fn detect_antigravity() -> ProviderInfo {
    let key_source = secret_source("antigravity");
    let mut account_connected = false;
    let mut plan = String::new();
    let mut models = Vec::new();

    if let Some(bin) = resolve_cli_binary("agy") {
        if let Some((_, text)) = capture_output(&bin, &["models"], 10) {
            let parsed = parse_agy_models(&text);
            if !parsed.is_empty() {
                account_connected = true;
                plan = "Antigravity".to_string();
                models = parsed;
            }
        }
    }

    if models.is_empty() {
        models.push(ModelInfo {
            id: "default".to_string(),
            label: "Predeterminado".to_string(),
        });
    }

    ProviderInfo {
        id: "antigravity".to_string(),
        name: "Antigravity".to_string(),
        auth_modes: vec![ProviderAuthMode::Account, ProviderAuthMode::ApiKey],
        local: false,
        connected: account_connected || key_source != SecretSource::None,
        account_connected,
        plan,
        key_source,
        models,
    }
}

fn detect_openai() -> ProviderInfo {
    let key_source = secret_source("openai");
    let mut account_connected = false;
    let mut plan = String::new();

    if let Some(bin) = resolve_cli_binary("codex") {
        if let Some((ok, text)) = capture_output(&bin, &["login", "status"], 6) {
            let low = text.to_lowercase();
            if ok && !low.contains("not logged in") {
                account_connected = true;
                plan = if low.contains("chatgpt") {
                    "ChatGPT".to_string()
                } else {
                    "OpenAI".to_string()
                };
            }
        }
    }

    ProviderInfo {
        id: "openai".to_string(),
        name: "OpenAI".to_string(),
        auth_modes: vec![ProviderAuthMode::Account, ProviderAuthMode::ApiKey],
        local: false,
        connected: account_connected || key_source != SecretSource::None,
        account_connected,
        plan,
        key_source,
        models: vec![
            ModelInfo {
                id: "gpt-4.1".to_string(),
                label: "GPT-4.1".to_string(),
            },
            ModelInfo {
                id: "gpt-4o-mini".to_string(),
                label: "GPT-4o mini".to_string(),
            },
            ModelInfo {
                id: "o4-mini".to_string(),
                label: "o4-mini".to_string(),
            },
        ],
    }
}

fn detect_anthropic() -> ProviderInfo {
    let key_source = secret_source("anthropic");
    let mut account_connected = false;
    let mut plan = String::new();

    if let Some(bin) = resolve_cli_binary("claude") {
        if let Some((ok, text)) = capture_output(&bin, &["auth", "status"], 6) {
            if ok {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(text.trim()) {
                    if v.get("loggedIn").and_then(|x| x.as_bool()) == Some(true) {
                        account_connected = true;
                        let sub = v
                            .get("subscriptionType")
                            .and_then(|x| x.as_str())
                            .unwrap_or("Claude");
                        plan = if sub.is_empty() {
                            "Claude".to_string()
                        } else {
                            format!("Claude {sub}")
                        };
                    }
                }
            }
        }
    }

    ProviderInfo {
        id: "anthropic".to_string(),
        name: "Anthropic".to_string(),
        auth_modes: vec![ProviderAuthMode::Account, ProviderAuthMode::ApiKey],
        local: false,
        connected: account_connected || key_source != SecretSource::None,
        account_connected,
        plan,
        key_source,
        models: vec![
            ModelInfo {
                id: "sonnet".to_string(),
                label: "Claude Sonnet".to_string(),
            },
            ModelInfo {
                id: "opus".to_string(),
                label: "Claude Opus".to_string(),
            },
            ModelInfo {
                id: "haiku".to_string(),
                label: "Claude Haiku".to_string(),
            },
        ],
    }
}

async fn detect_ollama() -> ProviderInfo {
    let mut models = Vec::new();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build();

    if let Ok(client) = client {
        if let Ok(resp) = client.get("http://127.0.0.1:11434/api/tags").send().await {
            if let Ok(v) = resp.json::<serde_json::Value>().await {
                if let Some(arr) = v.get("models").and_then(|m| m.as_array()) {
                    for item in arr {
                        if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                            models.push(ModelInfo {
                                id: name.to_string(),
                                label: name.to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    let connected = !models.is_empty();
    ProviderInfo {
        id: "ollama".to_string(),
        name: "Ollama".to_string(),
        auth_modes: vec![ProviderAuthMode::Local],
        local: true,
        connected,
        account_connected: false,
        plan: if connected {
            "Local".to_string()
        } else {
            String::new()
        },
        key_source: SecretSource::None,
        models,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaBucket {
    pub name: String,
    pub window: String,
    pub remaining_percent: u8,
    pub reset_time: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaGroup {
    pub name: String,
    pub buckets: Vec<QuotaBucket>,
}

pub fn parse_agy_usage_json(text: &str) -> Vec<QuotaGroup> {
    let parsed = serde_json::from_str::<serde_json::Value>(text.trim()).ok().or_else(|| {
        text.lines()
            .rev()
            .find_map(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok())
    });
    let Some(v) = parsed else {
        return Vec::new();
    };
    let Some(arr) = v
        .pointer("/command/data/groups")
        .or_else(|| v.pointer("/result/command/data/groups"))
        .and_then(|g| g.as_array())
    else {
        return Vec::new();
    };

    let mut groups = Vec::new();
    for g in arr {
        let name = g
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let mut buckets = Vec::new();
        if let Some(bs) = g.get("buckets").and_then(|x| x.as_array()) {
            for b in bs {
                let bname = b
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let window = b
                    .get("window")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let rem = b
                    .get("remaining_fraction")
                    .and_then(|x| x.as_f64())
                    .unwrap_or(1.0)
                    .clamp(0.0, 1.0);
                let reset_time = b
                    .get("reset_time")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                buckets.push(QuotaBucket {
                    name: bname,
                    window,
                    remaining_percent: (rem * 100.0).round() as u8,
                    reset_time,
                });
            }
        }
        groups.push(QuotaGroup { name, buckets });
    }
    groups
}

pub async fn fetch_antigravity_quota() -> Vec<QuotaGroup> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(bin) = resolve_cli_binary("agy") else {
            return Vec::new();
        };
        let Some((_, out)) = capture_output(
            &bin,
            &["-p", "/usage", "--output-format", "json", "--mode", "plan"],
            18,
        ) else {
            return Vec::new();
        };
        parse_agy_usage_json(&out)
    })
    .await
    .unwrap_or_default()
}

pub async fn detect_all_providers() -> Vec<ProviderInfo> {
    let cli_handle = tauri::async_runtime::spawn_blocking(|| {
        let agy = thread::spawn(detect_antigravity);
        let oai = thread::spawn(detect_openai);
        let ant = thread::spawn(detect_anthropic);
        (
            agy.join().unwrap_or_else(|_| default_providers()[0].clone()),
            oai.join().unwrap_or_else(|_| default_providers()[1].clone()),
            ant.join().unwrap_or_else(|_| default_providers()[2].clone()),
        )
    });

    let ollama = detect_ollama().await;
    let (agy, oai, ant) = cli_handle.await.unwrap_or_else(|_| {
        let d = default_providers();
        (d[0].clone(), d[1].clone(), d[2].clone())
    });

    vec![agy, oai, ant, ollama]
}

pub fn default_providers() -> Vec<ProviderInfo> {
    vec![
        ProviderInfo {
            id: "antigravity".to_string(),
            name: "Antigravity".to_string(),
            auth_modes: vec![ProviderAuthMode::Account, ProviderAuthMode::ApiKey],
            local: false,
            connected: false,
            account_connected: false,
            plan: String::new(),
            key_source: SecretSource::None,
            models: vec![ModelInfo {
                id: "default".to_string(),
                label: "Predeterminado".to_string(),
            }],
        },
        ProviderInfo {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            auth_modes: vec![ProviderAuthMode::Account, ProviderAuthMode::ApiKey],
            local: false,
            connected: false,
            account_connected: false,
            plan: String::new(),
            key_source: SecretSource::None,
            models: vec![ModelInfo {
                id: "gpt-4.1".to_string(),
                label: "GPT-4.1".to_string(),
            }],
        },
        ProviderInfo {
            id: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            auth_modes: vec![ProviderAuthMode::Account, ProviderAuthMode::ApiKey],
            local: false,
            connected: false,
            account_connected: false,
            plan: String::new(),
            key_source: SecretSource::None,
            models: vec![ModelInfo {
                id: "sonnet".to_string(),
                label: "Claude Sonnet".to_string(),
            }],
        },
        ProviderInfo {
            id: "ollama".to_string(),
            name: "Ollama".to_string(),
            auth_modes: vec![ProviderAuthMode::Local],
            local: true,
            connected: false,
            account_connected: false,
            plan: String::new(),
            key_source: SecretSource::None,
            models: vec![],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsea_modelos_de_antigravity() {
        let sample = "gemini-4-neon\tGemini 4 Neon (Medium)\nclaude-sonnet\tClaude Sonnet\n";
        let models = parse_agy_models(sample);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gemini-4-neon");
        assert_eq!(models[0].label, "Gemini 4 Neon (Medium)");
    }
}

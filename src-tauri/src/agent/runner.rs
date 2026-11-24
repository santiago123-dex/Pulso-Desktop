use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::providers::{background_command, resolve_cli_binary};
use crate::security::secrets::resolve_provider_key;

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
static IMG_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    pub path: String,
    pub name: String,
    pub mime: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedImageInput {
    pub path: String,
    pub name: String,
    pub mime: String,
    pub data_base64: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryItem {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    pub run_id: String,
    pub provider_id: String,
    pub model_id: Option<String>,
    pub mode: String,
    pub prompt: String,
    pub history: Vec<ChatHistoryItem>,
    pub session_id: Option<String>,
    #[serde(default)]
    pub images: Vec<AttachedImageInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatStreamEvent {
    Started {
        run_id: String,
    },
    Thinking {
        text: String,
        replace: bool,
    },
    Tool {
        id: String,
        name: String,
        detail: String,
        state: String,
    },
    Delta {
        text: String,
        replace: bool,
    },
    DiffSummary {
        files_count: usize,
        added: usize,
        removed: usize,
        diff_text: String,
    },
    Done {
        duration_ms: u64,
        session_id: Option<String>,
    },
    Error {
        message: String,
    },
}

#[derive(Default)]
pub struct ActiveRuns {
    pids: Mutex<HashMap<String, u32>>,
}

impl ActiveRuns {
    pub fn register_pid(&self, run_id: &str, pid: u32) {
        if let Ok(mut map) = self.pids.lock() {
            map.insert(run_id.to_string(), pid);
        }
    }

    pub fn remove(&self, run_id: &str) {
        if let Ok(mut map) = self.pids.lock() {
            map.remove(run_id);
        }
    }

    pub fn cancel(&self, run_id: &str) -> bool {
        let pid = self
            .pids
            .lock()
            .ok()
            .and_then(|mut map| map.remove(run_id));
        if let Some(pid) = pid {
            kill_pid(pid);
            true
        } else {
            false
        }
    }
}

pub fn save_chat_image_to_dir(
    app_data_dir: &std::path::Path,
    name: Option<String>,
    mime: String,
    data_base64: String,
) -> Result<SavedImage, String> {
    let ext = match mime.trim().to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => return Err("Formato de imagen no soportado. Usa PNG, JPG, WEBP o GIF.".to_string()),
    };

    let raw_b64 = data_base64
        .split_once(',')
        .map(|(_, b)| b)
        .unwrap_or(&data_base64)
        .trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw_b64)
        .map_err(|_| "No se pudo decodificar la imagen adjunta.".to_string())?;
    if bytes.is_empty() {
        return Err("La imagen está vacía.".to_string());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("La imagen supera el límite de 10 MB.".to_string());
    }

    let dir = app_data_dir.join("ai-images");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("No se pudo crear la carpeta de imágenes: {e}"))?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = IMG_SEQ.fetch_add(1, Ordering::Relaxed);
    let filename = format!("img_{ts}_{seq}.{ext}");
    let full_path = dir.join(&filename);
    std::fs::write(&full_path, &bytes)
        .map_err(|e| format!("No se pudo guardar la imagen adjunta: {e}"))?;

    Ok(SavedImage {
        path: full_path.to_string_lossy().to_string(),
        name: name
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or(filename),
        mime,
    })
}

fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        let _ = background_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = background_command("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
}

fn safe_token(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 80
        && s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ParsedToolEvent {
    pub id: String,
    pub name: String,
    pub detail: String,
    pub state: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ParsedStreamLine {
    pub text: Option<String>,
    pub thinking: Option<String>,
    pub tool: Option<ParsedToolEvent>,
    pub replace: bool,
    pub is_final_result: bool,
    pub session_id: Option<String>,
    pub error: Option<String>,
}

fn first_str<'a>(v: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|k| v.get(*k).and_then(|x| x.as_str()).filter(|s| !s.trim().is_empty()))
}

/// Extrae texto incremental o final de una línea JSON emitida por `agy`, `claude` o `codex`.
pub fn extract_stream_json(line: &str) -> ParsedStreamLine {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
        return ParsedStreamLine::default();
    };

    let mut parsed = ParsedStreamLine::default();
    parsed.session_id = v
        .get("session_id")
        .or_else(|| v.get("conversation_id"))
        .or_else(|| v.get("thread_id"))
        .or_else(|| v.pointer("/step_update/conversation_id"))
        .or_else(|| v.pointer("/result/conversation_id"))
        .and_then(|x| x.as_str())
        .map(str::to_string);

    let ev_type = v
        .get("type")
        .or_else(|| v.get("event"))
        .and_then(|x| x.as_str())
        .unwrap_or("");

    // 1. Antigravity (`agy --output-format stream-json`): `step_update`
    if ev_type == "step_update" {
        let su = v.get("step_update").unwrap_or(&v);
        let step_type = su
            .get("step_type")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        if step_type == "error_message" {
            let msg = su
                .get("text")
                .or_else(|| su.get("text_delta"))
                .or_else(|| su.get("error"))
                .and_then(|x| x.as_str())
                .unwrap_or("Error en Antigravity");
            parsed.error = Some(msg.to_string());
            return parsed;
        }

        if step_type == "thinking" || step_type == "thought" {
            if let Some(delta) = su
                .get("thinking_delta")
                .or_else(|| su.get("text_delta"))
                .and_then(|x| x.as_str())
            {
                if !delta.is_empty() {
                    parsed.thinking = Some(delta.to_string());
                    parsed.replace = false;
                    return parsed;
                }
            }
            if let Some(full) = su.get("text").and_then(|x| x.as_str()) {
                if !full.is_empty() {
                    parsed.thinking = Some(full.to_string());
                    parsed.replace = true;
                    return parsed;
                }
            }
            return parsed;
        }

        if step_type == "agent_response" {
            if let Some(delta) = su.get("text_delta").and_then(|x| x.as_str()) {
                if !delta.is_empty() {
                    parsed.text = Some(delta.to_string());
                    parsed.replace = false;
                    return parsed;
                }
            }
            if let Some(full) = su.get("text").and_then(|x| x.as_str()) {
                if !full.is_empty() {
                    parsed.text = Some(full.to_string());
                    parsed.replace = true;
                    return parsed;
                }
            }
        }

        let ti = su.get("tool_info").unwrap_or(&serde_json::Value::Null);
        let tool_name = first_str(ti, &["name"])
            .or_else(|| first_str(su, &["tool_name", "name"]))
            .unwrap_or("");
        if !tool_name.is_empty() {
            let idx = su
                .get("step_index")
                .and_then(|x| x.as_u64())
                .unwrap_or(0);
            let id = first_str(su, &["tool_id"])
                .map(str::to_string)
                .unwrap_or_else(|| format!("tool_{idx}"));
            let params = ti
                .get("parameters")
                .or_else(|| su.get("parameters"))
                .or_else(|| su.get("input"))
                .unwrap_or(&serde_json::Value::Null);
            let detail = first_str(
                params,
                &[
                    "Path",
                    "TargetFile",
                    "path",
                    "file_path",
                    "CommandLine",
                    "command",
                    "Query",
                    "query",
                    "pattern",
                ],
            )
            .unwrap_or("")
            .chars()
            .take(120)
            .collect();
            let raw_state = su
                .get("state")
                .and_then(|x| x.as_str())
                .unwrap_or("ACTIVE")
                .to_ascii_lowercase();
            let state = match raw_state.as_str() {
                "done" => "done",
                "error" => "error",
                _ => "active",
            }
            .to_string();
            parsed.tool = Some(ParsedToolEvent {
                id,
                name: tool_name.to_string(),
                detail,
                state,
            });
        }
        return parsed;
    }

    // 2. Antigravity / Claude `result`
    if ev_type == "result" {
        parsed.is_final_result = true;
        let res = v.get("result").filter(|r| r.is_object()).unwrap_or(&v);

        if let Some(status) = res.get("status").and_then(|x| x.as_str()) {
            if !status.eq_ignore_ascii_case("SUCCESS") {
                let err = res
                    .get("error")
                    .and_then(|x| x.as_str())
                    .unwrap_or("Antigravity terminó con error.");
                parsed.error = Some(err.to_string());
                return parsed;
            }
        }

        if v.get("is_error").and_then(|x| x.as_bool()) == Some(true) {
            let err = v
                .get("result")
                .and_then(|x| x.as_str())
                .unwrap_or("El proveedor terminó con error.");
            parsed.error = Some(err.to_string());
            return parsed;
        }

        if let Some(resp) = res
            .get("response")
            .and_then(|x| x.as_str())
            .or_else(|| v.get("result").and_then(|x| x.as_str()))
        {
            if !resp.is_empty() {
                parsed.text = Some(resp.to_string());
                parsed.replace = true;
            }
        }
        return parsed;
    }

    // 3. Error genérico
    if ev_type == "error" || v.get("is_error").and_then(|x| x.as_bool()) == Some(true) {
        let msg = v
            .get("error")
            .and_then(|e| e.get("message").or(Some(e)))
            .or_else(|| v.get("message"))
            .and_then(|x| x.as_str())
            .unwrap_or("Error al ejecutar el proveedor");
        parsed.error = Some(msg.to_string());
        return parsed;
    }

    // 4. Claude stream_event -> content_block_delta -> text_delta
    if let Some(delta_text) = v
        .get("event")
        .and_then(|e| e.get("delta"))
        .and_then(|d| d.get("text"))
        .and_then(|t| t.as_str())
    {
        if !delta_text.is_empty() {
            parsed.text = Some(delta_text.to_string());
            return parsed;
        }
    }

    // 5. Delta directa
    if matches!(ev_type, "delta" | "text" | "content_block_delta" | "assistant_delta") {
        if let Some(t) = v
            .get("delta")
            .and_then(|d| d.as_str().or_else(|| d.get("text").and_then(|x| x.as_str())))
            .or_else(|| v.get("text").and_then(|x| x.as_str()))
            .or_else(|| v.get("content").and_then(|x| x.as_str()))
        {
            if !t.is_empty() {
                parsed.text = Some(t.to_string());
                return parsed;
            }
        }
    }

    // 6. Mensaje de asistente completo (Claude)
    if ev_type == "assistant" || ev_type == "message" {
        if let Some(content) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .or_else(|| v.get("content"))
        {
            if let Some(s) = content.as_str() {
                if !s.is_empty() {
                    parsed.text = Some(s.to_string());
                    parsed.replace = true;
                    return parsed;
                }
            }
            if let Some(arr) = content.as_array() {
                let mut combined = String::new();
                for block in arr {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                            combined.push_str(t);
                        }
                    }
                }
                if !combined.is_empty() {
                    parsed.text = Some(combined);
                    parsed.replace = true;
                    return parsed;
                }
            }
        }
    }

    // 7. Codex `item.completed`
    if ev_type == "item.completed" {
        if let Some(t) = v
            .get("item")
            .and_then(|i| i.get("text"))
            .and_then(|x| x.as_str())
        {
            if !t.is_empty() {
                parsed.text = Some(t.to_string());
                return parsed;
            }
        }
    }

    parsed
}

fn prompt_with_image_paths(prompt: &str, images: &[AttachedImageInput]) -> String {
    if images.is_empty() {
        return prompt.to_string();
    }
    let refs: Vec<String> = images
        .iter()
        .filter(|i| !i.path.trim().is_empty())
        .map(|i| format!("- {}", i.path))
        .collect();
    if refs.is_empty() {
        return prompt.to_string();
    }
    format!(
        "{prompt}\n\n[Imágenes adjuntas por el usuario (léelas para responder):]\n{}",
        refs.join("\n")
    )
}

fn stream_cli_process(
    program: &str,
    args: &[String],
    cwd: &PathBuf,
    stdin_payload: Option<&str>,
    run_id: &str,
    runs: Arc<ActiveRuns>,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<Option<String>, String> {
    let mut cmd = background_command(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(if stdin_payload.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se pudo iniciar {program}: {e}"))?;
    runs.register_pid(run_id, child.id());

    if let Some(payload) = stdin_payload {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(payload.as_bytes());
        }
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "No se pudo abrir la salida del proceso".to_string())?;
    let stderr = child.stderr.take();

    let err_handle = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut e) = stderr {
            use std::io::Read;
            let _ = e.read_to_string(&mut buf);
        }
        buf
    });

    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut session_id: Option<String> = None;
    let mut emitted_any = false;
    let mut last_error: Option<String> = None;

    while reader.read_line(&mut line).unwrap_or(0) > 0 {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            let parsed = extract_stream_json(trimmed);
            if parsed.session_id.is_some() {
                session_id = parsed.session_id;
            }
            if let Some(err) = parsed.error {
                last_error = Some(err);
            } else {
                if let Some(thinking) = parsed.thinking {
                    let _ = on_event.send(ChatStreamEvent::Thinking {
                        text: thinking,
                        replace: parsed.replace,
                    });
                }
                if let Some(tool) = parsed.tool {
                    let _ = on_event.send(ChatStreamEvent::Tool {
                        id: tool.id,
                        name: tool.name,
                        detail: tool.detail,
                        state: tool.state,
                    });
                }
                if let Some(text) = parsed.text {
                    if !(parsed.is_final_result && emitted_any) {
                        emitted_any = true;
                        let _ = on_event.send(ChatStreamEvent::Delta {
                            text,
                            replace: parsed.replace,
                        });
                    }
                }
            }
        }
        line.clear();
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    runs.remove(run_id);
    let stderr_text = err_handle.join().unwrap_or_default();

    if let Some(err) = last_error {
        return Err(err);
    }
    if !status.success() && !emitted_any {
        let detail = stderr_text.trim();
        return Err(if detail.is_empty() {
            format!("El proceso terminó con código {:?}", status.code())
        } else {
            detail.chars().take(400).collect()
        });
    }

    Ok(session_id)
}

async fn call_openai_compatible(
    base_url: &str,
    api_key: &str,
    model: &str,
    req: &SendMessageRequest,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let mut messages: Vec<serde_json::Value> = req
        .history
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    if req.images.is_empty() {
        messages.push(serde_json::json!({ "role": "user", "content": req.prompt }));
    } else {
        let mut parts = vec![serde_json::json!({ "type": "text", "text": req.prompt })];
        for img in &req.images {
            if let Some(b64) = &img.data_base64 {
                let data_url = if b64.starts_with("data:") {
                    b64.clone()
                } else {
                    format!("data:{};base64,{b64}", img.mime)
                };
                parts.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": { "url": data_url }
                }));
            }
        }
        messages.push(serde_json::json!({ "role": "user", "content": parts }));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": model,
            "messages": messages,
        }))
        .send()
        .await
        .map_err(|e| format!("Error de red con el proveedor: {e}"))?;

    if !resp.status().is_success() {
        let code = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "El proveedor respondió {code}: {}",
            body.chars().take(280).collect::<String>()
        ));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = json
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if !text.is_empty() {
        let _ = on_event.send(ChatStreamEvent::Delta {
            text,
            replace: false,
        });
    }
    Ok(())
}

async fn call_anthropic_api(
    api_key: &str,
    model: &str,
    req: &SendMessageRequest,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let mapped_model = match model {
        "sonnet" | "" => "claude-sonnet-4-20250514",
        "opus" => "claude-opus-4-20250514",
        "haiku" => "claude-haiku-4-5-20251001",
        other => other,
    };

    let mut messages: Vec<serde_json::Value> = req
        .history
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    if req.images.is_empty() {
        messages.push(serde_json::json!({ "role": "user", "content": req.prompt }));
    } else {
        let mut blocks = Vec::new();
        for img in &req.images {
            if let Some(b64) = &img.data_base64 {
                let raw = b64.split_once(',').map(|(_, b)| b).unwrap_or(b64);
                blocks.push(serde_json::json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": img.mime,
                        "data": raw
                    }
                }));
            }
        }
        blocks.push(serde_json::json!({ "type": "text", "text": req.prompt }));
        messages.push(serde_json::json!({ "role": "user", "content": blocks }));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&serde_json::json!({
            "model": mapped_model,
            "max_tokens": 4096,
            "messages": messages,
        }))
        .send()
        .await
        .map_err(|e| format!("Error de red con Anthropic: {e}"))?;

    if !resp.status().is_success() {
        let code = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Anthropic respondió {code}: {}",
            body.chars().take(280).collect::<String>()
        ));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = json
        .pointer("/content/0/text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if !text.is_empty() {
        let _ = on_event.send(ChatStreamEvent::Delta {
            text,
            replace: false,
        });
    }
    Ok(())
}

async fn call_ollama(
    model: &str,
    req: &SendMessageRequest,
    on_event: &Channel<ChatStreamEvent>,
) -> Result<(), String> {
    if model.trim().is_empty() {
        return Err("No hay modelos instalados en Ollama. Ejecuta `ollama pull <modelo>`.".into());
    }

    let mut messages: Vec<serde_json::Value> = req
        .history
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    let imgs: Vec<String> = req
        .images
        .iter()
        .filter_map(|i| i.data_base64.as_ref())
        .map(|b64| b64.split_once(',').map(|(_, b)| b).unwrap_or(b64).to_string())
        .collect();

    let mut user_msg = serde_json::json!({ "role": "user", "content": req.prompt });
    if !imgs.is_empty() {
        user_msg["images"] = serde_json::json!(imgs);
    }
    messages.push(user_msg);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post("http://127.0.0.1:11434/api/chat")
        .json(&serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": false
        }))
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con Ollama local (127.0.0.1:11434): {e}"))?;

    if !resp.status().is_success() {
        let code = resp.status();
        return Err(format!("Ollama respondió {code}"));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = json
        .pointer("/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if !text.is_empty() {
        let _ = on_event.send(ChatStreamEvent::Delta {
            text,
            replace: false,
        });
    }
    Ok(())
}

pub fn parse_git_numstat(output: &str) -> (usize, usize, usize) {
    let mut files = 0usize;
    let mut added = 0usize;
    let mut removed = 0usize;
    for line in output.lines() {
        let mut parts = line.split('\t');
        let Some(a) = parts.next() else { continue };
        let Some(r) = parts.next() else { continue };
        if parts.next().is_none() {
            continue;
        }
        files += 1;
        added += a.trim().parse::<usize>().unwrap_or(0);
        removed += r.trim().parse::<usize>().unwrap_or(0);
    }
    (files, added, removed)
}

fn collect_git_diff(cwd: &PathBuf) -> Option<(usize, usize, usize, String)> {
    let numstat = background_command("git")
        .args(["diff", "--numstat"])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !numstat.status.success() {
        return None;
    }
    let (files, added, removed) = parse_git_numstat(&String::from_utf8_lossy(&numstat.stdout));
    if files == 0 {
        return None;
    }
    let diff = background_command("git")
        .args(["diff"])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let raw = String::from_utf8_lossy(&diff.stdout);
    let capped: String = raw.chars().take(64 * 1024).collect();
    Some((files, added, removed, capped))
}

pub async fn run_chat(
    req: SendMessageRequest,
    cwd: PathBuf,
    runs: Arc<ActiveRuns>,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let diff_cwd = cwd.clone();
    let started = Instant::now();
    let _ = on_event.send(ChatStreamEvent::Started {
        run_id: req.run_id.clone(),
    });

    let model = req.model_id.as_deref().unwrap_or("").trim().to_string();

    let result: Result<Option<String>, String> = match req.provider_id.as_str() {
        "antigravity" => {
            if let Some(bin) = resolve_cli_binary("agy") {
                let mut args = vec!["--output-format".to_string(), "stream-json".to_string()];
                if req.mode == "plan" {
                    args.extend(["--mode".into(), "plan".into()]);
                } else {
                    args.extend(["--mode".into(), "accept-edits".into()]);
                }
                if !model.is_empty() && model != "default" && safe_token(&model) {
                    args.extend(["--model".into(), model.clone()]);
                }
                if let Some(sid) = &req.session_id {
                    if safe_token(sid) {
                        args.extend(["--conversation".into(), sid.clone()]);
                    }
                }
                let final_prompt = prompt_with_image_paths(&req.prompt, &req.images);
                args.extend(["-p".into(), final_prompt]);

                let run_id = req.run_id.clone();
                let on_ev = on_event.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    stream_cli_process(&bin, &args, &cwd, None, &run_id, runs, &on_ev)
                })
                .await
                .map_err(|e| e.to_string())?
            } else if let Some((key, _)) = resolve_provider_key("antigravity") {
                let chosen = if model.is_empty() || model == "default" {
                    "gemini-2.5-flash"
                } else {
                    &model
                };
                call_openai_compatible(
                    "https://generativelanguage.googleapis.com/v1beta/openai",
                    &key,
                    chosen,
                    &req,
                    &on_event,
                )
                .await
                .map(|_| None)
            } else {
                Err("Antigravity no está conectado. Inicia sesión en Antigravity o agrega una API key en Ajustes.".into())
            }
        }
        "openai" => {
            if let Some((key, _)) = resolve_provider_key("openai") {
                let chosen = if model.is_empty() { "gpt-4.1" } else { &model };
                call_openai_compatible(
                    "https://api.openai.com/v1",
                    &key,
                    chosen,
                    &req,
                    &on_event,
                )
                .await
                .map(|_| None)
            } else if let Some(bin) = resolve_cli_binary("codex") {
                let sandbox = if req.mode == "plan" {
                    "read-only"
                } else {
                    "workspace-write"
                };
                let mut args = vec![
                    "exec".into(),
                    "--json".into(),
                    "--sandbox".into(),
                    sandbox.into(),
                    "--skip-git-repo-check".into(),
                ];
                if !model.is_empty() && safe_token(&model) {
                    args.extend(["--model".into(), model.clone()]);
                }
                for img in &req.images {
                    if !img.path.trim().is_empty() {
                        args.extend(["--image".into(), img.path.clone()]);
                    }
                }
                args.push("-".into());
                let prompt = req.prompt.clone();
                let run_id = req.run_id.clone();
                let on_ev = on_event.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    stream_cli_process(&bin, &args, &cwd, Some(&prompt), &run_id, runs, &on_ev)
                })
                .await
                .map_err(|e| e.to_string())?
            } else {
                Err("OpenAI no está configurado. Conecta tu cuenta o guarda una API key en Ajustes (o en Pulso Editor).".into())
            }
        }
        "anthropic" => {
            if let Some((key, _)) = resolve_provider_key("anthropic") {
                call_anthropic_api(&key, &model, &req, &on_event)
                    .await
                    .map(|_| None)
            } else if let Some(bin) = resolve_cli_binary("claude") {
                let mut args = vec![
                    "-p".into(),
                    "--output-format".into(),
                    "stream-json".into(),
                    "--verbose".into(),
                    "--include-partial-messages".into(),
                ];
                if !model.is_empty() && safe_token(&model) {
                    args.extend(["--model".into(), model.clone()]);
                }
                let prompt = prompt_with_image_paths(&req.prompt, &req.images);
                let run_id = req.run_id.clone();
                let on_ev = on_event.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    stream_cli_process(&bin, &args, &cwd, Some(&prompt), &run_id, runs, &on_ev)
                })
                .await
                .map_err(|e| e.to_string())?
            } else {
                Err("Anthropic no está configurado. Inicia sesión en Claude o guarda una API key en Ajustes.".into())
            }
        }
        "ollama" => call_ollama(&model, &req, &on_event).await.map(|_| None),
        other => Err(format!("Proveedor desconocido: {other}")),
    };

    match result {
        Ok(session_id) => {
            if req.mode != "plan" {
                if let Ok(Some((files_count, added, removed, diff_text))) =
                    tauri::async_runtime::spawn_blocking(move || collect_git_diff(&diff_cwd)).await
                {
                    let _ = on_event.send(ChatStreamEvent::DiffSummary {
                        files_count,
                        added,
                        removed,
                        diff_text,
                    });
                }
            }
            let _ = on_event.send(ChatStreamEvent::Done {
                duration_ms: started.elapsed().as_millis() as u64,
                session_id,
            });
            Ok(())
        }
        Err(message) => {
            let _ = on_event.send(ChatStreamEvent::Error {
                message: message.clone(),
            });
            Err(message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extrae_step_update_y_result_de_agy() {
        let delta_line = r#"{"event":"step_update","step_update":{"conversation_id":"conv-123","step_type":"agent_response","text_delta":"Hola "}}"#;
        let p1 = extract_stream_json(delta_line);
        assert_eq!(p1.text.as_deref(), Some("Hola "));
        assert_eq!(p1.session_id.as_deref(), Some("conv-123"));
        assert!(!p1.replace);

        let full_line = r#"{"event":"step_update","step_update":{"step_type":"agent_response","text":"Hola mundo"}}"#;
        let p2 = extract_stream_json(full_line);
        assert_eq!(p2.text.as_deref(), Some("Hola mundo"));
        assert!(p2.replace);

        let res_line = r#"{"event":"result","result":{"status":"SUCCESS","conversation_id":"conv-123","response":"Respuesta final"}}"#;
        let p3 = extract_stream_json(res_line);
        assert_eq!(p3.text.as_deref(), Some("Respuesta final"));
        assert_eq!(p3.session_id.as_deref(), Some("conv-123"));
        assert!(p3.is_final_result);

        let tool_line = r#"{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"Path":"src/main.ts"}}}}"#;
        let p4 = extract_stream_json(tool_line);
        let tool = p4.tool.expect("debe extraer herramienta");
        assert_eq!(tool.name, "view_file");
        assert_eq!(tool.detail, "src/main.ts");
        assert_eq!(tool.state, "active");
    }

    #[test]
    fn parsea_git_numstat() {
        let sample = "12\t3\tsrc/main.ts\n5\t0\tsrc/styles.css\n";
        assert_eq!(parse_git_numstat(sample), (2, 17, 3));
    }
}

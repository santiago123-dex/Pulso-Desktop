//! Uso del plan de cada cuenta conectada. Se le pregunta a la herramienta oficial de cada
//! proveedor: no se leen credenciales y la consulta no gasta cuota.

use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::{
    background_command, capture_output_in, parse_agy_usage_json, resolve_cli_binary, QuotaBucket,
    QuotaGroup,
};

/// Se activa si una versión de Claude Code trata `/usage` como un mensaje normal (y cobra por él).
/// Desde ese momento no se repite la consulta, para que el refresco automático no gaste cuota.
static CLAUDE_USAGE_IS_BILLED: AtomicBool = AtomicBool::new(false);

pub fn plan_usage(provider_id: &str) -> Result<Vec<QuotaGroup>, String> {
    match provider_id {
        "anthropic" => claude_usage(),
        "openai" => codex_usage(),
        "antigravity" => antigravity_usage(),
        _ => Err("Este proveedor no informa el uso del plan.".to_string()),
    }
}

fn no_data() -> String {
    "La herramienta no informó el uso del plan.".to_string()
}

fn non_empty(groups: Vec<QuotaGroup>) -> Result<Vec<QuotaGroup>, String> {
    if groups.iter().any(|g| !g.buckets.is_empty()) {
        Ok(groups)
    } else {
        Err(no_data())
    }
}

fn antigravity_usage() -> Result<Vec<QuotaGroup>, String> {
    let bin = resolve_cli_binary("agy").ok_or_else(no_data)?;
    let args = ["-p", "/usage", "--output-format", "json", "--mode", "plan"];
    let (_, out) = capture_output_in(&bin, &args, 20, None).ok_or_else(no_data)?;
    non_empty(parse_agy_usage_json(&out))
}

fn claude_usage() -> Result<Vec<QuotaGroup>, String> {
    if CLAUDE_USAGE_IS_BILLED.load(Ordering::Relaxed) {
        return Err(
            "Esta versión de Claude Code no permite consultar el uso sin gastar cuota.".to_string(),
        );
    }
    let bin = resolve_cli_binary("claude").ok_or_else(no_data)?;
    let args = ["-p", "/usage", "--output-format", "json"];
    // Desde la carpeta temporal para no cargar la configuración ni los ganchos de ningún proyecto.
    let neutral = std::env::temp_dir();
    let (_, out) = capture_output_in(&bin, &args, 30, Some(&neutral)).ok_or_else(no_data)?;
    let value: Value = serde_json::from_str(out.trim()).map_err(|_| no_data())?;
    if value.get("total_cost_usd").and_then(Value::as_f64) > Some(0.0) {
        CLAUDE_USAGE_IS_BILLED.store(true, Ordering::Relaxed);
    }
    if value.get("is_error").and_then(Value::as_bool) == Some(true) {
        return Err(no_data());
    }
    let text = value.get("result").and_then(Value::as_str).unwrap_or("");
    non_empty(parse_claude_usage_text(text))
}

/// `Current session: 24% used · resets Nov 25, 12pm (America/Bogota)`
fn parse_claude_line(line: &str, label: &str, window: &str) -> Option<QuotaBucket> {
    let rest = line.trim().strip_prefix(label)?.trim_start();
    let (percent, tail) = rest.split_once('%')?;
    let used: f64 = percent.trim().parse().ok()?;
    let reset_time = tail
        .split_once("resets")
        .map(|(_, when)| when.trim().to_string())
        .unwrap_or_default();
    Some(QuotaBucket {
        name: String::new(),
        window: window.to_string(),
        remaining_percent: remaining_from_used(used),
        reset_time,
    })
}

fn remaining_from_used(used: f64) -> u8 {
    (100.0 - used.clamp(0.0, 100.0)).round() as u8
}

pub fn parse_claude_usage_text(text: &str) -> Vec<QuotaGroup> {
    let mut buckets = Vec::new();
    for line in text.lines() {
        if let Some(b) = parse_claude_line(line, "Current session:", "5h") {
            buckets.push(b);
        } else if let Some(b) = parse_claude_line(line, "Current week (all models):", "weekly") {
            buckets.push(b);
        }
    }
    if buckets.is_empty() {
        return Vec::new();
    }
    vec![QuotaGroup {
        name: "Claude".to_string(),
        buckets,
    }]
}

/// Interpreta `account/rateLimits/read` de `codex app-server`. `resetsAt` llega en segundos Unix.
pub fn parse_codex_rate_limits(response: &Value) -> Vec<QuotaGroup> {
    let Some(limits) = response.pointer("/result/rateLimits") else {
        return Vec::new();
    };
    let bucket = |key: &str, window: &str| {
        let data = limits.get(key)?;
        let used = data.get("usedPercent")?.as_f64()?;
        let resets = data.get("resetsAt").and_then(Value::as_i64).unwrap_or(0);
        Some(QuotaBucket {
            name: String::new(),
            window: window.to_string(),
            remaining_percent: remaining_from_used(used),
            reset_time: if resets > 0 {
                resets.to_string()
            } else {
                String::new()
            },
        })
    };
    let buckets: Vec<QuotaBucket> = [bucket("primary", "5h"), bucket("secondary", "weekly")]
        .into_iter()
        .flatten()
        .collect();
    if buckets.is_empty() {
        return Vec::new();
    }
    vec![QuotaGroup {
        name: "Codex".to_string(),
        buckets,
    }]
}

fn codex_usage() -> Result<Vec<QuotaGroup>, String> {
    let bin = resolve_cli_binary("codex").ok_or_else(no_data)?;
    let mut child = background_command(&bin)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| no_data())?;
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(no_data());
    };

    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let init = r#"{"id":1,"method":"initialize","params":{"clientInfo":{"name":"pulso-desktop","version":"0.3.1"},"capabilities":{"experimentalApi":true}}}"#;
    let mut groups = Vec::new();
    if writeln!(stdin, "{init}").is_ok() {
        let deadline = Instant::now() + Duration::from_secs(12);
        while Instant::now() < deadline {
            let line = match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(line) => line,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match value.get("id").and_then(Value::as_u64) {
                Some(1) => {
                    let _ = writeln!(stdin, r#"{{"method":"initialized","params":{{}}}}"#);
                    let _ = writeln!(
                        stdin,
                        r#"{{"id":2,"method":"account/rateLimits/read","params":{{}}}}"#
                    );
                    let _ = stdin.flush();
                }
                Some(2) => {
                    groups = parse_codex_rate_limits(&value);
                    break;
                }
                _ => {}
            }
        }
    }

    // Al cerrar la entrada, el servidor termina solo. Con un lanzador `.cmd`, matarlo
    // directamente dejaría vivo el proceso de Node que cuelga de él.
    drop(stdin);
    let grace = Instant::now() + Duration::from_secs(2);
    while Instant::now() < grace && matches!(child.try_wait(), Ok(None)) {
        thread::sleep(Duration::from_millis(25));
    }
    let _ = child.kill();
    let _ = child.wait();
    non_empty(groups)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lee_las_dos_ventanas_de_claude() {
        let text = "You are currently using your subscription\n\n\
            Current session: 24% used · resets Nov 25, 12pm (America/Bogota)\n\
            Current week (all models): 56% used · resets Nov 29, 4pm (America/Bogota)\n\n\
            Last 24h · 557 requests";
        let groups = parse_claude_usage_text(text);
        assert_eq!(groups.len(), 1);
        let b = &groups[0].buckets;
        assert_eq!(b.len(), 2);
        assert_eq!((b[0].window.as_str(), b[0].remaining_percent), ("5h", 76));
        assert_eq!(b[0].reset_time, "Nov 25, 12pm (America/Bogota)");
        assert_eq!(
            (b[1].window.as_str(), b[1].remaining_percent),
            ("weekly", 44)
        );
    }

    #[test]
    fn claude_sin_cifras_no_inventa_cuotas() {
        assert!(parse_claude_usage_text("Please run /login").is_empty());
        let sin_reinicio = parse_claude_usage_text("Current session: 0% used");
        assert_eq!(sin_reinicio[0].buckets[0].remaining_percent, 100);
        assert_eq!(sin_reinicio[0].buckets[0].reset_time, "");
    }

    #[test]
    fn lee_los_limites_de_codex() {
        let v = serde_json::json!({"id":2,"result":{"rateLimits":{
            "primary":{"usedPercent":12.4,"resetsAt":1795619820},
            "secondary":{"usedPercent":140.0}}}});
        let groups = parse_codex_rate_limits(&v);
        let b = &groups[0].buckets;
        assert_eq!(b[0].remaining_percent, 88);
        assert_eq!(b[0].reset_time, "1795619820");
        assert_eq!(b[1].remaining_percent, 0);
        assert!(parse_codex_rate_limits(&serde_json::json!({"id":2,"error":{}})).is_empty());
    }

    #[test]
    #[ignore = "consulta las herramientas instaladas y con sesión iniciada"]
    fn con_las_cuentas_reales() {
        for id in ["anthropic", "openai", "antigravity"] {
            println!("{id}: {:?}", plan_usage(id));
        }
    }
}

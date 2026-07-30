use std::{collections::HashMap, path::Path, process::Stdio, sync::{Arc, Mutex}, time::{Duration, Instant}};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{mpsc, watch},
};
use uuid::Uuid;

use crate::{db::Database, models::{CliStatus, Conversation, StreamPayload}};

#[derive(Clone)]
pub struct RunningProcess {
    pub cancel: watch::Sender<bool>,
    pub input: mpsc::UnboundedSender<String>,
}

pub type RunningMap = Arc<Mutex<HashMap<String, RunningProcess>>>;

pub async fn discover_claude() -> CliStatus {
    if let Ok(path) = std::env::var("CLAUDE_DESK_CLI") {
        return inspect_candidate(path).await.unwrap_or_else(|error| CliStatus {
            found: false,
            path: None,
            version: None,
            error: Some(format!("CLAUDE_DESK_CLI 无效: {error}")),
        });
    }

    let mut candidates = Vec::new();
    if let Ok(home) = std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        push_candidate(&mut candidates, format!("{home}/.local/bin/claude"));
    }
    let output = if cfg!(windows) {
        Command::new("where").arg("claude").output().await
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        Command::new(shell).args(["-lc", "which -a claude"]).output().await
    };
    if let Ok(output) = output {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            push_candidate(&mut candidates, line.trim().to_string());
        }
    }
    if cfg!(target_os = "macos") {
        push_candidate(&mut candidates, "/opt/homebrew/bin/claude".into());
        push_candidate(&mut candidates, "/usr/local/bin/claude".into());
    }

    let mut available = Vec::new();
    for candidate in candidates {
        if let Ok(status) = inspect_candidate(candidate).await {
            available.push(status);
        }
    }
    available.into_iter().max_by_key(|status| {
        status.version.as_deref().map(version_key).unwrap_or((0, 0, 0))
    }).unwrap_or(CliStatus {
        found: false,
        path: None,
        version: None,
        error: Some("未找到可执行的 claude CLI".into()),
    })
}

fn push_candidate(candidates: &mut Vec<String>, path: String) {
    if Path::new(&path).is_file() && !candidates.contains(&path) {
        candidates.push(path);
    }
}

async fn inspect_candidate(path: String) -> Result<CliStatus, String> {
    match Command::new(&path).arg("--version").output().await {
        Ok(output) if output.status.success() => Ok(CliStatus {
            found: true,
            path: Some(path),
            version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            error: None,
        }),
        Ok(output) => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        Err(error) => Err(error.to_string()),
    }
}

fn version_key(version: &str) -> (u64, u64, u64) {
    let mut parts = version
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_start_matches('v')
        .split('.')
        .filter_map(|part| part.parse::<u64>().ok());
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

pub async fn start_run(
    app: AppHandle,
    database: Database,
    running: RunningMap,
    conversation: Conversation,
    prompt: String,
    is_first_turn: bool,
) -> Result<String, String> {
    if running.lock().map_err(|_| "运行状态锁已损坏")?.contains_key(&conversation.id) {
        return Err("该会话仍在生成中".into());
    }
    if !std::path::Path::new(&conversation.project_path).is_dir() {
        return Err("项目目录不存在或不可访问".into());
    }
    let cli = discover_claude().await;
    let executable = cli.path.ok_or_else(|| cli.error.unwrap_or_else(|| "未找到 claude CLI".into()))?;
    let run_id = Uuid::new_v4().to_string();

    let mut command = Command::new(executable);
    command.current_dir(&conversation.project_path)
        .arg("-p")
        .arg(&prompt)
        .args(["--output-format", "stream-json", "--include-partial-messages", "--verbose"])
        .args(["--model", &conversation.model, "--permission-mode", &conversation.permission_mode])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .kill_on_drop(true);
    if is_first_turn {
        command.args(["--session-id", &conversation.claude_session_id]);
    } else {
        command.args(["--resume", &conversation.claude_session_id]);
    }
    let mut child = command.spawn().map_err(|error| format!("启动 claude 失败: {error}"))?;
    let stdout = child.stdout.take().ok_or("无法读取 claude stdout")?;
    let stderr = child.stderr.take().ok_or("无法读取 claude stderr")?;
    let mut stdin = child.stdin.take().ok_or("无法写入 claude stdin")?;
    if conversation.permission_mode != "default" {
        stdin.shutdown().await
            .map_err(|error| format!("无法关闭 claude 输入: {error}"))?;
    }
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<String>();
    running.lock().map_err(|_| "运行状态锁已损坏")?.insert(
        conversation.id.clone(), RunningProcess { cancel: cancel_tx, input: input_tx },
    );

    emit(&app, &conversation.id, &run_id, "started", json!({ "model": conversation.model }))?;
    let task_conversation_id = conversation.id.clone();
    let task_run_id = run_id.clone();
    tauri::async_runtime::spawn(async move {
        let started_at = Instant::now();
        let mut stdout_lines = BufReader::new(stdout).lines();
        let mut stderr_lines = BufReader::new(stderr).lines();
        let mut answer = String::new();
        let mut terminal_error = String::new();
        let mut stderr_output = String::new();
        let mut cancelled = false;
        let mut stdout_open = true;
        let mut stderr_open = true;

        loop {
            tokio::select! {
                changed = cancel_rx.changed() => {
                    if changed.is_ok() && *cancel_rx.borrow() {
                        cancelled = true;
                        let _ = child.start_kill();
                        break;
                    }
                }
                Some(input) = input_rx.recv() => {
                    let _ = stdin.write_all(input.as_bytes()).await;
                    let _ = stdin.write_all(b"\n").await;
                    let _ = stdin.flush().await;
                }
                line = stdout_lines.next_line(), if stdout_open => match line {
                    Ok(Some(line)) => {
                        if parse_line(&app, &database, &task_conversation_id, &task_run_id, &line, &mut answer, &mut terminal_error) {
                            let _ = stdin.shutdown().await;
                        }
                    },
                    _ => stdout_open = false,
                },
                line = stderr_lines.next_line(), if stderr_open => match line {
                    Ok(Some(line)) => push_error_line(&mut stderr_output, &line),
                    _ => stderr_open = false,
                },
                status = child.wait() => {
                    let process_exit_error = match status {
                        Ok(status) if status.success() => None,
                        Ok(status) => Some(format!("claude 进程退出: {status}")),
                        Err(error) => Some(error.to_string()),
                    };
                    while let Ok(Some(line)) = stdout_lines.next_line().await {
                        let _ = parse_line(&app, &database, &task_conversation_id, &task_run_id, &line, &mut answer, &mut terminal_error);
                    }
                    while let Ok(Some(line)) = stderr_lines.next_line().await {
                        push_error_line(&mut stderr_output, &line);
                    }
                    if process_exit_error.is_some() {
                        for line in stderr_output.lines() {
                            push_error_line(&mut terminal_error, line);
                        }
                        if terminal_error.is_empty() {
                            terminal_error = process_exit_error.unwrap_or_default();
                        }
                    }
                    break;
                }
                _ = tokio::time::sleep(Duration::from_secs(180)) => {
                    terminal_error = "Claude CLI 在 180 秒内没有产生任何新事件，已自动终止。请检查 CLI 登录、网络或会话恢复状态。".into();
                    let _ = child.start_kill();
                    break;
                }
            }
        }

        if !answer.trim().is_empty() {
            let metadata = json!({ "durationMs": started_at.elapsed().as_millis() }).to_string();
            let _ = database.insert_message(&task_conversation_id, "assistant", "text", &answer, Some(&metadata));
        }
        if cancelled {
            let _ = emit(&app, &task_conversation_id, &task_run_id, "cancelled", json!({}));
        } else if !terminal_error.trim().is_empty() {
            let _ = database.insert_message(&task_conversation_id, "system", "error", terminal_error.trim(), None);
            let _ = emit(&app, &task_conversation_id, &task_run_id, "error", json!({ "message": terminal_error.trim() }));
        } else {
            let _ = emit(&app, &task_conversation_id, &task_run_id, "completed", json!({}));
        }
        if let Ok(mut processes) = running.lock() { processes.remove(&task_conversation_id); }
    });
    Ok(run_id)
}

fn parse_line(
    app: &AppHandle,
    database: &Database,
    conversation_id: &str,
    run_id: &str,
    line: &str,
    answer: &mut String,
    terminal_error: &mut String,
) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(line) else { return false };
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or_default();
    let should_close_input = should_close_stdin(&value);
    if event_type == "system" && value.get("subtype").and_then(Value::as_str) == Some("init") {
        let _ = database.mark_claude_initialized(conversation_id);
    } else if event_type == "stream_event" {
        let event = &value["event"];
        match event.get("type").and_then(Value::as_str).unwrap_or_default() {
            "content_block_delta" => {
                if let Some(text) = event.pointer("/delta/text").and_then(Value::as_str) {
                    answer.push_str(text);
                    let _ = emit(app, conversation_id, run_id, "text_delta", json!({ "text": text }));
                }
            }
            "content_block_start" => {
                let block = &event["content_block"];
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    let data = json!({ "id": block["id"], "name": block["name"], "input": block["input"] });
                    let _ = database.insert_message(conversation_id, "tool", "tool", &data.to_string(), Some("tool_start"));
                    let _ = emit(app, conversation_id, run_id, "tool_start", data);
                }
            }
            _ => {}
        }
    } else if event_type == "user" {
        if let Some(items) = value.pointer("/message/content").and_then(Value::as_array) {
            for item in items {
                if item.get("type").and_then(Value::as_str) == Some("tool_result") {
                    let data = json!({ "toolUseId": item["tool_use_id"], "content": item["content"], "isError": item["is_error"] });
                    let _ = database.insert_message(conversation_id, "tool", "tool", &data.to_string(), Some("tool_result"));
                    let _ = emit(app, conversation_id, run_id, "tool_result", data);
                }
            }
        }
    } else if event_type == "control_request" {
        let request_id = value.get("request_id").or_else(|| value.pointer("/request/request_id")).and_then(Value::as_str).unwrap_or_default();
        let request = value.get("request").unwrap_or(&value);
        let data = json!({
            "id": request_id,
            "toolName": request.get("tool_name").or_else(|| request.get("toolName")).and_then(Value::as_str).unwrap_or("工具调用"),
            "input": request.get("input").cloned().unwrap_or(Value::Null),
            "description": request.get("description").and_then(Value::as_str).unwrap_or("Claude 请求执行工具")
        });
        let _ = emit(app, conversation_id, run_id, "permission_request", data);
    } else if event_type == "result" {
        if value.get("is_error").and_then(Value::as_bool) == Some(true) {
            let errors = value
                .get("errors")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n"))
                .filter(|message| !message.is_empty());
            let message = errors.or_else(|| value.get("result").and_then(Value::as_str).map(ToString::to_string));
            if let Some(message) = message {
                push_error_line(terminal_error, &message);
            }
        } else if answer.is_empty() {
            if let Some(result) = value.get("result").and_then(Value::as_str) {
                answer.push_str(result);
                let _ = emit(app, conversation_id, run_id, "text_delta", json!({ "text": result }));
            }
        }
    }
    should_close_input
}

fn should_close_stdin(value: &Value) -> bool {
    if value.get("type").and_then(Value::as_str) == Some("result") {
        return true;
    }
    if value.get("type").and_then(Value::as_str) != Some("stream_event")
        || value.pointer("/event/type").and_then(Value::as_str) != Some("message_delta")
    {
        return false;
    }
    matches!(
        value.pointer("/event/delta/stop_reason").and_then(Value::as_str),
        Some("end_turn" | "max_tokens" | "refusal" | "stop_sequence")
    )
}

pub fn permission_response(request_id: &str, allow: bool, input: Value) -> String {
    let response = if allow {
        json!({ "behavior": "allow", "updatedInput": input })
    } else {
        json!({ "behavior": "deny", "message": "User denied this tool request" })
    };
    json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request_id, "response": response }
    }).to_string()
}

fn push_error_line(target: &mut String, line: &str) {
    let line = line.trim();
    if !line.is_empty() && !target.lines().any(|existing| existing == line) {
        target.push_str(line);
        target.push('\n');
    }
}

fn emit(app: &AppHandle, conversation_id: &str, run_id: &str, event: &str, data: Value) -> Result<(), String> {
    app.emit("claude-stream", StreamPayload {
        conversation_id: conversation_id.to_string(), run_id: run_id.to_string(), event: event.to_string(), data,
    }).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{permission_response, should_close_stdin};
    use serde_json::{json, Value};

    #[test]
    fn closes_input_on_final_message_delta() {
        let event = json!({
            "type": "stream_event",
            "event": { "type": "message_delta", "delta": { "stop_reason": "end_turn" } }
        });
        assert!(should_close_stdin(&event));
    }

    #[test]
    fn keeps_input_open_for_tool_use() {
        let event = json!({
            "type": "stream_event",
            "event": { "type": "message_delta", "delta": { "stop_reason": "tool_use" } }
        });
        assert!(!should_close_stdin(&event));
    }

    #[test]
    fn result_is_a_terminal_fallback() {
        assert!(should_close_stdin(&json!({ "type": "result", "is_error": false })));
    }

    #[test]
    fn permission_allow_preserves_tool_input() {
        let value: Value = serde_json::from_str(&permission_response(
            "request-1",
            true,
            json!({ "command": "cargo check" }),
        )).unwrap();
        assert_eq!(
            value.pointer("/response/response/updatedInput/command").and_then(Value::as_str),
            Some("cargo check")
        );
    }

}

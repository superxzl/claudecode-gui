mod cli;
mod config;
mod db;
mod models;
mod skills;

use std::sync::{Arc, Mutex};

use cli::RunningMap;
use db::Database;
use models::{ClaudeGeneralConfig, ClaudeGeneralConfigPatch, CliStatus, Conversation, ConversationPatch, ConversationSearchResult, InstalledSkill, Message};
use tauri::{Manager, State};

struct AppState {
    database: Database,
    running: RunningMap,
}

#[tauri::command]
async fn check_claude() -> CliStatus { cli::discover_claude().await }

#[tauri::command]
fn list_conversations(state: State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    state.database.list_conversations()
}

#[tauri::command]
fn search_conversations(query: String, state: State<'_, AppState>) -> Result<Vec<ConversationSearchResult>, String> {
    state.database.search_conversations(&query)
}

#[tauri::command]
fn create_conversation(project_path: String, state: State<'_, AppState>) -> Result<Conversation, String> {
    state.database.create_conversation(&project_path)
}

#[tauri::command]
fn update_conversation(id: String, patch: ConversationPatch, state: State<'_, AppState>) -> Result<Conversation, String> {
    state.database.update_conversation(&id, patch)
}

#[tauri::command]
fn delete_conversation(id: String, state: State<'_, AppState>) -> Result<(), String> {
    if state.running.lock().map_err(|_| "运行状态锁已损坏")?.contains_key(&id) {
        return Err("请先停止当前生成".into());
    }
    state.database.delete_conversation(&id)
}

#[tauri::command]
fn list_messages(conversation_id: String, state: State<'_, AppState>) -> Result<Vec<Message>, String> {
    state.database.list_messages(&conversation_id)
}

#[tauri::command]
async fn send_message(
    app: tauri::AppHandle,
    conversation_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let content = content.trim();
    if content.is_empty() { return Err("消息不能为空".into()); }
    let conversation = state.database.get_conversation(&conversation_id)?;
    let is_first_turn = !state.database.is_claude_initialized(&conversation_id)?;
    state.database.insert_message(&conversation_id, "user", "text", content, None)?;
    if is_first_turn && conversation.title == "新会话" {
        let title: String = content.chars().take(28).collect();
        let _ = state.database.update_conversation(&conversation_id, ConversationPatch {
            title: Some(title), project_path: None, model: None, permission_mode: None,
        });
    }
    cli::start_run(app, state.database.clone(), state.running.clone(), conversation, content.to_string(), is_first_turn).await
}

#[tauri::command]
fn stop_run(conversation_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let running = state.running.lock().map_err(|_| "运行状态锁已损坏")?;
    if let Some(process) = running.get(&conversation_id) {
        process.cancel.send(true).map_err(|_| "停止信号发送失败".to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn respond_permission(
    conversation_id: String,
    request_id: String,
    allow: bool,
    input: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let running = state.running.lock().map_err(|_| "运行状态锁已损坏")?;
    let process = running.get(&conversation_id).ok_or("对应进程已结束")?;
    process.input.send(cli::permission_response(&request_id, allow, input)).map_err(|_| "权限响应发送失败".to_string())
}

#[tauri::command]
async fn choose_project_directory() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new().pick_folder().map(|path| path.to_string_lossy().to_string())
    }).await.ok().flatten()
}

#[tauri::command]
async fn list_installed_skills(project_path: Option<String>) -> Result<Vec<InstalledSkill>, String> {
    tauri::async_runtime::spawn_blocking(move || skills::list_installed(project_path.as_deref()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_claude_config() -> Result<ClaudeGeneralConfig, String> {
    tauri::async_runtime::spawn_blocking(config::read_general_config)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_claude_config(patch: ClaudeGeneralConfigPatch) -> Result<ClaudeGeneralConfig, String> {
    tauri::async_runtime::spawn_blocking(move || config::save_general_config(patch))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn choose_application_and_open(project_path: String) -> Result<(), String> {
    if !std::path::Path::new(&project_path).is_dir() {
        return Err("项目目录不存在或不可访问".into());
    }
    let application = tauri::async_runtime::spawn_blocking(|| {
        let mut dialog = rfd::FileDialog::new().set_title("选择打开项目的程序");
        if cfg!(target_os = "macos") {
            dialog = dialog
                .set_directory("/Applications")
                .add_filter("macOS 应用程序", &["app"]);
        }
        dialog.pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(application) = application else { return Ok(()) };

    if cfg!(target_os = "macos")
        && application.extension().and_then(|value| value.to_str()) != Some("app")
    {
        return Err("请选择一个 macOS 应用程序（.app）".into());
    }

    let status = if cfg!(target_os = "macos") {
        tokio::process::Command::new("open")
            .arg("-a")
            .arg(&application)
            .arg(&project_path)
            .status()
            .await
    } else {
        tokio::process::Command::new(&application)
            .arg(&project_path)
            .status()
            .await
    }
    .map_err(|error| format!("无法启动所选程序: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("所选程序启动失败: {status}"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let database = Database::new(data_dir.join("claude-desk.sqlite3"))?;
            let _ = database.path();
            app.manage(AppState { database, running: Arc::new(Mutex::new(std::collections::HashMap::new())) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_claude, list_conversations, search_conversations, create_conversation, update_conversation,
            delete_conversation, list_messages, send_message, stop_run,
            respond_permission, choose_project_directory, choose_application_and_open,
            list_installed_skills, get_claude_config, save_claude_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running Claude Desk");
}

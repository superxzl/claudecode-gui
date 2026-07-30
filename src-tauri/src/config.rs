use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde_json::{Map, Value};

use crate::models::{ClaudeGeneralConfig, ClaudeGeneralConfigPatch};

const MODEL_FIELDS: [(&str, &str); 4] = [
    ("sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL"),
    ("opus", "ANTHROPIC_DEFAULT_OPUS_MODEL"),
    ("haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    ("fable", "ANTHROPIC_DEFAULT_FABLE_MODEL"),
];

pub fn read_general_config() -> Result<ClaudeGeneralConfig, String> {
    let path = settings_path()?;
    let root = read_root(&path)?;
    Ok(extract_config(&path, &root))
}

pub fn save_general_config(
    patch: ClaudeGeneralConfigPatch,
) -> Result<ClaudeGeneralConfig, String> {
    validate_patch(&patch)?;
    let path = settings_path()?;
    let mut root = read_root(&path)?;
    apply_patch(&mut root, &patch)?;
    write_root(&path, &root)?;
    Ok(extract_config(&path, &root))
}

fn settings_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or("无法获取用户目录")?;
    Ok(PathBuf::from(home).join(".claude/settings.json"))
}

fn read_root(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let content = fs::read_to_string(path)
        .map_err(|error| format!("无法读取 Claude 配置: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Claude 配置不是有效 JSON: {error}"))
}

fn extract_config(path: &Path, root: &Value) -> ClaudeGeneralConfig {
    let env = root.get("env").and_then(Value::as_object);
    let model = |key: &str| {
        env.and_then(|values| values.get(key))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    ClaudeGeneralConfig {
        path: path.to_string_lossy().to_string(),
        default_model: root
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        sonnet_model: model("ANTHROPIC_DEFAULT_SONNET_MODEL"),
        opus_model: model("ANTHROPIC_DEFAULT_OPUS_MODEL"),
        haiku_model: model("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
        fable_model: model("ANTHROPIC_DEFAULT_FABLE_MODEL"),
    }
}

fn apply_patch(root: &mut Value, patch: &ClaudeGeneralConfigPatch) -> Result<(), String> {
    let root = root
        .as_object_mut()
        .ok_or("Claude 配置根节点必须是对象")?;
    set_optional(root, "model", &patch.default_model);

    let env = root.entry("env").or_insert_with(|| Value::Object(Map::new()));
    let env = env
        .as_object_mut()
        .ok_or("Claude 配置中的 env 必须是对象")?;
    for (field, key) in MODEL_FIELDS {
        let value = match field {
            "sonnet" => &patch.sonnet_model,
            "opus" => &patch.opus_model,
            "haiku" => &patch.haiku_model,
            _ => &patch.fable_model,
        };
        set_optional(env, key, value);
        set_optional(env, &format!("{key}_NAME"), value);
    }
    Ok(())
}

fn set_optional(target: &mut Map<String, Value>, key: &str, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        target.remove(key);
    } else {
        target.insert(key.to_string(), Value::String(value.to_string()));
    }
}

fn validate_patch(patch: &ClaudeGeneralConfigPatch) -> Result<(), String> {
    for value in [
        &patch.default_model,
        &patch.sonnet_model,
        &patch.opus_model,
        &patch.haiku_model,
        &patch.fable_model,
    ] {
        if value.len() > 200 || value.contains(['\n', '\r']) {
            return Err("模型名称格式无效".into());
        }
    }
    Ok(())
}

fn write_root(path: &Path, root: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("Claude 配置路径无效")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建 Claude 配置目录: {error}"))?;
    let temp_path = parent.join("settings.json.claude-desk.tmp");
    let content = serde_json::to_string_pretty(root).map_err(|error| error.to_string())? + "\n";
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    let mut file = options
        .open(&temp_path)
        .map_err(|error| format!("无法写入 Claude 配置: {error}"))?;

    #[cfg(unix)]
    if let Ok(metadata) = fs::metadata(path) {
        use std::os::unix::fs::PermissionsExt;
        let _ = file.set_permissions(fs::Permissions::from_mode(metadata.permissions().mode()));
    }

    file.write_all(content.as_bytes())
        .map_err(|error| format!("无法写入 Claude 配置: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("无法同步 Claude 配置: {error}"))?;
    fs::rename(&temp_path, path).map_err(|error| format!("无法替换 Claude 配置: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{apply_patch, extract_config};
    use crate::models::ClaudeGeneralConfigPatch;
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn updates_models_without_touching_sensitive_fields() {
        let mut root = json!({
            "env": { "ANTHROPIC_AUTH_TOKEN": "secret", "ANTHROPIC_DEFAULT_OPUS_MODEL": "old" },
            "unknown": true
        });
        let patch = ClaudeGeneralConfigPatch {
            default_model: "opus[1m]".into(),
            sonnet_model: "sonnet-id".into(),
            opus_model: "opus-id".into(),
            haiku_model: "haiku-id".into(),
            fable_model: String::new(),
        };
        apply_patch(&mut root, &patch).unwrap();
        let config = extract_config(Path::new("settings.json"), &root);
        assert_eq!(config.opus_model, "opus-id");
        assert_eq!(root["env"]["ANTHROPIC_AUTH_TOKEN"], "secret");
        assert_eq!(root["unknown"], true);
        assert!(root["env"].get("ANTHROPIC_DEFAULT_FABLE_MODEL").is_none());
    }
}

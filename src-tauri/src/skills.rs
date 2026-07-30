use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use crate::models::InstalledSkill;

pub fn list_installed(project_path: Option<&str>) -> Result<Vec<InstalledSkill>, String> {
    let home = user_home().ok_or("无法获取用户目录")?;
    let mut skills = Vec::new();
    let mut seen = HashSet::new();

    collect_directory(
        &home.join(".claude/skills"),
        "user",
        "用户级",
        &mut seen,
        &mut skills,
    );

    if let Some(project_path) = project_path {
        let project = Path::new(project_path);
        if project.is_dir() {
            collect_directory(
                &project.join(".claude/skills"),
                "project",
                "当前项目",
                &mut seen,
                &mut skills,
            );
        }
    }

    collect_installed_plugins(&home, &mut seen, &mut skills);
    skills.sort_by(|left, right| {
        scope_rank(&left.scope)
            .cmp(&scope_rank(&right.scope))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(skills)
}

fn user_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn collect_installed_plugins(
    home: &Path,
    seen: &mut HashSet<PathBuf>,
    skills: &mut Vec<InstalledSkill>,
) {
    let registry_path = home.join(".claude/plugins/installed_plugins.json");
    let Ok(content) = fs::read_to_string(registry_path) else {
        return;
    };
    let Ok(registry) = serde_json::from_str::<serde_json::Value>(&content) else {
        return;
    };
    let Some(plugins) = registry.get("plugins").and_then(|value| value.as_object()) else {
        return;
    };

    for (plugin_name, installs) in plugins {
        let Some(installs) = installs.as_array() else {
            continue;
        };
        for install in installs {
            let Some(path) = install.get("installPath").and_then(|value| value.as_str()) else {
                continue;
            };
            collect_directory(
                &Path::new(path).join("skills"),
                "plugin",
                plugin_name,
                seen,
                skills,
            );
        }
    }
}

fn collect_directory(
    root: &Path,
    scope: &str,
    source: &str,
    seen: &mut HashSet<PathBuf>,
    skills: &mut Vec<InstalledSkill>,
) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let skill_path = entry.path().join("SKILL.md");
        if !skill_path.is_file() {
            continue;
        }
        let identity = fs::canonicalize(&skill_path).unwrap_or_else(|_| skill_path.clone());
        if !seen.insert(identity) {
            continue;
        }
        let fallback = entry.file_name().to_string_lossy().to_string();
        let (name, description) = read_metadata(&skill_path, &fallback);
        skills.push(InstalledSkill {
            name,
            description,
            path: skill_path.to_string_lossy().to_string(),
            scope: scope.to_string(),
            source: source.to_string(),
        });
    }
}

fn read_metadata(path: &Path, fallback_name: &str) -> (String, String) {
    let Ok(content) = fs::read_to_string(path) else {
        return (fallback_name.to_string(), String::new());
    };
    let mut name = None;
    let mut description = None;
    let mut in_frontmatter = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if in_frontmatter {
                break;
            }
            in_frontmatter = true;
            continue;
        }
        if !in_frontmatter {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value
            .trim()
            .trim_matches(|character| character == '"' || character == '\'');
        match key.trim() {
            "name" if !value.is_empty() => name = Some(value.to_string()),
            "description" if !value.is_empty() => description = Some(value.to_string()),
            _ => {}
        }
    }

    (
        name.unwrap_or_else(|| fallback_name.to_string()),
        description.unwrap_or_default(),
    )
}

fn scope_rank(scope: &str) -> u8 {
    match scope {
        "project" => 0,
        "user" => 1,
        _ => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::read_metadata;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn reads_skill_frontmatter() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("claude-desk-skill-{suffix}.md"));
        fs::write(
            &path,
            "---\nname: test-skill\ndescription: \"A useful skill\"\n---\n# Test\n",
        )
        .unwrap();
        let metadata = read_metadata(&path, "fallback");
        let _ = fs::remove_file(path);
        assert_eq!(metadata, ("test-skill".into(), "A useful skill".into()));
    }
}

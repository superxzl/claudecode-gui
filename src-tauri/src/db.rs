use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::models::{Conversation, ConversationPatch, ConversationSearchResult, Message};

#[derive(Clone)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let db = Self { path };
        let connection = db.connect()?;
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA foreign_keys = ON;
                 CREATE TABLE IF NOT EXISTS conversations (
                   id TEXT PRIMARY KEY,
                   claude_session_id TEXT NOT NULL UNIQUE,
                   title TEXT NOT NULL,
                   project_path TEXT NOT NULL,
                   model TEXT NOT NULL,
                   permission_mode TEXT NOT NULL,
                   claude_initialized INTEGER NOT NULL DEFAULT 0,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS messages (
                   id TEXT PRIMARY KEY,
                   conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                   role TEXT NOT NULL,
                   kind TEXT NOT NULL DEFAULT 'text',
                   content TEXT NOT NULL,
                   metadata TEXT,
                   created_at TEXT NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS messages_conversation_idx
                   ON messages(conversation_id, created_at);",
            )
            .map_err(|e| e.to_string())?;
        let has_initialized_column = connection
            .prepare("PRAGMA table_info(conversations)")
            .and_then(|mut statement| {
                let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
                columns.collect::<Result<Vec<_>, _>>()
            })
            .map_err(|e| e.to_string())?
            .iter()
            .any(|column| column == "claude_initialized");
        if !has_initialized_column {
            connection
                .execute(
                    "ALTER TABLE conversations ADD COLUMN claude_initialized INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        // Claude CLI calls its interactive confirmation mode `default`.
        connection
            .execute("UPDATE conversations SET permission_mode = 'default' WHERE permission_mode = 'manual'", [])
            .map_err(|e| e.to_string())?;
        Ok(db)
    }

    fn connect(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.path).map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
        Ok(connection)
    }

    pub fn path(&self) -> &Path { &self.path }

    pub fn list_conversations(&self) -> Result<Vec<Conversation>, String> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT id, claude_session_id, title, project_path, model, permission_mode, created_at, updated_at
             FROM conversations ORDER BY updated_at DESC",
        ).map_err(|e| e.to_string())?;
        let rows = statement.query_map([], map_conversation).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn search_conversations(&self, query: &str) -> Result<Vec<ConversationSearchResult>, String> {
        let pattern = format!("%{}%", escape_like(query.trim()));
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT c.id, c.claude_session_id, c.title, c.project_path, c.model,
                    c.permission_mode, c.created_at, c.updated_at,
                    CASE
                      WHEN c.title LIKE ?1 ESCAPE '\\' THEN c.title
                      WHEN c.project_path LIKE ?1 ESCAPE '\\' THEN c.project_path
                      ELSE COALESCE((
                        SELECT m.content FROM messages m
                        WHERE m.conversation_id = c.id AND m.content LIKE ?1 ESCAPE '\\'
                        ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1
                      ), '')
                    END AS snippet,
                    CASE
                      WHEN c.title LIKE ?1 ESCAPE '\\' THEN 'title'
                      WHEN c.project_path LIKE ?1 ESCAPE '\\' THEN 'path'
                      ELSE 'message'
                    END AS matched_in
             FROM conversations c
             WHERE c.title LIKE ?1 ESCAPE '\\'
                OR c.project_path LIKE ?1 ESCAPE '\\'
                OR EXISTS (
                  SELECT 1 FROM messages m
                  WHERE m.conversation_id = c.id AND m.content LIKE ?1 ESCAPE '\\'
                )
             ORDER BY c.updated_at DESC
             LIMIT 50",
        ).map_err(|error| error.to_string())?;
        let rows = statement.query_map([pattern], |row| {
            let snippet: String = row.get(8)?;
            Ok(ConversationSearchResult {
                conversation: Conversation {
                    id: row.get(0)?,
                    claude_session_id: row.get(1)?,
                    title: row.get(2)?,
                    project_path: row.get(3)?,
                    model: row.get(4)?,
                    permission_mode: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                },
                snippet: compact_snippet(&snippet),
                matched_in: row.get(9)?,
            })
        }).map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
    }

    pub fn get_conversation(&self, id: &str) -> Result<Conversation, String> {
        let connection = self.connect()?;
        connection.query_row(
            "SELECT id, claude_session_id, title, project_path, model, permission_mode, created_at, updated_at
             FROM conversations WHERE id = ?1",
            [id], map_conversation,
        ).optional().map_err(|e| e.to_string())?
            .ok_or_else(|| "会话不存在".to_string())
    }

    pub fn create_conversation(&self, project_path: &str) -> Result<Conversation, String> {
        let id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let connection = self.connect()?;
        connection.execute(
            "INSERT INTO conversations
             (id, claude_session_id, title, project_path, model, permission_mode, created_at, updated_at)
             VALUES (?1, ?2, '新会话', ?3, 'sonnet', 'default', ?4, ?4)",
            params![id, session_id, project_path, now],
        ).map_err(|e| e.to_string())?;
        self.get_conversation(&id)
    }

    pub fn update_conversation(&self, id: &str, patch: ConversationPatch) -> Result<Conversation, String> {
        let current = self.get_conversation(id)?;
        let title = patch.title.unwrap_or(current.title);
        let project_path = patch.project_path.unwrap_or(current.project_path);
        let model = patch.model.unwrap_or(current.model);
        let permission_mode = normalize_permission_mode(
            &patch.permission_mode.unwrap_or(current.permission_mode),
        );
        let now = Utc::now().to_rfc3339();
        self.connect()?.execute(
            "UPDATE conversations SET title = ?2, project_path = ?3, model = ?4, permission_mode = ?5, updated_at = ?6 WHERE id = ?1",
            params![id, title, project_path, model, permission_mode, now],
        ).map_err(|e| e.to_string())?;
        self.get_conversation(id)
    }

    pub fn delete_conversation(&self, id: &str) -> Result<(), String> {
        self.connect()?.execute("DELETE FROM conversations WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_messages(&self, conversation_id: &str) -> Result<Vec<Message>, String> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT id, conversation_id, role, kind, content, metadata, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC, rowid ASC",
        ).map_err(|e| e.to_string())?;
        let rows = statement.query_map([conversation_id], |row| Ok(Message {
            id: row.get(0)?, conversation_id: row.get(1)?, role: row.get(2)?, kind: row.get(3)?,
            content: row.get(4)?, metadata: row.get(5)?, created_at: row.get(6)?,
        })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn insert_message(&self, conversation_id: &str, role: &str, kind: &str, content: &str, metadata: Option<&str>) -> Result<Message, String> {
        let message = Message {
            id: Uuid::new_v4().to_string(), conversation_id: conversation_id.to_string(),
            role: role.to_string(), kind: kind.to_string(), content: content.to_string(),
            metadata: metadata.map(ToString::to_string), created_at: Utc::now().to_rfc3339(),
        };
        self.connect()?.execute(
            "INSERT INTO messages (id, conversation_id, role, kind, content, metadata, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![message.id, message.conversation_id, message.role, message.kind, message.content, message.metadata, message.created_at],
        ).map_err(|e| e.to_string())?;
        self.connect()?.execute("UPDATE conversations SET updated_at = ?2 WHERE id = ?1", params![conversation_id, Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
        Ok(message)
    }

    pub fn is_claude_initialized(&self, conversation_id: &str) -> Result<bool, String> {
        self.connect()?
            .query_row(
                "SELECT claude_initialized FROM conversations WHERE id = ?1",
                [conversation_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|e| e.to_string())
    }

    pub fn mark_claude_initialized(&self, conversation_id: &str) -> Result<(), String> {
        self.connect()?
            .execute(
                "UPDATE conversations SET claude_initialized = 1 WHERE id = ?1",
                [conversation_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn normalize_permission_mode(value: &str) -> String {
    if value == "manual" { "default".to_string() } else { value.to_string() }
}

fn escape_like(value: &str) -> String {
    value.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

fn compact_snippet(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut characters = compact.chars();
    let snippet: String = characters.by_ref().take(150).collect();
    if characters.next().is_some() { format!("{snippet}...") } else { snippet }
}

fn map_conversation(row: &rusqlite::Row<'_>) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: row.get(0)?, claude_session_id: row.get(1)?, title: row.get(2)?, project_path: row.get(3)?,
        model: row.get(4)?, permission_mode: row.get(5)?, created_at: row.get(6)?, updated_at: row.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::Database;
    use crate::models::ConversationPatch;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    fn test_database() -> (Database, std::path::PathBuf) {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("claude-desk-search-{suffix}.sqlite3"));
        (Database::new(path.clone()).unwrap(), path)
    }

    #[test]
    fn searches_titles_paths_and_message_content() {
        let (database, path) = test_database();
        let conversation = database.create_conversation("/tmp/search-project").unwrap();
        database.update_conversation(&conversation.id, ConversationPatch {
            title: Some("搜索测试".into()), project_path: None, model: None, permission_mode: None,
        }).unwrap();
        database.insert_message(&conversation.id, "user", "text", "这里包含独特关键词", None).unwrap();

        let results = database.search_conversations("独特关键词").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].matched_in, "message");

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn treats_like_wildcards_as_plain_text() {
        let (database, path) = test_database();
        let first = database.create_conversation("/tmp/first").unwrap();
        database.update_conversation(&first.id, ConversationPatch {
            title: Some("进度 100%".into()), project_path: None, model: None, permission_mode: None,
        }).unwrap();
        database.create_conversation("/tmp/second").unwrap();

        let results = database.search_conversations("%").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].conversation.id, first.id);

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }
}

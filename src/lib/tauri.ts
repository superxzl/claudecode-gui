import { invoke } from "@tauri-apps/api/core";
import type { ClaudeGeneralConfig, ClaudeGeneralConfigPatch, CliStatus, Conversation, ConversationSearchResult, InstalledSkill, Message, PermissionMode } from "../types";

export const api = {
  checkClaude: () => invoke<CliStatus>("check_claude"),
  listConversations: () => invoke<Conversation[]>("list_conversations"),
  searchConversations: (query: string) =>
    invoke<ConversationSearchResult[]>("search_conversations", { query }),
  createConversation: (projectPath: string) =>
    invoke<Conversation>("create_conversation", { projectPath }),
  updateConversation: (id: string, patch: { title?: string; projectPath?: string; model?: string; permissionMode?: PermissionMode }) =>
    invoke<Conversation>("update_conversation", { id, patch }),
  deleteConversation: (id: string) => invoke<void>("delete_conversation", { id }),
  listMessages: (conversationId: string) =>
    invoke<Message[]>("list_messages", { conversationId }),
  sendMessage: (conversationId: string, content: string) =>
    invoke<string>("send_message", { conversationId, content }),
  stopRun: (conversationId: string) => invoke<void>("stop_run", { conversationId }),
  respondPermission: (conversationId: string, requestId: string, allow: boolean, input: unknown) =>
    invoke<void>("respond_permission", { conversationId, requestId, allow, input }),
  chooseProjectDirectory: () => invoke<string | null>("choose_project_directory"),
  listInstalledSkills: (projectPath?: string) =>
    invoke<InstalledSkill[]>("list_installed_skills", { projectPath }),
  getClaudeConfig: () => invoke<ClaudeGeneralConfig>("get_claude_config"),
  saveClaudeConfig: (patch: ClaudeGeneralConfigPatch) =>
    invoke<ClaudeGeneralConfig>("save_claude_config", { patch }),
  chooseApplicationAndOpen: (projectPath: string) =>
    invoke<void>("choose_application_and_open", { projectPath }),
};

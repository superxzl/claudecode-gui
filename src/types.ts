export type Role = "user" | "assistant" | "system" | "tool";
export type MessageKind = "text" | "tool" | "error";

export interface Conversation {
  id: string;
  claudeSessionId: string;
  title: string;
  projectPath: string;
  model: string;
  permissionMode: PermissionMode;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSearchResult {
  conversation: Conversation;
  snippet: string;
  matchedIn: "title" | "path" | "message";
}

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  kind: MessageKind;
  content: string;
  metadata?: string | null;
  createdAt: string;
}

export type PermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk";

export interface CliStatus {
  found: boolean;
  path: string | null;
  version: string | null;
  error: string | null;
}

export interface InstalledSkill {
  name: string;
  description: string;
  path: string;
  scope: "project" | "user" | "plugin";
  source: string;
}

export interface ClaudeGeneralConfig {
  path: string;
  defaultModel: string;
  sonnetModel: string;
  opusModel: string;
  haikuModel: string;
  fableModel: string;
}

export type ClaudeGeneralConfigPatch = Omit<ClaudeGeneralConfig, "path">;

export interface StreamEvent {
  conversationId: string;
  runId: string;
  event: "started" | "status" | "text_delta" | "tool_start" | "tool_result" | "permission_request" | "completed" | "error" | "cancelled";
  data: unknown;
}

export interface PermissionRequest {
  id: string;
  toolName: string;
  input: unknown;
  description: string;
}

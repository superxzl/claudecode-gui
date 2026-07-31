import { create } from "zustand";
import { api } from "./lib/tauri";
import type { CliStatus, Conversation, Message, PermissionMode, PermissionRequest, StreamEvent } from "./types";

interface LiveTool { id: string; name: string; detail: unknown; status: "running" | "done" | "error" }

interface AppStore {
  conversations: Conversation[];
  activeId: string | null;
  messages: Message[];
  cliStatus: CliStatus | null;
  loading: boolean;
  running: Record<string, boolean>;
  streams: Record<string, string>;
  runStatus: Record<string, string>;
  liveTools: Record<string, LiveTool[]>;
  permission: { conversationId: string; request: PermissionRequest } | null;
  error: string | null;
  initialize: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  updateActive: (patch: { model?: string; permissionMode?: PermissionMode; projectPath?: string; title?: string }) => Promise<void>;
  chooseDirectory: () => Promise<void>;
  send: (content: string) => Promise<void>;
  stop: () => Promise<void>;
  handleStream: (event: StreamEvent) => Promise<void>;
  answerPermission: (allow: boolean) => Promise<void>;
  clearError: () => void;
}

const messageNow = (conversationId: string, role: "user" | "assistant", content: string): Message => ({
  id: crypto.randomUUID(), conversationId, role, kind: "text", content, createdAt: new Date().toISOString(),
});

export const useAppStore = create<AppStore>((set, get) => ({
  conversations: [], activeId: null, messages: [], cliStatus: null, loading: true,
  running: {}, streams: {}, runStatus: {}, liveTools: {}, permission: null, error: null,

  initialize: async () => {
    try {
      const [cliStatus, conversations] = await Promise.all([api.checkClaude(), api.listConversations()]);
      const activeId = conversations[0]?.id ?? null;
      const messages = activeId ? await api.listMessages(activeId) : [];
      set({ cliStatus, conversations, activeId, messages, loading: false });
    } catch (error) { set({ error: String(error), loading: false }); }
  },

  selectConversation: async (id) => {
    set({ activeId: id, messages: [], error: null });
    try { set({ messages: await api.listMessages(id) }); }
    catch (error) { set({ error: String(error) }); }
  },

  createConversation: async () => {
    try {
      let path = get().conversations.find((item) => item.id === get().activeId)?.projectPath;
      if (!path) path = await api.chooseProjectDirectory() ?? undefined;
      if (!path) return;
      const conversation = await api.createConversation(path);
      set((state) => ({ conversations: [conversation, ...state.conversations], activeId: conversation.id, messages: [] }));
    } catch (error) { set({ error: String(error) }); }
  },

  deleteConversation: async (id) => {
    try {
      await api.deleteConversation(id);
      const conversations = get().conversations.filter((item) => item.id !== id);
      const activeId = get().activeId === id ? conversations[0]?.id ?? null : get().activeId;
      const messages = activeId ? await api.listMessages(activeId) : [];
      set({ conversations, activeId, messages });
    } catch (error) { set({ error: String(error) }); }
  },

  updateActive: async (patch) => {
    const id = get().activeId;
    if (!id) return;
    try {
      const updated = await api.updateConversation(id, patch);
      set((state) => ({ conversations: state.conversations.map((item) => item.id === id ? updated : item) }));
    } catch (error) { set({ error: String(error) }); }
  },

  chooseDirectory: async () => {
    const path = await api.chooseProjectDirectory();
    if (path) await get().updateActive({ projectPath: path });
  },

  send: async (content) => {
    const conversationId = get().activeId;
    if (!conversationId || get().running[conversationId]) return;
    const userMessage = messageNow(conversationId, "user", content);
    set((state) => ({
      messages: [...state.messages, userMessage],
      running: { ...state.running, [conversationId]: true },
      streams: { ...state.streams, [conversationId]: "" },
      runStatus: { ...state.runStatus, [conversationId]: "正在思考..." },
      liveTools: { ...state.liveTools, [conversationId]: [] }, error: null,
    }));
    try {
      await api.sendMessage(conversationId, content);
      const conversations = await api.listConversations();
      set({ conversations });
    } catch (error) {
      set((state) => ({
        running: { ...state.running, [conversationId]: false },
        runStatus: { ...state.runStatus, [conversationId]: "" },
        liveTools: { ...state.liveTools, [conversationId]: [] },
        error: String(error),
      }));
      const messages = await api.listMessages(conversationId).catch(() => get().messages);
      set({ messages });
    }
  },

  stop: async () => {
    const id = get().activeId;
    if (id) await api.stopRun(id).catch((error) => set({ error: String(error) }));
  },

  handleStream: async (payload) => {
    const id = payload.conversationId;
    if (payload.event === "started") {
      set((state) => ({ running: { ...state.running, [id]: true }, runStatus: { ...state.runStatus, [id]: "正在思考..." } }));
    } else if (payload.event === "status") {
      const message = (payload.data as { message?: string }).message ?? "Claude CLI 正在处理...";
      set((state) => ({ runStatus: { ...state.runStatus, [id]: message } }));
    } else if (payload.event === "text_delta") {
      const text = (payload.data as { text?: string }).text ?? "";
      set((state) => ({ streams: { ...state.streams, [id]: (state.streams[id] ?? "") + text } }));
    } else if (payload.event === "tool_start") {
      const data = payload.data as { id?: string; name?: string; input?: unknown };
      set((state) => ({ liveTools: { ...state.liveTools, [id]: [...(state.liveTools[id] ?? []), { id: data.id ?? crypto.randomUUID(), name: data.name ?? "工具", detail: data.input, status: "running" }] } }));
    } else if (payload.event === "tool_result") {
      const data = payload.data as { toolUseId?: string; content?: unknown; isError?: boolean };
      set((state) => ({ liveTools: { ...state.liveTools, [id]: (state.liveTools[id] ?? []).map((tool) => tool.id === data.toolUseId ? { ...tool, detail: data.content, status: data.isError ? "error" : "done" } : tool) } }));
    } else if (payload.event === "permission_request") {
      set({ permission: { conversationId: id, request: payload.data as PermissionRequest } });
    } else if (["completed", "cancelled", "error"].includes(payload.event)) {
      set((state) => ({
        running: { ...state.running, [id]: false },
        runStatus: { ...state.runStatus, [id]: "" },
        liveTools: { ...state.liveTools, [id]: [] },
        permission: state.permission?.conversationId === id ? null : state.permission,
      }));
      if (payload.event === "error") set({ error: (payload.data as { message?: string }).message ?? "Claude CLI 运行失败" });
      if (get().activeId === id) set({ messages: await api.listMessages(id) });
      set({ conversations: await api.listConversations() });
    }
  },

  answerPermission: async (allow) => {
    const permission = get().permission;
    if (!permission) return;
    try {
      await api.respondPermission(permission.conversationId, permission.request.id, allow, permission.request.input);
      set({ permission: null });
    } catch (error) { set({ error: String(error) }); }
  },

  clearError: () => set({ error: null }),
}));

import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import remarkGfm from "remark-gfm";
import {
  AlertCircle, Bot, Check, ChevronDown, ChevronRight, Folder, FolderOpen,
  Menu, MessageSquarePlus, MoreHorizontal, PanelLeftClose, Puzzle, RefreshCw, Save, Search, Send, Settings2, ShieldCheck,
  Square, TerminalSquare, Trash2, X,
} from "lucide-react";
import { useAppStore } from "./store";
import { api } from "./lib/tauri";
import type { ClaudeGeneralConfig, ClaudeGeneralConfigPatch, ConversationSearchResult, InstalledSkill, Message, PermissionMode, StreamEvent } from "./types";

const EMPTY_CONFIG: ClaudeGeneralConfig = { path: "", defaultModel: "", sonnetModel: "", opusModel: "", haikuModel: "", fableModel: "" };
const editableConfig = (config: ClaudeGeneralConfig): ClaudeGeneralConfigPatch => ({
  defaultModel: config.defaultModel,
  sonnetModel: config.sonnetModel,
  opusModel: config.opusModel,
  haikuModel: config.haikuModel,
  fableModel: config.fableModel,
});

const PERMISSIONS: { value: PermissionMode; label: string }[] = [
  { value: "default", label: "每次确认" },
  { value: "acceptEdits", label: "自动接受编辑" },
  { value: "plan", label: "仅规划" },
  { value: "dontAsk", label: "拒绝未授权工具" },
];

function ClaudeMark({ size = 18 }: { size?: number }) {
  return <svg className="claude-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fillRule="nonzero" />
  </svg>;
}

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("markup", markup);
SyntaxHighlighter.registerLanguage("html", markup);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);

function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className ?? "");
      return match ? <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">{String(children).replace(/\n$/, "")}</SyntaxHighlighter>
        : <code className={className} {...props}>{children}</code>;
    },
  }}>{children}</ReactMarkdown>;
}

function ToolMessage({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(message.content); } catch { data = { content: message.content }; }
  const label = message.metadata === "tool_result" ? "工具返回" : String(data.name ?? "工具调用");
  return <div className="tool-row">
    <button className="tool-summary" onClick={() => setOpen(!open)}>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      <TerminalSquare size={15} /><span>{label}</span>
    </button>
    {open && <pre>{JSON.stringify(data, null, 2)}</pre>}
  </div>;
}

function MessageView({ message }: { message: Message }) {
  if (message.kind === "tool") return <ToolMessage message={message} />;
  if (message.kind === "error") return <div className="inline-error"><AlertCircle size={16} />{message.content}</div>;
  let durationMs: number | null = null;
  if (message.role === "assistant" && message.metadata) {
    try { durationMs = JSON.parse(message.metadata).durationMs ?? null; } catch { durationMs = null; }
  }
  const durationLabel = durationMs == null ? null : durationMs < 1000 ? `${durationMs} 毫秒` : `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)} 秒`;
  return <article className={`message ${message.role}`}>
    <div className="message-body">
      <div className="message-author">{message.role === "user" ? "你" : "Claude"}</div>
      {message.role === "assistant" ? <Markdown>{message.content}</Markdown> : <p>{message.content}</p>}
      {durationLabel && <div className="message-duration">处理用时 {durationLabel}</div>}
    </div>
  </article>;
}

function SkillsView({ skills, loading }: { skills: InstalledSkill[]; loading: boolean }) {
  if (loading) return <div className="skills-empty"><RefreshCw className="spin" size={22} /><span>正在读取已安装 Skills...</span></div>;
  if (!skills.length) return <div className="skills-empty"><Puzzle size={25} /><h2>未检测到已安装 Skills</h2></div>;
  return <div className="skills-scroll"><div className="skills-content">
    <div className="skills-heading"><span>{skills.length} 个已安装</span></div>
    <div className="skills-list">{skills.map((skill) => <article className="skill-item" key={`${skill.scope}:${skill.path}`}>
      <div className="skill-icon"><Puzzle size={17} /></div>
      <div className="skill-copy"><div className="skill-title"><strong>{skill.name}</strong><span className={`skill-scope ${skill.scope}`}>{skill.scope === "project" ? "项目" : skill.scope === "plugin" ? "插件" : "用户"}</span></div>
        <p>{skill.description || "此 Skill 未提供描述。"}</p><small title={skill.path}>{skill.source} · {skill.path}</small>
      </div>
    </article>)}</div>
  </div></div>;
}

function ConfigView({ config, draft, saving, saved, onChange, onSave }: {
  config: ClaudeGeneralConfig | null;
  draft: ClaudeGeneralConfigPatch;
  saving: boolean;
  saved: boolean;
  onChange: (patch: Partial<ClaudeGeneralConfigPatch>) => void;
  onSave: () => void;
}) {
  if (!config) return <div className="skills-empty"><RefreshCw className="spin" size={22} /><span>正在读取通用配置...</span></div>;
  const fields: { key: keyof ClaudeGeneralConfigPatch; label: string; hint: string }[] = [
    { key: "defaultModel", label: "默认模型", hint: "例如 opus[1m] 或完整模型 ID" },
    { key: "sonnetModel", label: "Sonnet 对应模型", hint: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
    { key: "opusModel", label: "Opus 对应模型", hint: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
    { key: "haikuModel", label: "Haiku 对应模型", hint: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
    { key: "fableModel", label: "Fable 对应模型", hint: "ANTHROPIC_DEFAULT_FABLE_MODEL" },
  ];
  return <div className="config-scroll"><div className="config-content">
    <section className="config-section"><div className="config-heading"><h2>模型配置</h2></div>
      <div className="config-form">{fields.map((field) => <label className="config-field" key={field.key}>
        <span>{field.label}</span><input value={draft[field.key]} placeholder={field.hint} onChange={(event) => onChange({ [field.key]: event.target.value })} />
        <small>{field.hint}</small>
      </label>)}</div>
    </section>
    <div className="config-note"><Settings2 size={15} /><div><strong>用户级通用配置</strong><span>{config.path}</span></div></div>
    <div className="config-actions"><button onClick={onSave} disabled={saving}><Save size={15} />{saving ? "保存中..." : saved ? "已保存" : "保存配置"}</button></div>
  </div></div>;
}

function App() {
  const store = useAppStore();
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "skills" | "config">("chat");
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [claudeConfig, setClaudeConfig] = useState<ClaudeGeneralConfig | null>(null);
  const [configDraft, setConfigDraft] = useState<ClaudeGeneralConfigPatch>(EMPTY_CONFIG);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ConversationSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const active = store.conversations.find((item) => item.id === store.activeId) ?? null;
  const isRunning = active ? !!store.running[active.id] : false;
  const stream = active ? store.streams[active.id] ?? "" : "";
  const runStatus = active ? store.runStatus[active.id] || "正在思考..." : "正在思考...";
  const liveTools = active ? store.liveTools[active.id] ?? [] : [];

  useEffect(() => {
    store.initialize();
    api.getClaudeConfig()
      .then((config) => { setClaudeConfig(config); setConfigDraft(editableConfig(config)); })
      .catch((error) => useAppStore.setState({ error: String(error) }));
  }, []);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    listen<StreamEvent>("claude-stream", (event) => store.handleStream(event.payload)).then((fn) => { dispose = fn; });
    return () => dispose?.();
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [store.messages, stream, liveTools, runStatus]);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);
  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      api.searchConversations(searchQuery.trim())
        .then((results) => {
          if (!cancelled) { setSearchResults(results); setSearchIndex(0); }
        })
        .catch((error) => { if (!cancelled) useAppStore.setState({ error: String(error) }); })
        .finally(() => { if (!cancelled) setSearchLoading(false); });
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [searchOpen, searchQuery]);

  const grouped = useMemo(() => {
    const today: typeof store.conversations = [], earlier: typeof store.conversations = [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    store.conversations.forEach((item) => (new Date(item.updatedAt) >= start ? today : earlier).push(item));
    return [{ title: "今天", items: today }, { title: "更早", items: earlier }].filter((group) => group.items.length);
  }, [store.conversations]);

  const submit = () => {
    const value = input.trim();
    if (!value || !active || isRunning) return;
    setInput(""); store.send(value);
  };

  const openSkills = async () => {
    setView("skills");
    setSkillsLoading(true);
    try { setSkills(await api.listInstalledSkills(active?.projectPath)); }
    catch (error) { useAppStore.setState({ error: String(error) }); }
    finally { setSkillsLoading(false); }
  };

  const openConfig = async () => {
    setView("config");
    try {
      const config = await api.getClaudeConfig();
      setClaudeConfig(config);
      setConfigDraft(editableConfig(config));
      setConfigSaved(false);
    } catch (error) { useAppStore.setState({ error: String(error) }); }
  };

  const saveConfig = async () => {
    setConfigSaving(true);
    try {
      const config = await api.saveClaudeConfig(configDraft);
      setClaudeConfig(config);
      setConfigDraft(editableConfig(config));
      setConfigSaved(true);
    } catch (error) { useAppStore.setState({ error: String(error) }); }
    finally { setConfigSaving(false); }
  };

  const modelOptions = [
    { value: "sonnet", name: "Sonnet", model: claudeConfig?.sonnetModel },
    { value: "opus", name: "Opus", model: claudeConfig?.opusModel },
    { value: "haiku", name: "Haiku", model: claudeConfig?.haikuModel },
    { value: "fable", name: "Fable", model: claudeConfig?.fableModel },
  ].map((option) => ({ ...option, label: option.model ? `${option.name} · ${option.model}` : option.name }));

  const selectSearchResult = async (result: ConversationSearchResult) => {
    setSearchOpen(false);
    setView("chat");
    await store.selectConversation(result.conversation.id);
  };

  if (store.loading) return <div className="loading"><Bot size={28} /><span>正在打开工作台...</span></div>;

  return <div className="app-shell">
    <aside className={sidebarOpen ? "sidebar" : "sidebar collapsed"}>
      <div className="brand-row">
        <div className="brand"><div className="brand-mark"><ClaudeMark /></div><span>Claude Desk</span></div>
        <div className="brand-actions"><button className="icon-button" title="搜索会话" onClick={() => { setSearchQuery(""); setSearchOpen(true); }}><Search size={17} /></button><button className="icon-button" title="收起侧栏" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button></div>
      </div>
      <div className="primary-nav">
        <button className="nav-command" onClick={() => { setView("chat"); store.createConversation(); }}><MessageSquarePlus size={17} />新建任务</button>
        <button className={`nav-command ${view === "skills" ? "active" : ""}`} onClick={openSkills}><Puzzle size={17} />Skills</button>
      </div>
      <nav className="session-list">
        {grouped.map((group) => <section key={group.title}>
          <div className="section-label">{group.title === "今天" ? "最近任务" : group.title}</div>
          {group.items.map((item) => <div key={item.id} className={`session-item ${item.id === store.activeId && view === "chat" ? "active" : ""}`} onClick={() => { setView("chat"); store.selectConversation(item.id); }}>
            <div className="session-copy"><span>{item.title}</span><small><Folder size={11} />{item.projectPath.split(/[\\/]/).pop()}</small></div>
            <button className="session-menu" title="会话菜单" onClick={(event) => { event.stopPropagation(); setMenuId(menuId === item.id ? null : item.id); }}><MoreHorizontal size={16} /></button>
            {menuId === item.id && <div className="popover"><button onClick={(event) => { event.stopPropagation(); store.deleteConversation(item.id); setMenuId(null); }}><Trash2 size={14} />删除会话</button></div>}
          </div>)}
        </section>)}
      </nav>
      <button className={`cli-status ${store.cliStatus?.found ? "ok" : "bad"} ${view === "config" ? "active" : ""}`} title="打开通用配置" onClick={openConfig}>
        <div className="user-avatar">C</div><div><strong>{store.cliStatus?.found ? "本地 Claude" : "CLI 未连接"}</strong><small>{store.cliStatus?.version ?? store.cliStatus?.error}</small></div><span className="status-dot" />
      </button>
    </aside>

    <main className="workspace">
      <header className="topbar">
        {!sidebarOpen && <button className="icon-button" title="展开侧栏" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>}
        {view === "config" ? <div className="topbar-title"><Settings2 size={16} /><span>通用配置</span></div> : view === "skills" ? <><div className="topbar-title"><Puzzle size={16} /><span>Skills</span></div><div className="topbar-controls"><button className="icon-button framed" title="刷新 Skills" onClick={openSkills} disabled={skillsLoading}><RefreshCw className={skillsLoading ? "spin" : ""} size={15} /></button></div></> : active ? <>
          <button className="project-path" onClick={store.chooseDirectory} title="切换项目目录"><FolderOpen size={16} /><span>{active.title}</span><MoreHorizontal size={15} /></button>
          <div className="topbar-controls">
            <button className="location-button" onClick={() => api.chooseApplicationAndOpen(active.projectPath).catch((error) => useAppStore.setState({ error: String(error) }))}><FolderOpen size={15} />选择程序打开<ChevronDown size={14} /></button>
          </div>
        </> : <div className="topbar-empty">选择或新建一个会话</div>}
      </header>

      {view === "config" ? <ConfigView config={claudeConfig} draft={configDraft} saving={configSaving} saved={configSaved} onChange={(patch) => { setConfigSaved(false); setConfigDraft((current) => ({ ...current, ...patch })); }} onSave={saveConfig} /> : view === "skills" ? <SkillsView skills={skills} loading={skillsLoading} /> : !active ? <div className="empty-state"><div className="empty-icon"><Bot size={30} /></div><h1>从一个项目开始</h1><p>选择本地代码目录，Claude 将在该目录中读取、修改和运行代码。</p><button onClick={store.createConversation}><FolderOpen size={17} />选择项目目录</button></div>
      : <>
        <div className="chat-scroll">
          {store.messages.length === 0 && !isRunning ? <div className="conversation-start"><div className="eyebrow">当前项目</div><h1>{active.projectPath.split(/[\\/]/).pop()}</h1><p>{active.projectPath}</p><div className="starter-grid"><button onClick={() => setInput("分析这个项目的架构，并指出最值得优先改进的地方")}>分析项目架构</button><button onClick={() => setInput("检查当前代码并修复测试或构建错误")}>检查并修复问题</button><button onClick={() => setInput("阅读项目文档，告诉我如何运行这个项目")}>如何运行项目</button></div></div>
          : <div className="message-column">
            {store.messages.map((message) => <MessageView key={message.id} message={message} />)}
            {liveTools.map((tool) => <div className="live-tool" key={tool.id}><span className={`tool-state ${tool.status}`} /> <TerminalSquare size={15} /><span>{tool.name}</span><small>{tool.status === "running" ? "执行中" : tool.status === "done" ? "已完成" : "失败"}</small></div>)}
            {isRunning && <article className="message assistant streaming"><div className="message-body"><div className="message-author">Claude <span className="thinking-dot" /></div>{stream ? <Markdown>{stream}</Markdown> : <p className="muted">{runStatus}</p>}</div></article>}
            <div ref={bottomRef} />
          </div>}
        </div>
        <div className="composer-wrap"><div className="composer">
          <textarea value={input} disabled={isRunning || !store.cliStatus?.found} placeholder={store.cliStatus?.found ? "描述任务，@ 文件，或让 Claude 修改代码..." : "请先安装并登录 Claude CLI"} rows={1} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} />
          <div className="composer-footer"><div className="composer-context"><div className="context-label"><Folder size={14} /><span>{active.projectPath.split(/[\\/]/).pop()}</span></div><label className="composer-permission" title="权限模式"><ShieldCheck size={13} /><select value={active.permissionMode} disabled={isRunning} onChange={(e) => store.updateActive({ permissionMode: e.target.value as PermissionMode })}>{PERMISSIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={12} /></label></div><div className="composer-actions"><label className="composer-model" title="切换模型"><Bot size={14} /><select value={active.model} disabled={isRunning} onChange={(e) => store.updateActive({ model: e.target.value })}>{modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} /></label>{isRunning ? <button className="stop-button" title="停止生成" onClick={store.stop}><Square size={14} fill="currentColor" /></button> : <button className="send-button" title="发送消息" disabled={!input.trim() || !store.cliStatus?.found} onClick={submit}><Send size={17} /></button>}</div></div>
        </div><div className="composer-hint">Enter 发送 · Shift + Enter 换行 · Claude 可访问当前项目目录</div></div>
      </>}
    </main>

    {searchOpen && <div className="search-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSearchOpen(false); }}>
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="搜索会话">
        <div className="search-input-row"><Search size={17} /><input ref={searchInputRef} value={searchQuery} placeholder="搜索会话、项目或消息" onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); if (searchResults.length) setSearchIndex((index) => Math.min(index + 1, searchResults.length - 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setSearchIndex((index) => Math.max(index - 1, 0)); }
          else if (event.key === "Enter" && searchResults[searchIndex]) { event.preventDefault(); selectSearchResult(searchResults[searchIndex]); }
        }} /><button title="关闭搜索" onClick={() => setSearchOpen(false)}><X size={16} /></button></div>
        <div className="search-result-header"><span>{searchQuery.trim() ? "搜索结果" : "最近会话"}</span>{searchLoading && <RefreshCw className="spin" size={12} />}</div>
        <div className="search-results">{!searchLoading && !searchResults.length ? <div className="search-empty">没有找到匹配的会话</div> : searchResults.map((result, index) => <button key={result.conversation.id} className={index === searchIndex ? "active" : ""} onMouseEnter={() => setSearchIndex(index)} onClick={() => selectSearchResult(result)}>
          <div className="search-result-icon"><Search size={14} /></div><div className="search-result-copy"><strong>{result.conversation.title}</strong><p>{result.snippet}</p><small><Folder size={11} />{result.conversation.projectPath}<span>{result.matchedIn === "message" ? "消息" : result.matchedIn === "path" ? "路径" : "标题"}</span></small></div>
        </button>)}</div>
      </div>
    </div>}
    {store.error && <div className="error-toast"><AlertCircle size={18} /><span>{store.error}</span><button title="关闭" onClick={store.clearError}><X size={16} /></button></div>}
    {store.permission && <div className="modal-backdrop"><div className="permission-dialog" role="dialog" aria-modal="true"><div className="permission-icon"><ShieldCheck size={22} /></div><h2>允许 Claude 使用工具？</h2><p>{store.permission.request.description}</p><div className="permission-tool"><strong>{store.permission.request.toolName}</strong><pre>{JSON.stringify(store.permission.request.input, null, 2)}</pre></div><div className="dialog-actions"><button className="secondary" onClick={() => store.answerPermission(false)}><X size={16} />拒绝</button><button className="primary" onClick={() => store.answerPermission(true)}><Check size={16} />允许本次</button></div></div></div>}
  </div>;
}

export default App;

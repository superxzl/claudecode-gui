import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle, Bot, Check, ChevronDown, Folder, FolderOpen,
  Menu, MessageSquarePlus, MoreHorizontal, PanelLeftClose, Puzzle, RefreshCw, Search, Settings2, ShieldCheck,
  TerminalSquare, Trash2, X,
} from "lucide-react";
import { useAppStore } from "./store";
import { api } from "./lib/tauri";
import { ClaudeMark } from "./components/ClaudeMark";
import { Composer } from "./components/Composer";
import { Markdown, MessageView } from "./components/MessageView";
import { ConfigView, SkillsView } from "./components/SettingsViews";
import type { ClaudeGeneralConfig, ClaudeGeneralConfigPatch, ConversationSearchResult, InstalledSkill, StreamEvent } from "./types";

const EMPTY_CONFIG: ClaudeGeneralConfig = { path: "", defaultModel: "", sonnetModel: "", opusModel: "", haikuModel: "", fableModel: "" };
const editableConfig = (config: ClaudeGeneralConfig): ClaudeGeneralConfigPatch => ({
  defaultModel: config.defaultModel,
  sonnetModel: config.sonnetModel,
  opusModel: config.opusModel,
  haikuModel: config.haikuModel,
  fableModel: config.fableModel,
});

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
        <Composer active={active} value={input} isRunning={isRunning} cliFound={!!store.cliStatus?.found} modelOptions={modelOptions} onChange={setInput} onSubmit={submit} onStop={store.stop} onUpdate={store.updateActive} />
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

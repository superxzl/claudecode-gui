import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import remarkGfm from "remark-gfm";
import { AlertCircle, ChevronDown, ChevronRight, TerminalSquare } from "lucide-react";
import type { Message } from "../types";

for (const [name, language] of Object.entries({ bash, css, javascript, js: javascript, json, markup, html: markup, python, rust, typescript, ts: typescript })) {
  SyntaxHighlighter.registerLanguage(name, language);
}

function useSystemDarkTheme() {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => typeof window.matchMedia !== "function" || window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return dark;
}

export function Markdown({ children }: { children: string }) {
  const dark = useSystemDarkTheme();
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className ?? "");
      return match ? <SyntaxHighlighter style={dark ? oneDark : oneLight} language={match[1]} PreTag="div">{String(children).replace(/\n$/, "")}</SyntaxHighlighter>
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
    <button className="tool-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      <TerminalSquare size={15} /><span>{label}</span>
    </button>
    {open && <pre>{JSON.stringify(data, null, 2)}</pre>}
  </div>;
}

export function MessageView({ message }: { message: Message }) {
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

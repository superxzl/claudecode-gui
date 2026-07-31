import { useLayoutEffect, useRef } from "react";
import { Bot, ChevronDown, Folder, Send, ShieldCheck, Square } from "lucide-react";
import type { Conversation, PermissionMode } from "../types";

export const PERMISSIONS: { value: PermissionMode; label: string }[] = [
  { value: "default", label: "每次确认" },
  { value: "acceptEdits", label: "自动接受编辑" },
  { value: "plan", label: "仅规划" },
  { value: "dontAsk", label: "拒绝未授权工具" },
];

export function resizeComposerTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "0px";
  const height = Math.min(Math.max(textarea.scrollHeight, 67), 170);
  textarea.style.height = `${height}px`;
  textarea.style.overflowY = textarea.scrollHeight > 170 ? "auto" : "hidden";
}

export function Composer({ active, value, isRunning, cliFound, modelOptions, onChange, onSubmit, onStop, onUpdate }: {
  active: Conversation;
  value: string;
  isRunning: boolean;
  cliFound: boolean;
  modelOptions: { value: string; label: string }[];
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onUpdate: (patch: { model?: string; permissionMode?: PermissionMode }) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (textareaRef.current) resizeComposerTextarea(textareaRef.current);
  }, [value]);

  return <div className="composer-wrap"><div className="composer">
    <textarea ref={textareaRef} value={value} disabled={isRunning || !cliFound} placeholder={cliFound ? "描述任务，@ 文件，或让 Claude 修改代码..." : "请先安装并登录 Claude CLI"} rows={1} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSubmit(); }
    }} />
    <div className="composer-footer"><div className="composer-context"><div className="context-label"><Folder size={14} /><span>{active.projectPath.split(/[\\/]/).pop()}</span></div><label className="composer-permission" title="权限模式"><ShieldCheck size={13} /><select value={active.permissionMode} disabled={isRunning} onChange={(event) => onUpdate({ permissionMode: event.target.value as PermissionMode })}>{PERMISSIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={12} /></label></div><div className="composer-actions"><label className="composer-model" title="切换模型"><Bot size={14} /><select value={active.model} disabled={isRunning} onChange={(event) => onUpdate({ model: event.target.value })}>{modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} /></label>{isRunning ? <button className="stop-button" title="停止生成" onClick={onStop}><Square size={14} fill="currentColor" /></button> : <button className="send-button" title="发送消息" disabled={!value.trim() || !cliFound} onClick={onSubmit}><Send size={17} /></button>}</div></div>
  </div><div className="composer-hint">Enter 发送 · Shift + Enter 换行 · Claude 可访问当前项目目录</div></div>;
}

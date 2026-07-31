import { Puzzle, RefreshCw, Save, Settings2 } from "lucide-react";
import type { ClaudeGeneralConfig, ClaudeGeneralConfigPatch, InstalledSkill } from "../types";

export function SkillsView({ skills, loading }: { skills: InstalledSkill[]; loading: boolean }) {
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

export function ConfigView({ config, draft, saving, saved, onChange, onSave }: {
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

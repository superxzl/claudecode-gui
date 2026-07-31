# AI 使用说明

## 1. 使用的模型与 Agent

- 本项目由 Codex（GPT-5 系列执行代理）协作完成，负责代码阅读、实现、调试、构建和验证。
- 没有额外启动子 Agent；所有修改由主 Agent 在同一工作区完成，避免并行修改同一套 Tauri/React 文件产生冲突。
- 对话模型由用户本机已安装的 Claude CLI 提供。GUI 不内置 Claude 模型或 API：Sonnet、Opus、Haiku、Fable 只是 CLI 选择项，实际模型 ID 从 `~/.claude/settings.json` 的映射读取并显示。

## 2. 使用的 Skill、组件与工具

### Skill

本次没有调用额外的 Codex Skill 包。实现遵循仓库内的 `AGENTS.md`、`CLAUDE.md` 和 `DESIGN.md` 约束；Claude Desk 自身的 Skills 列表功能则扫描用户级、项目级和已安装插件中的 `SKILL.md`。

### 前端组件

- React 19 + TypeScript：工作台、会话列表、聊天、配置和搜索视图。
- Vite：开发服务器和生产前端构建。
- Zustand：会话、消息、流状态、权限状态和运行状态。
- `react-markdown` + `remark-gfm`：Markdown/GFM 渲染。
- `react-syntax-highlighter` + Prism：代码块高亮。
- `lucide-react`：导航、搜索、文件、模型、配置等图标。

### Tauri/Rust 组件

- Tauri 2：桌面窗口、IPC command 和事件通道。
- Tokio：Claude CLI 子进程、异步 stdout/stderr、取消和超时。
- `rusqlite` bundled：本地会话和消息持久化，以及标题/路径/消息全文搜索。
- `serde` / `serde_json`：IPC 数据和 Claude `stream-json` 事件。
- `rfd`：跨平台项目目录和外部程序选择器。

### 工具

使用了 `rg`、`sed`、`find`、`jq`、`apply_patch`、npm/Vite、Cargo、Git、Tauri CLI、macOS `codesign`、OrbStack/Docker 进行代码搜索、编辑、构建、测试和产物检查。没有通过 WebView 暴露通用 shell，也没有引入 Anthropic API。

## 3. AI 生成内容出现过的问题与修正

| 问题 | 原因 | 修正与验证 |
| --- | --- | --- |
| `--permission-mode manual` 报参数无效 | 当前 CLI 只接受 `default`、`acceptEdits`、`bypassPermissions`、`dontAsk`、`plan`、`auto` | 数据迁移和后端规范化把旧值 `manual` 转为 `default`；加入 Rust 测试 |
| 首轮发送后长期显示“正在思考” | `--input-format stream-json` 在当前 CLI 环境中静默等待 | 改用 `claude -p <prompt> --output-format stream-json --include-partial-messages`，stdin 只保留权限响应 |
| Claude 已回答但 GUI 仍显示运行中 | 只等待 `result` 才结束输入会造成双方互等 | 在最终 `message_delta.stop_reason` 到达时关闭 stdin，并处理 `completed/error/cancelled`；增加 120 秒无有效进展和 10 分钟整轮看门狗 |
| 失败首轮后下一轮错误使用 `--resume` | GUI 过早假定 Claude session 已初始化 | 只有收到 `system/init` 才标记可恢复，并增加恢复状态字段 |
| 多个 Claude 安装导致参数/流行为不一致 | GUI PATH 与终端 PATH 不同，Homebrew 旧版本可能被优先选中 | 收集候选并选择版本最高者，支持 `CLAUDE_DESK_CLI` 显式指定；用实际 CLI 版本检查 |
| 模型下拉只显示别名 | Claude 配置中的别名映射没有进入前端 | 增加安全配置 IPC，显示真实模型 ID；保存时只更新模型字段，测试认证令牌和未知字段保持不变 |
| Skills 列表容易混入未安装插件市场内容 | 直接递归扫描插件市场目录会把缓存/源码误判为已安装 | 仅扫描 `.claude/skills` 和 `installed_plugins.json` 中的 `installPath`，按 canonical path 去重 |
| 搜索初版只能过滤当前会话标题 | 前端没有历史消息索引 | 将标题、项目路径和消息正文查询放入 SQLite，增加 LIKE 通配符转义、摘要截断和查询测试 |
| UI 与 Codex 风格不一致 | 早期只做了局部颜色调整 | 重建侧栏、聊天消息方向、配置/Skills 页面和固定输入区，并做前端构建检查 |
| 网关异常时长期显示“正在思考” | Claude CLI 遇到 502 会持续产生重试事件，旧的 180 秒计时器在每次事件后重新创建 | 识别 `system/api_retry` 并显示真实重试状态；改为 120 秒无有效进展和 10 分钟整轮上限两个绝对截止时间，重试日志不再延长等待 |

## 4. 检查方式

- `npm run check`：TypeScript、Vite 生产构建和 Rust `cargo check`。
- `cargo test --manifest-path src-tauri/Cargo.toml`：CLI 协议、配置字段保护、Skills 元数据、SQLite 搜索共 8 个测试。
- `npm run tauri build`：已在 Apple Silicon macOS 生成 `.app` 和 `.dmg`，并用 `file`、`codesign` 检查架构和签名状态。
- 运行中的开发服务保持在 `http://localhost:1420/`，Tauri 热重载进程能够重新启动。

## 5. 已知限制

- macOS 产物当前为 ad-hoc 签名，未使用 Apple Developer 证书公证。
- Windows/Linux 的最终安装包需要对应平台 runner 或发行环境；仓库保留跨平台 Rust 代码和 Tauri bundle 配置，但不会伪造未验证的安装包结果。

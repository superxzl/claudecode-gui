# Claude Desk 设计说明

## 1. 产品边界

Claude Desk 是本机 Claude Code CLI 的图形外壳。它负责工作目录、会话、展示和进程生命周期，但不拥有模型服务。

明确边界：

- 不内置 Claude 二进制，不负责 CLI 升级。
- 不内置或采集 API Key，不直接访问 Anthropic API。
- 不绕过 Claude CLI 的登录和权限体系。
- 项目文件由外部 CLI 在用户选择的目录中访问，GUI 自身不实现文件编辑器。

## 2. 架构

```text
React WebView
  SessionList / Chat / Composer / PermissionDialog
        | invoke commands + claude-stream events
        v
Tauri Rust process
  Commands -> SQLite repository
           -> Claude process supervisor
                 | stdin control responses
                 | stdout stream-json
                 v
          user-installed claude CLI
```

### 前端职责

- Zustand 保存当前视图、运行状态和临时增量文本。
- Tauri command 执行会话 CRUD、历史内容搜索、目录选择、发送、停止、权限响应、已安装 Skills 查询和用户级模型配置读写。
- 单一 `claude-stream` 事件通道承载带会话 ID、run ID 的结构化事件。
- React Markdown 只渲染回答；工具信息使用独立可展开行，避免把执行日志混入正文。

### Rust 职责

- `db.rs` 是唯一 SQL 边界，数据库采用 WAL 模式并启用外键。
- 会话搜索由 SQLite 对标题、项目路径和消息正文统一查询，WebView 只接收最多 50 条带摘要的匹配结果。
- `cli.rs` 收集登录 Shell、`~/.local/bin`、Homebrew 等位置的 CLI 候选并选择版本最高者，解决 GUI PATH 顺序与终端不同、重复安装时误用旧版本的问题。可通过 `CLAUDE_DESK_CLI` 显式指定路径。
- `skills.rs` 只读扫描当前项目和用户级 `.claude/skills`，并依据 Claude 的 `installed_plugins.json` 读取已安装插件附带的 Skills；不会把仅下载的插件市场内容当作已安装。
- `config.rs` 只向前端暴露模型别名映射和默认模型，保存时合并写回 `~/.claude/settings.json`；认证、API 地址和未知字段不会进入 WebView，也不会被覆盖。
- 每个 GUI 会话同时最多运行一个子进程。停止信号只作用于对应 child handle。
- 首轮使用预生成 UUID 的 `--session-id`，后续轮次使用 `--resume`，CLI 上下文与 GUI 会话一一映射。
- stdout 按行解析 Claude CLI 的 `stream-json`；stderr 仅在异常退出时作为诊断信息持久化。
- 实时输入会在最终 `message_delta.stop_reason` 到达时关闭；CLI 随后发送 `result` 并退出，GUI 再结束“回答中”状态。不能等待 `result` 后才关闭 stdin，否则双方会互相等待。
- 主请求使用 Claude CLI 原生 `-p <prompt>` 参数，输出仍采用 `stream-json`；只有 `default` 权限模式保留 stdin 用于 control response，其他模式发送后立即 EOF。
- 运行监管使用双重绝对截止时间：120 秒内没有正文、工具、权限请求或最终结果等有效进展时终止，整轮最长 10 分钟。普通日志和 `system/api_retry` 只更新“上游服务重试中”状态，不会重置有效进展计时，避免网关持续报错时界面永久停在“正在思考”。

### 数据模型

`conversations` 保存 GUI ID、Claude session ID、CLI 初始化状态、标题、项目路径、模型、权限模式和时间戳。`messages` 保存角色、消息种类、正文、可选元数据和时间戳。只有收到 CLI 的 `system/init` 事件后，会话才会在下一轮使用 `--resume`；启动参数错误不会制造不可恢复的假会话。

SQLite 保存的是 GUI 可复现历史；Claude CLI 自己的 session 仍是恢复模型上下文的事实来源。两者分开能避免解析或篡改 CLI 私有存储格式。

## 3. 技术选型理由

| 选择 | 理由 |
| --- | --- |
| Tauri 2 | 安装包小、原生进程控制明确、Rust 后端适合长驻异步 I/O，权限面比通用 Node 桌面容器更窄 |
| React 19 + TypeScript | 流式 UI 状态和组件生态成熟；项目后续接入 shadcn 组件也不需要更换框架 |
| Zustand | 状态只有会话、消息和运行流，不需要 Redux 的样板和中间件体系 |
| Rust `tokio::process` | 能直接管理 stdin/stdout、取消与退出状态；无需通过 shell 拼接用户输入 |
| `stream-json` | Claude CLI 官方公开参数提供结构化增量消息；比解析 ANSI、光标控制和终端提示符稳定 |
| `rusqlite` bundled | 数据库由应用后端独占，迁移与事务边界清楚；用户无需安装 SQLite |
| `rfd` | 提供三平台原生目录选择器，避免扩大 Tauri 插件权限 |

## 4. 文件结构

```text
.
├── AGENTS.md                 # 通用 AI 编码协作规则
├── CLAUDE.md                 # Claude Code 进入仓库时的上下文
├── DESIGN.md                 # 本文，架构和取舍的事实来源
├── README.md                 # 安装、运行和产品能力
├── src/
│   ├── App.tsx               # 工作台界面和流事件订阅
│   ├── store.ts              # Zustand 行为与临时运行状态
│   ├── types.ts              # 前后端 IPC 类型
│   ├── styles.css            # 响应式桌面视觉系统
│   └── lib/tauri.ts          # command 调用边界
└── src-tauri/
    ├── capabilities/         # Tauri 最小权限声明
    ├── src/
    │   ├── cli.rs            # CLI 发现、进程监管和事件解析
    │   ├── config.rs         # 用户级 Claude 模型配置安全读写
    │   ├── db.rs             # SQLite schema 与 repository
    │   ├── models.rs         # IPC 序列化模型
    │   ├── skills.rs         # 已安装 Skills 发现与元数据读取
    │   ├── lib.rs            # commands、状态装配
    │   └── main.rs           # 桌面入口
    └── tauri.conf.json       # 窗口、安全和打包配置
```

## 5. 主动放弃的方案

### 不把 PTY 作为主通信层

PTY 很适合复刻完整终端，但不适合把 TUI 输出稳定转换成聊天数据。Claude 的交互界面包含 ANSI 样式、光标移动、重绘和随版本变化的提示文案；直接解析会让模型回答、工具日志和权限提示彼此污染。

当前方案改用 CLI 已公开的 `--output-format stream-json --include-partial-messages`，并保留 stdin 用于 control response。代价是无法原样支持所有斜杠命令和完整终端插件 UI；收益是跨平台事件一致、消息可可靠持久化、前端无需终端模拟器。

若未来必须提供“完整终端模式”，应新增独立的 `portable-pty + xterm.js` 标签页，而不是替换结构化聊天通道。

### 不使用 `tauri-plugin-shell` 执行 Claude

Shell 插件适合短命令和固定 scope。这里需要动态工作目录、持续读写 stdin/stdout、精确停止单个进程和保存运行状态，因此直接使用 Rust 子进程 API 更清晰，也避免把通用 shell 权限暴露给 WebView。

### 不在前端使用 SQL 插件

让前端直接操作表会把数据库 schema 变成 UI API，并扩大 WebView 权限。当前 command 层虽多一层代码，但可以集中做路径校验、并发限制和后续迁移。

### 首版不做内置代码编辑器和 Git 客户端

它们会显著扩大产品边界，并与用户已有 IDE 重复。首版通过项目目录和 Claude 工具协作完成代码修改，界面专注于会话、审批和执行可见性。

### 不默认提供 `bypassPermissions`

GUI 会让高风险工具操作更容易被忽略。首版只提供手动确认、接受编辑、计划和拒绝未授权工具四种模式，不显示危险跳过权限入口。

## 6. 跨平台策略

- macOS/Linux：通过用户的登录 Shell 执行 `command -v claude`，然后使用绝对路径启动，不继承 shell 字符串执行。
- Windows：使用 `where claude` 获取可执行入口。
- 工作目录作为 `Command.current_dir` 设置；用户消息作为独立参数传递，不做 shell 插值。
- 所有路径在数据库中保存为原始字符串，界面展示时同时兼容 `/` 与 `\\` 分隔符。
- SQLite 使用 bundled 特性，避免依赖系统动态库版本。

## 7. 安全与可靠性

- WebView capability 只启用 `core:default`，没有通用 shell 和文件系统权限。
- Rust 在启动前验证项目目录存在。
- 同一会话禁止并发 run，防止两个进程竞争同一个 Claude session。
- 只有子进程句柄被停止，不按进程名全局杀死 Claude。
- 错误进入系统消息并持久化，正常 stderr 不混入回答。
- CSP 禁止任意远程脚本和网络连接。

## 8. 后续演进

1. 为 CLI JSON 协议增加基于采样 fixture 的解析回归测试。
2. 增加数据库版本表和正式 migration。
3. 提供会话重命名、导出和归档。
4. 增加可选的原始 PTY 终端标签页以承载斜杠命令。
5. 在 Windows、macOS、Linux CI runner 上构建安装包并进行 CLI stub 端到端测试。

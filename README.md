# Claude Desk

Claude Desk 是一个 Tauri 2 + React 19 桌面应用。它只调用用户电脑中已经安装并登录的 `claude` CLI，不打包 Claude、不保存 API Key，也不直接请求 Anthropic API。

## 已实现

- Claude CLI 自动发现与版本检测，兼容 GUI 应用缺少登录 Shell PATH 的情况
- 基于 `stream-json` 的 Markdown 流式聊天与代码高亮
- Sonnet、Opus、Haiku 会话级模型切换
- SQLite 本地持久化会话、消息、项目路径、权限模式和 Claude session ID
- 全局搜索会话标题、项目路径和历史消息内容
- 选择代码仓库作为 Claude 工作目录
- 工具调用过程与结果展示
- 手动权限请求响应，以及 CLI 原生的 `default`、`acceptEdits`、`plan`、`dontAsk` 权限模式
- 停止当前生成，不影响系统中其他 Claude 进程
- 使用 `--resume` 恢复同一个 Claude CLI 上下文
- 查看当前项目、用户目录和已安装插件提供的 Skills
- 显示模型别名对应的真实模型 ID，并通过 UI 编辑用户级通用模型配置
- 响应式桌面工作台布局
- 输入框随内容自动增高，并在达到上限后内部滚动
- 自动跟随系统深色/浅色主题，包括 Markdown 代码高亮
- Vitest 组件测试覆盖输入交互、自动高度和消息渲染

## 环境要求

- Node.js 20+
- Rust stable
- Tauri 2 对应的系统构建依赖
- 用户自行安装并完成登录的 Claude Code CLI

验证 CLI：

```bash
claude --version
claude auth status
```

## 开发

```bash
npm install
npm run tauri dev
```

仅验证 Web 前端与 Rust：

```bash
npm run check
```

只运行前端组件测试：

```bash
npm run test
```

生产构建：

```bash
npm run tauri build
```

## 数据位置

SQLite 数据库由 Tauri 写入当前系统的应用数据目录，文件名为 `claude-desk.sqlite3`。删除 GUI 会话只删除该数据库里的映射和消息，不会删除项目文件，也不会修改 Claude CLI 自己的会话文件。

## 文档

- [架构与设计决策](./DESIGN.md)
- [AI 使用说明](./AI_USAGE.md)
- [AI 协作规则](./AGENTS.md)
- [Claude Code 项目上下文](./CLAUDE.md)

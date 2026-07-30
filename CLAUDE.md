# Claude Desk project context

You are working on a Tauri 2 + React 19 GUI for the user's locally installed and authenticated `claude` command.

Read `DESIGN.md` and `AGENTS.md` before editing. The non-negotiable boundary is that this repository does not contain an Anthropic API integration, credentials, or a Claude binary.

Important paths:

- `src/App.tsx`: desktop workspace UI and event subscription
- `src/store.ts`: frontend session and streaming state
- `src/lib/tauri.ts`: typed IPC calls
- `src-tauri/src/cli.rs`: CLI discovery, child lifecycle, stream JSON parsing
- `src-tauri/src/db.rs`: SQLite persistence
- `src-tauri/src/lib.rs`: Tauri command boundary

Use `npm run check` for routine validation. Process protocol changes also require a real `npm run tauri dev` smoke test. Do not make broad shell or filesystem capabilities available to the WebView.

# AI collaboration rules

## Product invariant

This app is a local GUI for the user's existing Claude CLI. Never add an Anthropic API client, API key field, bundled Claude binary, automatic CLI installer, or remote telemetry without an explicit product decision recorded in `DESIGN.md`.

## Architecture boundaries

- React may call only the typed functions in `src/lib/tauri.ts`.
- Rust owns process lifecycle, filesystem path validation, and SQLite.
- Keep structured chat on Claude CLI `stream-json`. Do not parse ANSI/TUI output into chat messages.
- Do not expose a general shell command to the WebView.
- A GUI conversation maps to exactly one Claude session ID.
- Never kill processes by executable name. Stop only the tracked child for that conversation.

## Change workflow

1. Read `DESIGN.md` before changing process, persistence, permissions, or IPC behavior.
2. Keep TypeScript interfaces and Rust `serde` models aligned in camelCase.
3. Update documentation when a command, data field, permission mode, or architectural boundary changes.
4. Preserve user data: schema changes require a migration and must not drop existing tables.
5. Prefer focused dependencies. Explain any new runtime dependency in `DESIGN.md`.

## Verification

Run before handing off:

```bash
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
```

For process changes, also run `npm run tauri dev` with a locally installed Claude CLI and verify: first message, streamed text, tool event, stop, and second message resume.

## UI conventions

- Keep the interface compact and work-focused.
- Icon-only buttons need a `title` or accessible label.
- Do not mix tool logs into Markdown answer text.
- Keep controls stable while streaming; model, directory, and permission changes are disabled during a run.
- Never add a visible bypass-permissions option as a routine convenience.


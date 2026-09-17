# macOS quickstart

Prerequisites: Node 24+, Rust 1.98+, and Xcode Command Line Tools.

```bash
git clone <repository> swibo
cd swibo
npm run check
(cd src-tauri && cargo test && cargo clippy -- -D warnings)
npm run desktop:build
node src/cli.js daemon status
curl -fsS http://127.0.0.1:17991/api/health
```

Default macOS live state:

```text
~/Library/Application Support/mcp-supervisor/
```

This feature validates repository-local desktop operation. Signing/notarization and distributable DMG packaging are not part of this quickstart.

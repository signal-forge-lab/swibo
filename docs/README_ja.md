# Swibo

[English](README.md)

Swibo は、ローカルで動く開発ツールやサービスを、1つの loopback-only daemon / CLI / Desktop UI から起動・停止・再起動・監視するためのローカルサービス・スイッチボードです。

MCP Server や Secure MCP Tunnel に対応していますが、Supervisor 自体は MCP 専用ではありません。Target ごとに Server、任意の Tunnel、さらに Monitor などの独立 Component を定義できます。

## Dashboard の考え方

各 Target は通常時には1行に圧縮して表示します。

- **Runtime** は、設定された Server / Tunnel の状態を集約した代表状態です。
- **Monitor** は Runtime とは独立した任意 Component です。
- Runtime / Monitor はそれぞれ、状態に応じて切り替わる **Start / Stop** ボタンと **Restart** ボタンを持ちます。
- Target を展開すると、Server / Tunnel の内訳、startup policy、technical status、Target 編集を表示します。

Runtime の主な状態:

- `READY`: 適用対象の Runtime check がすべて ready。
- `DEGRADED`: 適用対象の一部だけ ready。
- `STOPPED`: 適用対象の Runtime check がすべて down。
- `STARTING` / `STOPPING`: lifecycle action 実行中。

## 起動

リポジトリのルートで実行します。

```text
Windows: npm.cmd run desktop
macOS:   npm run desktop
```

Desktop launcher は必要な場合だけ release executable をビルドします。明示的に再ビルドする場合:

```text
Windows: npm.cmd run desktop:build
macOS:   npm run desktop:build
```

Daemon のみ:

```text
node src/cli.js daemon start
```

### Windowsの管理daemon常駐

Swiboは状態表示だけでなく、各Targetの起動・停止・自動起動も担当します。
Tauri Desktop UIとNode.jsのloopback専用daemonは別プロセスで、
UIを閉じてもdaemonを継続できます。

Desktop起動時だけのdaemon起動では、その後のdaemon異常終了を検出できません。
Windowsではタスクスケジューラに管理daemonの所有権を移す運用を推奨します。
ログオン時に起動し、異常終了時に1分間隔で最大30回の再起動を試みます。
正常終了・応答不能のすべてを自動修復する仕組みではありません。

```powershell
pwsh -NoProfile -File scripts/manage-daemon-task.ps1 -Mode Status
pwsh -NoProfile -File scripts/manage-daemon-task.ps1 -Mode Install
```

既存の手動daemonをWindowsタスクへ引き継ぐ場合に限って、
`-Mode Install -AdoptRunning` を使用します。
daemonの所有権だけを移し、管理対象Targetには停止操作を行いません。
既にタスクで稼働中なら同じInstallの再実行は無変更で終了します。
`-Mode Uninstall` はタスク登録を解除します。

稼働確認: `http://127.0.0.1:17991/api/health`

## CLI

```text
node src/cli.js status
node src/cli.js status example-service

node src/cli.js start --all
node src/cli.js stop --all

node src/cli.js start example-service
node src/cli.js restart example-service
node src/cli.js stop example-service

node src/cli.js daemon status
node src/cli.js daemon stop
```

## Registry

Git に含まれる default registry は、意図的に **disabled の汎用サンプル1件だけ**です。

```text
config/config.example.json
```

Swibo は live registry が存在しない初回だけ、この default をコピーします。実運用設定はリポジトリ外のユーザー領域に保存されます。

```text
Windows: %LOCALAPPDATA%\mcp-supervisor\registry.json
macOS:   ~/Library/Application Support/mcp-supervisor/registry.json
```

Registry 内で Swibo の platform 固有 state 領域を参照する場合は `${SWIBO_STATE_HOME}` を利用できます。既存互換のため `${LOCALAPPDATA}` / `${APPDATA}` も引き続き利用できます。

実サービスは UI / API から live registry に追加してください。端末固有パスや認証情報を `config/config.example.json` にコミットしない運用を推奨します。

### MCPではないCLI / daemonツール

SwiboはMCP ServerでないローカルAIユーティリティも、決定的なlifecycleと副作用のないreadiness checkを持つ場合は監督できます。製品固有の処理は対象ツール側に残し、Swiboはprocess lifecycleと状態観測だけを担当します。

たとえばBrowserSkillは、foreground daemonをdetachedなプロセスとして起動し、loopbackのWebSocket portで状態確認し、停止にはBrowserSkill自身のstop commandを使うTargetとして表現できます。

```json
{
  "id": "browser-skill",
  "name": "BrowserSkill",
  "enabled": true,
  "startupPolicy": "auto",
  "lifecycle": {
    "start": [{
      "command": "${HOME}/.local/bin/bsk.exe",
      "args": ["daemon", "start", "--foreground"],
      "detached": true,
      "unlessReady": "server",
      "waitFor": "server"
    }],
    "stop": [
      { "command": "${HOME}/.local/bin/bsk.exe", "args": ["daemon", "stop"] }
    ]
  },
  "checks": {
    "server": { "type": "tcp", "host": "127.0.0.1", "port": 52800 },
    "tunnel": { "type": "none" }
  }
}
```

Swiboは保存済みPIDだけを根拠にサービスを強制終了しません。
旧`kind: "terminate"`と`processKey`はサポート対象外です。
停止時はサービス自身のコマンドでプロセスの同一性を検証してください。

これはlifecycle管理用Targetであり、MCP宣言ではありません。Browser extensionの導入やブラウザ権限確認はSwiboの責務外です。

### 自動起動時の依存関係

自動起動するTargetには、先にREADYになる必要があるTargetを
`"dependsOn": ["workbridge", "cua-driver"]` のように指定できます。
依存先は存在する有効な `auto` Targetに限り、循環参照は許可されません。
無関係なTargetは従来どおり最大3件で並列起動します。依存先の起動が失敗した場合、
そのTargetの自動起動は実行しません。手動Startの動作は変更しません。

## Git とローカル / 非公開データ

Swibo では、開発工程と公開可否を別の責務として管理します。

```text
main
  ↑
develop
  ↑
feature/*
```

- `main` は安定版かつ公開可能なブランチです。
- `develop` は開発途中を含められますが、commit される内容は常に公開可能であることを前提にします。
- `feature/*` は個別機能や修正を分離し、`develop` へ統合するために使います。
- 公開 / 非公開の分離にはブランチを使いません。Secret、PC 固有パス、ローカル専用データは Git 管理外に置きます。
- Public remote は `origin` とします。内部専用ソースが本当に必要になった場合だけ、別の Private Repository を `private` remote として追加します。

Git 管理する公開サンプルは `config/config.example.json` です。`.env`、`config.local.json`、`secrets/`、`local/` はローカル専用として ignore します。実運用 Target の live registry は従来どおりリポジトリ外のユーザー領域に保存されます。

汎用 Target 例:

```json
{
  "id": "example-service",
  "name": "Example Service",
  "enabled": false,
  "startupPolicy": "manual",
  "lifecycle": {
    "start": [
      {
        "command": "node",
        "args": ["scripts/service.js", "start"],
        "cwd": "${HOME}/path/to/example-service",
        "waitFor": "server"
      }
    ],
    "stop": [
      {
        "command": "node",
        "args": ["scripts/service.js", "stop"],
        "cwd": "${HOME}/path/to/example-service"
      }
    ]
  },
  "checks": {
    "server": { "type": "tcp", "host": "127.0.0.1", "port": 8000 },
    "tunnel": { "type": "none" }
  }
}
```

### 対応 Check

- `http`
- `httpUrlFile`
- `tcp`
- `command`
- `pidFile`
- `none`

### Lifecycle のルール

- `command` と `args` は分離し、Registry に shell pipeline を直接書かない。
- `unlessReady` で既に ready の処理をスキップできます。
- `waitFor` で action 後に Server / Tunnel の ready を待機できます。
- Start / Stop は idempotent に実装することを推奨します。
- 対象サービス側に安全な lifecycle wrapper が既にある場合、Swibo 側で再実装せず wrapper に委譲します。
- `monitor` などの Component は Runtime から独立した lifecycle / check を持てます。
- API key、password、OAuth token、tunnel credential などの秘密情報を Registry JSON に保存しないでください。

Registry から Target を削除しても、外部で起動している無関係な process を暗黙に kill しません。

## ローカルセキュリティ境界

Daemon は `127.0.0.1:17991` のみで listen し、Host / Origin も loopback に制限します。各サービスが必要とする credential は、それぞれの wrapper 側で管理し、Swibo が保存する必要はありません。

生成物やローカル runtime state は source control の対象外です。

## 検証

```text
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo build --release --manifest-path src-tauri/Cargo.toml
```

Windows では `npm` の代わりに `npm.cmd` を利用できます。macOS の Desktop 開発には Node、Rust、Xcode Command Line Tools が必要です。現在の launcher はリポジトリから直接起動する開発用途を対象としており、署名・notarization・DMG 配布は別スコープです。

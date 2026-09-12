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

```powershell
npm.cmd run desktop
```

Desktop launcher は必要な場合だけ release executable をビルドします。明示的に再ビルドする場合:

```powershell
npm.cmd run desktop:build
```

Daemon のみ:

```powershell
node .\src\cli.js daemon start
```

## CLI

```powershell
node .\src\cli.js status
node .\src\cli.js status example-service

node .\src\cli.js start --all
node .\src\cli.js stop --all

node .\src\cli.js start example-service
node .\src\cli.js restart example-service
node .\src\cli.js stop example-service

node .\src\cli.js daemon status
node .\src\cli.js daemon stop
```

## Registry

Git に含まれる default registry は、意図的に **disabled の汎用サンプル1件だけ**です。

```text
config/default-registry.json
```

Swibo は live registry が存在しない初回だけ、この default をコピーします。実運用設定はリポジトリ外のユーザー領域に保存されます。

```text
%LOCALAPPDATA%\mcp-supervisor\registry.json
```

実サービスは UI / API から live registry に追加してください。端末固有パスや認証情報を `config/default-registry.json` にコミットしない運用を推奨します。

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

```powershell
npm.cmd run check
cargo test --manifest-path .\src-tauri\Cargo.toml
cargo clippy --manifest-path .\src-tauri\Cargo.toml -- -D warnings
cargo build --release --manifest-path .\src-tauri\Cargo.toml
```

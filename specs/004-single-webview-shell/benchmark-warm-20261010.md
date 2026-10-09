# Warm GUI resource audit, 2026-10-10 01:50–01:52 JST

## Method

The existing standalone Swibo and Loctl GUI windows were left running, with
the real Swibo daemon and Loctl registry unchanged. Three steady-state snapshots
were taken three seconds apart, followed by three snapshots while a separately
launched unified preview had its Launcher tab selected. Per-owner WebView2
process counts, Private Bytes and Working Set were recorded. This is a
**coexistence comparison**, not an exclusive A/B cutover benchmark.

| Configuration | WebView2 PIDs | WebView2 Private | WebView2 Working Set |
|---|---:|---:|---:|
| Standalone Swibo | 6 | 232.7 MB | 221.4 MB |
| Standalone Loctl | 6 | 212.1–214.1 MB | 163.0–165.1 MB |
| Both standalone combined | 12 | 444.8–446.8 MB | 384.4–386.5 MB |
| Both standalone plus unified preview | 13 | 481.2–499.2 MB | 460.1–468.4 MB |

The preview shared the existing Swibo WebView2 user-data directory. It added
one renderer and a separate ~9 MB Tauri host; it **did not** launch a second
Loctl WebView2 instance. Thus the marginal WebView2 Private Bytes in this warm
run were about 36–54 MB. The existing standalone Loctl group (~212 MB Private)
was deliberately left running. The difference is suggestive but **does not
establish actual 176 MB RAM savings**, because shared pages, warm/cold startup
and concurrent view ownership differ.

## Other evidence

- An independent preview launcher runs the existing Swibo daemon and selects
  only a proven headless-compatible Loctl binary. The older Loctl Release
  executable was found to ignore `--headless-rpc` and launch a second GUI,
  hanging the bridge. The launcher now checks source freshness and probes a
  bounded one-shot `registry` RPC **before** choosing the executable. Its
  test process was removed; original GUI processes remained alive.
- Windows UI Automation verified Runtime targets, Launcher modules, search,
  selected module details, Signals, Quick View and returning to Runtime.
- Swibo SSE relay required explicit `core:event:allow-listen` permission.
  After the permission was added, the preview displayed `Live`; an explicit
  non-mutating daemon `POST /api/refresh` updated its timestamp from
  02:01:51 to 02:02:31 without periodic polling.
- The preview session was closed after measurements. Live target lifecycle
  actions and registry mutations were intentionally not performed.

## Remaining resource gate

Perform three cold-start and three warm-start **exclusive** paired trials with
only separate GUIs vs. only merged GUI, using the same underlying daemon and
module interactions. Record CPU (whole-machine and app tree), Private Bytes,
Working Set, WebView2 PID count, first interactive time, and status/action
latency. Roll back to standalone GUIs if parity or security checks fail.

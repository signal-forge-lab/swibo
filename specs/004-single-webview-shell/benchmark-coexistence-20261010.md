# Unified Swibo + Loctl Release: warm coexistence observations, 2026-10-10

## Conditions

- Existing standalone Swibo and Loctl windows remained running; their daemon
  and registries were not modified, and service operations were not invoked.
- Three Windows process snapshots were recorded two seconds apart in each
  configuration: both standalone GUIs, then those same GUIs plus the opt-in
  unified Release preview.
- WebView2 was selected by the related Swibo/Loctl command-line/user-data
  identity. Private and Working Set measurements are summed for those
  WebView2 PIDs only, excluding unrelated Edge/Chrome tabs.
- These are *warm coexistence* measurements, not cold starts, independent
  per-app shared-page accounting or an exclusive A/B cutover trial.

| Observed GUI configuration | WebView2 PIDs | GUI PIDs | WebView2 Private MB | WebView2 Working Set MB |
| --- | ---: | ---: | ---: | ---: |
| Standalone Swibo + standalone Loctl | 12, 12, 12 | 2 | 475.5, 475.5, 475.5 | 476.4, 476.4, 476.4 |
| Both standalone + unified Release | 13, 13, 13 | 3 | 521.4, 513.2, 513.1 | 554.7, 546.5, 546.4 |

After the added preview settled, the incremental related WebView2 Private
Bytes were approximately **37.6 MB**, with Working Set approximately
**70.0 MB** higher. These values are **not a savings estimate** and must not
be subtracted mechanically from the separate-GUI total. The unified shell
shares an existing Swibo WebView2 group in this test.

## Remaining gate

T007 requires three cold and three warm *exclusive*, paired trials. Close
only the GUI windows during a coordinated window, leave the Swibo daemon
and all managed services running, use the same feature interactions for
both configurations, and restore both standalone launchers afterward.
Measure per-owner process counts, Private Bytes, Working Set, app-tree and
whole-system CPU, interactive startup time and non-mutating status/action
latency. Retain actual results rather than theoretical savings. An unattended
benchmark must not discard the user's open GUI state.

# VConsole

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `vconsole_status` | Set `connect:true` to connect/check health; inspect protocol, queue and error fields for the selected `vconPort`. |
| `dota_send_console_command` | Supply `command`, `vconPort` and a bounded `waitMs` to send a command and collect its output. |
| `vconsole_logs` | Read buffered events with `channel`, literal `pattern`, `after` and `limit`; this call does not start a connection. |
| `vconsole_tail` | Wait for matching events with a bounded `timeoutMs`; pass the returned `lastEventId` as `after` on the next call. |
| `dota_read_console_log` | Read recent live console output with a substring `grep` and line `limit`. |
| `vconsole_audit` | Read recent command outcome metadata and hashes with `limit`; command arguments/output are not persisted in this audit. |
| `vconsole_reconnect` | Use `automatic:false` and a bounded `timeoutMs` for one socket reconnect; Dota is not restarted. |
| `vconsole_disconnect` | Release the MCP socket and stop retries before handing the endpoint to another client. |
| `vconsole_launch` | Inspect `dryRun:true`, then launch the matching VConsole2; `configureDevice:false` preserves its saved device settings. |

A response alone does not prove a round trip to the selected game. Preserve the
PID, endpoint and new log boundary for each run.

For a disconnected endpoint, check the process/port and make one bounded
`vconsole_reconnect` attempt with `automatic:false`. Diagnose a repeated failure
instead of looping restarts or changing installations.

## Build-specific connections

Give each concurrently running installation its own VConsole port, and configure
the selected client to use that installation's port.

- **2439:** the repository records a live D3 protocol check. Only one VConsole
  client can own its connection: MCP, gateway or VConsole2. Disconnect MCP with
  `vconsole_disconnect` and release any gateway connection before opening
  VConsole2; close the GUI connection before returning to MCP.
- **Current family:** the previous live D4 check covers build 6962, not every
  current installation or the separate build-6964 launch-option snapshot.
- **Other builds:** D2 has protocol fixtures without a claimed live installation.
  Probe a bounded command round trip only when runtime testing is requested.

## CLI fallback

An already configured authenticated gateway supports `npm run vconsole -- status`,
`logs` and `exec <command>` from its checkout. The CLI does not create a gateway.
Use its selected installation and endpoint; keep credentials out of reports.

## VConsole2 editor fallback

**D [D14]:** open from the tools icon/menu or the configured console key. In the
command field, use prefix autocomplete and `Tab`. Confirm connection to the selected
Dota. Logs can be separated through the context-menu item `Open In New Log Viewer`
to follow errors from an operation.

**Proposed:** record logs without clearing prior evidence. Use text filters for
paths, `import`, `material`, `model`, and `error`, depending on available controls.
No filtered logs does not mean there were no errors: also check the full view.

Documentation: [D14](sources.md). Menus depend on the selected build.

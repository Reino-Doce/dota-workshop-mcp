# dota-workshop-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Codex, Claude Code, Claude
Desktop, Cursor, …) develop **Dota 2 custom games** with the Workshop Tools: edit KeyValues,
scaffold abilities/modifiers/items/units/heroes/Panorama, search the VScript (Lua) modding API,
and build & launch the game.

It is **template-aware**: for a [ModDota TypeScript addon
template](https://github.com/ModDota/TypeScript-Addon-Template) it scaffolds **TypeScript**
(`@registerAbility` / `@registerModifier`, KV `ScriptFile` pointing at the compiled `.lua`, `#base`
wiring) and drives the template's `npm` scripts. It also has a raw-Lua + `resourcecompiler.exe`
fallback for non-tstl addons.

> The original Workshop tool set is retained, with installation selection, versioned API references
> and an optional authenticated VConsole gateway added. It can search the Workshop for custom games by
> name and download them outside the client (SteamCMD) to study, generates whole playable maps from a spec
> (terrain shaping via the Dota tile grid + entities + waypoint paths → compile → .vpk), previews them
> top-down as an image without launching the game, edits KV1 + KV3 (soundevents/particles) data, reads
> base-game files straight out of the VPKs, and scaffolds TS/Lua content, Panorama, custom events & net
> tables, and can read/learn from any subscribed custom game's files. The live debug loop runs
> over the **VConsole2** protocol (verified against a running client: connect, send commands, read live
> output, hot-reload, restart, screenshot, error-watch) and a bundled, searchable copy of the VScript
> API, the Panorama JS API, the ModDota guides, and a knowledge base of design patterns distilled from
> shipping games (`dota_patterns`) ships for offline use. `scaffold_td` emits both the canonical
> waypoint tower-defense director and, with `maze: true`, a GemTD-style maze TD (grid A* pathfinder +
> build validation that never lets players fully wall off the path).

## Dota versions and VConsole

Register any installation root or `dota2.exe` with `dota_register_installation`. The MCP reads
the build number from `game/dota/steam.inf` and returns a stable `installationId` and `version`.
Registrations persist under `~/.dota2-workshop-mcp/installations`; build metadata is read from
the installation whenever it is discovered. Registering a path does not select it.
In automatic mode the MCP prefers the Dota
process owning the selected VConsole port, then the current installed build. An invalid
explicit installation fails instead of silently selecting another build.

| Setting | Default | Purpose |
| --- | --- | --- |
| `DOTA2_VERSION` | `auto` | Detected build number, `auto`, or the `2017` / `current` family aliases |
| `DOTA2_PATH` / `DOTA2_EXE` | detected | Explicit installation root or executable; wins over version |
| `DOTA2_INSTALLATIONS_DIR` | user configuration directory | Optional directory for persistent path registrations |
| `DOTA2_VCONPORT` | `29000` | Local VConsole TCP endpoint |
| `DOTA2_PID` | detected | Optional exact process for window/input/restart operations |
| `DOTA2_VCON_PROTOCOL` | `auto` | `auto`, `d2`, `d3`, or `d4` |
| `DOTA2_VCON_CHANNEL_ENDIAN` | `auto` | Observed channel IDs are big endian; explicit `be`/`le` overrides are available |
| `DOTA2_API_VERSION` | `auto` | API reference only: `auto`, `2017`, or `current` |

Use `dota_installations` to list registered and discovered installations and their actual build
numbers. Its `activeVersion` field identifies the selected build. Then use
`dota_select_installation` to switch the build and port within a session:

```json
{"activeVersion":"2439","vconPort":29017}
```

If several installations share a build, select one using its returned `installationId`
instead of `activeVersion`. Pass `{"activeVersion":"auto"}` to resume automatic selection.
Paths are persistent; the active selection, port and optional PID apply to the current MCP
session. For a fixed startup selection, set `DOTA2_PATH` or `DOTA2_VERSION`.
Selection closes existing MCP connections and does not restart games.
Calls accepting `vconPort` also use that endpoint when detecting the installation. Tools without
that parameter follow the session selection. Restart, input and screenshots identify a process
by executable and endpoint; ambiguous process selection fails.

`dota_launch` starts a base map (`dota` by default), or a custom game when `addon` is supplied.
Use `dryRun:true` to preview the launch. The 2017 profile adds offline/insecure flags.
**A running map is required for the 2017 command loop**: opening only the Asset Browser can
produce logs while commands remain unprocessed. Passing `map:""` opens only the tools hub.
Some builds enforce a single running game even with multiple installations.

`vconsole_launch` opens the selected installation's VConsole2 application and saves/selects
a loopback device for the selected port. Other saved devices are preserved. Close existing
VConsole2 windows before changing this setting; `configureDevice:false` opens with the saved
settings instead. `dryRun:true` previews the executable and device change. Both tested versions
select their GUI destination from these preferences, rather than a `-pid` command-line flag.
The MCP controls commands and logs directly through the same binary protocol; the GUI does
not need to be open.
**The tested 2017 engine serves one VConsole connection at a time.** Use the MCP, standalone
gateway or VConsole2 GUI as the connection owner; do not run them against that endpoint
simultaneously. Before opening the GUI, call `vconsole_disconnect` and stop any standalone
gateway. Close the GUI before reconnecting the MCP. For several LAN users, use one gateway:
it shares its single game connection across authenticated HTTP/SSE/WebSocket clients.
Use `vconsole_status` with `connect:true` to verify a command round trip, `vconsole_reconnect`
for bounded automatic retries, and `vconsole_disconnect` to close the connection.
`vconsole_logs`, `vconsole_tail` and `vconsole_audit` expose filtered events, cursors and command
outcomes. Existing `dota_send_console_command` and DebugSDK tools share a serialized queue.
Timeouts are errors, and commands are never automatically replayed.

Live checks covered build **2439** (October 3, 2017, D3) and build **6962**
(October 15, 2026, D4). D2 is covered by protocol fixtures, without a live D2 installation.
The codec handles fragmented/coalesced packets, 32-bit lengths, channel tables and the
current `CVRB` bulk table's independent version. A successful connection does not validate
every engine command, compiler format, addon dependency or scaffold on every game version.
Base-game reads prefer loose files before the archive: the tested 2017 depot keeps NPC
definitions in `game/dota/scripts/npc`, while the current depot also provides them in VPKs.

### Versioned API references

Lua and Panorama lookup tools accept `version:"auto" | "2017" | "current"` and return provenance
metadata. Switching versions does not share cached symbols. The 2017 Lua functions and enums
come from complete engine help captures from build 2439. Historical class inheritance and
Panorama declarations supplement those captures with per-symbol source labels. Panorama
runtime help is context dependent. The current reference remains the upstream bundled
ModDota dataset and is explicitly identified as a reference, not a dump of the installed game.
Build 2439 is pinned to
[GameTracking commit b0c2741](https://github.com/SteamTracking/GameTracking-Dota2/tree/b0c2741e6f27ec8dbf7c64b5dd16b09b744e8b43).
Its build metadata and hero/ability definitions match the tested installation after line-ending
normalization. Dataset metadata also records the twelve supplied depot/manifest pairs as decimal
strings, with their provenance distinguished from verified local files.

```sh
npm run build:api:2439
npm run api:capture -- --root "<installation-root>" --port 29000 --out "<new-capture-directory>"
```

The first command rebuilds the build-2439 datasets offline and verifies source hashes.
The second captures three help commands from a running map into a **new** directory outside
the game; it does not overwrite bundled data. See the build-specific
[`README.md`](src/data/versions/2439/README.md) for its depot and manifest inventory, and
[`NOTICE.md`](src/data/versions/2439/NOTICE.md) for source attributions and limits.
Modern TypeScript dependencies, community guides and complex scaffolds are not automatically
backported. Choose dependencies matching the selected game; raw Lua avoids that toolchain
requirement.

### Optional LAN gateway

The local MCP remains stdio. An independent HTTPS service exposes only VConsole operations,
with TLS 1.3, certificate and/or bearer authentication, viewer/operator/admin roles, command
allowlists, per-principal rate limits and bounded log streams. Filesystem and OS tools remain
local. Copy [`examples/gateway.json`](examples/gateway.json), supply certificate paths and
authorized fingerprints, then run:

```sh
npm run build
npm run gateway -- /absolute/path/to/gateway.json
```

Configuration paths are relative to the JSON file. The default bind address is loopback;
set `bind` to the intended LAN address to expose the service. The client always connects to
VConsole on loopback. Dota itself may listen on all interfaces, so restrict its port with the
host firewall before enabling LAN access. Starting this service does not modify the firewall.
Configure `DOTA2_PATH` or `DOTA2_VERSION` for the service just as for the MCP.

| Endpoint | Method | Minimum role |
| --- | --- | --- |
| `/v1/health`, `/v1/vconsole/status`, `/v1/logs` | GET | viewer |
| `/v1/logs/stream` (SSE), `/v1/ws/logs` (WebSocket) | GET/upgrade | viewer |
| `/v1/commands` | POST | operator |
| `/v1/vconsole/reconnect` | POST | admin |
| `/v1/audit`, `/v1/metrics` | GET | admin |

`POST /v1/commands` takes `{"command":"status","timeoutMs":5000}` and returns captured lines.
Log endpoints accept `limit`, `channel`, literal `pattern` and `after` event ID. SSE also
accepts `Last-Event-ID`; streams expire after five minutes and must be reopened with their
cursor. The retained buffer is limited to 4,000 lines/4 MiB; an older cursor can have a gap.
Each principal may open three streams. Slow consumers are disconnected, and throttled
requests return `429` with `Retry-After`. WebSockets carry logs only.

The default policy permits a small diagnostic command set. Separators, newlines, NUL,
oversized commands and unknown command names are rejected. Indirect execution, scripting
and termination commands require both explicit allowlisting and `allowDangerous:true`.
The API returns completion of the ordered console round trip, not proof of a command's
semantic success. Review the returned output.

Certificate principals use SHA-256 certificate fingerprints. Bearer principals use
`tokenSha256`, never the plaintext token. If both are configured for one principal, both
must match. Set `tls.requireClientCertificate:false` only for bearer-only deployments.
TLS verification remains enabled in either mode. Removing a principal revokes its access
after a service restart; restart also closes existing streams. Rotate certificates/tokens
by replacing the config and restarting the service.

To obtain a client certificate fingerprint:

```sh
openssl x509 -in client.pem -noout -fingerprint -sha256
```

Use certificates from your private CA with `serverAuth`/`clientAuth` purposes; the server
certificate must include the actual DNS name or LAN IP in its subject alternative names.
Store private keys outside the repository and limit access to the service account.
The example fingerprint is a placeholder and does not grant access.

The bundled CLI validates the server certificate and supports:

```sh
npm run vconsole -- health
npm run vconsole -- exec status
npm run vconsole -- logs
npm run vconsole -- follow
```

Set `DOTA2_GATEWAY_URL`, `DOTA2_GATEWAY_CA`, `DOTA2_GATEWAY_CERT`,
`DOTA2_GATEWAY_KEY` and/or `DOTA2_GATEWAY_TOKEN` in its environment. mDNS discovery
(`_dota-vconsole-mcp._tcp`) is optional and disabled by default.

Audit events retain identity, source IP, request ID, duration, policy outcome and command
hash, without command arguments or console output. Memory holds 2,000 audit events.
Optional `auditFile` persistence rotates at 10 MiB with one previous file; health/metrics
report write failures. Console frames are capped at 1 MiB, commands at 4 KiB UTF-8,
the queue at 64 requests, and normal captures at 5,000 lines/2 MiB.

For unattended use, run `node dist/gateway/main.js <absolute-config-path>` under a process
supervisor with this repository as the working directory, Node 22.13+, and the service's
explicit environment. Configure restart-on-failure and graceful termination. A Dota
restart does not require restarting the gateway: its health endpoint stays available and
the console reconnects with backoff. Install no game files or Valve binaries in containers
or distribution artifacts.

### Validation

```sh
npm ci
npm test
npm run build
npm run smoke
npm audit
```

Gateway integration tests generate disposable certificates using `openssl` (or the
`OPENSSL` executable override). Tests cover malformed frames, protocol profiles, concurrent
commands, deadlines, lost connections, mTLS failures, permissions, throttling, SSE and
WebSockets. The smoke suite exercises the original MCP tool surface using a temporary
addon. It may inspect the selected running game's status/window; it does not restart it.
Live engine checks are separate from these automated tests.
Close other VConsole clients before the 2017 live check.

With a map already running, `node scripts/verify-installed.mjs 2017 29017` or
`node scripts/verify-installed.mjs current 29000` verifies automatic discovery, a real
console round trip, the versioned API, VPK reading and window identity through MCP.
It previews launches without starting or stopping a game.

## Features

| Area | Tools |
| --- | --- |
| **Diagnostics & status** | `dota_doctor`, `addon_list`, `addon_info`, `dota_status`, `addon_audit` |
| **KeyValues** | `kv_read`, `kv_get_entry`, `kv_upsert_entry`, `kv_remove_entry`, `kv_validate`, `kv_format` |
| **Scaffolding** | `scaffold_ability`, `scaffold_modifier`, `scaffold_item`, `scaffold_unit`, `scaffold_hero`, `scaffold_panorama_panel` |
| **Systems scaffolders** | `scaffold_notifications`, `scaffold_nettable_binding`, `scaffold_rpc`, `scaffold_save_codes`, `scaffold_hud_panel`, `scaffold_wave_system`, `scaffold_shop`, `scaffold_talent_tree` (battle-tested infra distilled from shipping games) |
| **VScript API** | `lua_api_search`, `lua_api_get`, `lua_api_class_methods` |
| **Build & launch** | `addon_build`, `addon_compile_content`, `addon_launch_tools`, `addon_launch_custom_game`, `addon_link` |
| **Live debug loop** | `dota_send_console_command`, `dota_read_console_log`, `dota_reload_scripts`, `dota_restart_game`, `dota_dev_cycle`, `dota_screenshot`, `dota_watch_errors`, `dota_wait_for`, `dota_perf` |
| **Window & input** | `dota_window`, `dota_focus_window`, `dota_click`, `dota_type`, `dota_input` |
| **In-game DebugSDK** | `addon_attach_debug_sdk`, `addon_detach_debug_sdk`, `dota_lua_eval`, `dota_debug_dump`, `dota_selftest` |
| **Reference library** | `ref_harvest`, `ref_harvest_top`, `ref_list`, `ref_search`, `ref_find`, `ref_passport`, `ref_inspect`, `ref_get`, `ref_recipe`, `ref_curate`, `ref_stats`, `asset_db` (SQLite index: fast structured search by kind/ext/name) |
| **Docs & references** | `docs_search`, `docs_get`, `docs_list`, `dota_patterns`, `panorama_api_search`, `panorama_api_get`, `tools_catalog` |
| **Maps** | `map_create`, `map_add_entity`, `map_to_text`, `map_from_text`, `map_compile`, `map_list` |
| **Map generation** | `map_build`, `map_terrain`, `map_preview`, `map_tile_to_world`, `entity_catalog`, `scaffold_td` |
| **Reference games** | `workshop_search`, `workshop_download`, `workshop_list`, `workshop_inspect`, `workshop_read`, `workshop_grep`, `panorama_decompile` |
| **Asset preview (out of engine)** | `asset_preview` (particles/textures/models → inline contact-sheet image + HTML gallery), `sound_preview` (sounds → inline waveform/icon image + playable HTML soundboard + inline audio), `preview_studio` / `preview_studio_stop` (interactive gallery + public share link: animated particles, 3D models, audio players, click-to-select), `preview_pick` / `preview_selections` (resolve the IDs the user picked/clicked → game + asset path) — decoded via ValveResourceFormat, no Dota launch |
| **Sounds & KV3** | `soundevents_list`, `soundevents_get`, `soundevents_upsert`, `kv3_read` |
| **Assets & base game** | `assets_list`, `assets_search`, `vpk_find`, `vpk_read`, `base_kv_entry` |
| **Events & net tables** | `scaffold_custom_event`, `scaffold_net_table` |

Everything is bundled so search works **offline**:
- VScript (Lua) API — 97 classes / 242 globals / 72 enums, from [@moddota/dota-data](https://github.com/ModDota/dota-data).
- Panorama JS API — 62 interfaces / ~880 members / 18 globals, from [@moddota/panorama-types](https://github.com/ModDota/TypeScriptDeclarations).
- 93 guide pages: 83 ModDota articles (scripting, abilities, modifiers, units, panorama, assets, tools) from
  [moddota.com](https://moddota.com), a task-oriented **Custom Game Cookbook** index (`guides/custom-game-cookbook`)
  tying the tools/docs/patterns together, plus nine hand-authored references bundled with the MCP — **Particles &
  Effects in Panorama** (`panorama/particles-and-effects`) and the **Dota 2 Panorama CSS Reference**
  (`panorama/dota-css-reference`), and seven docs *distilled from a deep analysis of 34 shipping custom games*: the
  **Panorama Animations & Effects Cookbook** (`panorama/animations-cookbook`), **Custom Game HUD & UX Patterns**
  (`panorama/hud-ux-patterns`), **Custom Game Architecture & Systems Patterns** (`scripting/custom-game-architecture`),
  **Particles, Sound & Game Feel** (`scripting/particles-sound-gamefeel`), **AI & Combat Patterns**
  (`scripting/ai-combat-patterns`), **Hijacking & Extending Dota's Native HUD** (`panorama/native-hud-hijacking`),
  and **Advanced Techniques & Engine-Limit Workarounds** (`scripting/advanced-techniques`).
- A `dota_patterns` knowledge base of **77** reusable engineering patterns, each attributed to the shipping games
  it was learned from (distilled from a 58-game decompiled reference corpus).
- A curated catalog of Dota 2 modding tools, libraries and references.

Refresh current references with `npm run build:data`. This does not replace the pinned 2017 dataset.

## Requirements

- Node.js ≥ 22.13 (the existing asset index uses the built-in SQLite module)
- Dota 2 + the free **Dota 2 Workshop Tools** DLC installed
- Windows (build/launch shell out to `dota2.exe` / `resourcecompiler.exe`; KV + API tools are cross-platform)

## Install

```bash
git clone https://github.com/Reino-Doce/dota-workshop-mcp.git
cd dota-workshop-mcp
npm install        # also builds via the prepare script
npm run build:data # (optional) refresh bundled VScript API + Panorama API + ModDota guides
```

`npm install` runs `npm run build`, producing `dist/index.js` (the server entry point).

## Configure

The server needs to know two things:

- **Which addon project** you're working on — set `DOTA2_ADDON_DIR` to the addon root (the folder
  with `package.json` / `game` / `content`), or pass `projectRoot` to any tool.
- **Where Dota 2 is** — register a root with `dota_register_installation` and select its
  detected build with `dota_select_installation`. Automatic discovery also checks the selected
  VConsole endpoint, Steam libraries and the standard default path. Override with `DOTA2_PATH`
  or `DOTA2_EXE`, or select a registered build with `DOTA2_VERSION`.

### Codex

After building the server, generate a configuration entry from this checkout:

```sh
node scripts/codex-config.mjs --addon "<absolute-path-to-addon>"
```

The generator prints TOML with absolute Node, server and addon paths. It does not edit any
client configuration. Merge the output into your existing `~/.codex/config.toml`, or the
addon's `.codex/config.toml` for a trusted project; keep your other settings. A manual template
is available at [`examples/codex.config.toml`](examples/codex.config.toml).
These configuration locations and the MCP settings below follow the
[official Codex MCP documentation](https://developers.openai.com/codex/mcp).

The entry sets a 30-second startup timeout and a 900-second tool timeout because game builds
can run for ten minutes; Codex's default tool timeout is 60 seconds. Use `--tool-timeout 1800`
for longer workflows. This changes the client deadline, not individual tools' internal limits.
Paths with spaces or backslashes are escaped by the generator. If using the npm alias, run
`npm run --silent config:codex -- --addon "<absolute-path-to-addon>"` for clean TOML output.

`DOTA2_ADDON_DIR` is explicit, so addon tools do not depend on where the client was started.
The `env_vars` list forwards optional game and helper configuration from the launching
environment. For settings that must also work when opening the desktop app independently of
that terminal, add them to `[mcp_servers.dota2-workshop.env]`. You can also register and select
installations through the MCP tools after connection.

Verify the saved entry with `codex mcp get dota2-workshop --json` or `codex mcp list`, then
start a new session. Configuration listing alone does not establish a live connection: ask
for `lua_api_get` with `name:"CreateUnitByName", version:"2017"` as a read-only connection
check, followed by `dota_installations` and `dota_doctor` for your game/addon setup.

Compatibility limits:

- Run the stdio server on the host that has the game and addon files. A separate remote/cloud
  executor cannot access those paths or the local VConsole endpoint automatically.
- The optional HTTPS gateway is a VConsole REST/SSE/WebSocket service, **not a Streamable HTTP
  MCP endpoint**. Do not use its URL as the Codex MCP `url`; use the stdio entry above.
- Recording returns a local GIF path. Attach, preview or link it with the client's available
  capabilities; animation playback varies. No tool named `Read` or `SendUserFile` is required.
- The template disables the optional `image_generate` tool. Its existing backend uses browser
  sessions or file-based login tokens and undocumented endpoints; it is not a supported Codex
  image-generation integration. Codex also supports credential-store and ephemeral logins,
  which do not provide that file. Use a native image tool when available, or deliberately
  remove this exclusion after configuring the separate backend. Do not change credential
  storage just to satisfy this tool. See [Codex authentication](https://developers.openai.com/codex/auth).

Run `npm run test:stdio` for an isolated MCP protocol check covering discovery, reference lookup,
addon-path handling, errors, resources and prompts. It uses an SDK client and fixture addon;
it does not launch the game or claim to verify rendering in the Codex UI.

### Claude Code

Copy [`examples/claude-code.mcp.json`](examples/claude-code.mcp.json) to your addon repo as
`.mcp.json` (adjust the two paths), or:

```bash
claude mcp add dota2-workshop --env DOTA2_ADDON_DIR=C:\path\to\addon -- node C:\path\to\dota-workshop-mcp\dist\index.js
```

### Claude Desktop

Merge [`examples/claude-desktop.config.json`](examples/claude-desktop.config.json) into
`%APPDATA%\Claude\claude_desktop_config.json` (absolute paths; restart the app).

### Cursor / other IDEs

Use [`examples/cursor.mcp.json`](examples/cursor.mcp.json) at `.cursor/mcp.json` or
`~/.cursor/mcp.json`. Any stdio MCP client works — only the config location differs.

## Typical flow

1. `dota_doctor` — confirm Dota is found, the addon is detected, and it's linked into `dota_addons`.
2. `scaffold_ability` `{ name: "my_hero_fireball", behavior: "point" }` — writes the TS source, the
   `npc_abilities_custom.txt` block, and localization tokens.
3. `lua_api_search` / `lua_api_get` — look up the exact VScript signatures while writing the logic.
4. `addon_build` — compile TypeScript → Lua (`npm run build`).
5. `addon_launch_custom_game` `{ map: "..." }` — boot tools mode and start the map.

All build/launch tools accept `dryRun: true` to preview the exact command without running it.

## Live debugging & iteration

The debug tools drive a running game through the **VConsole2** protocol — the same channel
`vconsole2.exe` uses. In `-tools` mode the game listens on `127.0.0.1:29000` (override with
`-vconport`, or the `DOTA2_VCONPORT` env var on the MCP side). This is the reliable path on Windows:
the classic `-netconport` telnet console has been broken on Windows since 2023, and `console.log` is
buffered until the client exits — so live output is read from the VConsole `PRNT` stream instead.

The launch tools already pass `-tools` (and `-vconport`), so the channel is available after
`addon_launch_custom_game`. Then:

- **`dota_send_console_command`** — run any console command and get back the output it printed.
- **`dota_read_console_log`** — read recent live console output (with optional `grep`).
- **`dota_reload_scripts`** — compile + `script_reload` (hot-reload Lua without relaunch).
- **`dota_restart_game`** — `taskkill` + relaunch + reconnect (for changes that can't hot-reload).
- **`dota_dev_cycle`** — one call: build, then pick the cheapest apply path (with `autoRestart` if a reload errors).
- **`dota_screenshot`** — two variants: **`game`** = the in-game render via the `jpeg` console command (the true
  rendered frame); **`window`** = the dota2 window captured with **real screen pixels** (so the 3D viewport is *not*
  black — unlike `PrintWindow`), focusing the window first. (`print` = offscreen PrintWindow for occluded windows.)
- **`dota_watch_errors`** — scan the live console for Lua/engine errors (script error, stack traceback, *.lua:NN, …).
- **`dota_wait_for`** — block until a console line matches (optionally after sending a command) — for sequencing tests.

What hot-reloads vs needs a restart:

| Change | Action |
| --- | --- |
| Lua function bodies | `dota_reload_scripts` (`script_reload`) |
| Panorama (xml/css/js) | auto-reloads after compile — no relaunch |
| KV files (`npc_*_custom.txt`) | `dota_restart_game` (full relaunch) |
| New/removed scripts, changed class structure, registrations | `dota_restart_game` |

> Tip: the ModDota template uses `Dynamic_Wrap`/`GameRules.Addon.Reload()` so reloaded code is
> picked up — keep event listeners wrapped for `script_reload` to take effect.

## Window control & input injection

Drive the game window and inject mouse/keyboard at the OS level (Windows). Coordinates are **client-relative** by
default (the render area's top-left), so they line up with what a `window` screenshot shows; use `nx`/`ny` for a
fraction of the client area. Everything is batched into a single PowerShell call per tool so sequences run fast.

- **`dota_focus_window`** — focus (`focus:true`, beats the Windows foreground lock via `AttachThreadInput`) or send to
  back (`focus:false`). Focus is needed before reliable clicks.
- **`dota_window`** — `info` (geometry + foreground/minimized state), `focus`/`unfocus`/`minimize`/`restore`/
  `maximize`/`show`/`hide`, or `move` (x/y/w/h).
- **`dota_click`** — move + click (left/right/middle, double) at `x,y` or `nx,ny`.
- **`dota_type`** — type literal `text`, or send `keys` chords (`{ENTER}`, `{ESC}`, `^a`, …).
- **`dota_input`** — a whole `actions` sequence (`move`/`click`/`down`/`up`/`drag`/`scroll`/`key`/`text`/`sleep`) in one
  fast call — the way to script a self-test interaction.

## In-game DebugSDK + self-test

The **DebugSDK** is a self-contained Lua module bundled with the MCP. Attach it to any addon and it registers `mcp_*`
console commands the MCP drives over VConsole for **deterministic** control and inspection — the fast, reliable path for
self-testing (no pixel guessing).

- **`addon_attach_debug_sdk`** — copy `mcp_debug.lua` into the addon and wire `require("mcp_debug")` into the game-mode
  bootstrap (TS *or* Lua). Idempotent; `addon_detach_debug_sdk` reverses it. Then `addon_build` (tstl) + `dota_restart_game`.
- **`dota_lua_eval`** — run a Lua snippet on the live server and get the JSON result (`mcp_eval`).
- **`dota_debug_dump`** — dump game state as JSON: `state` (time/phase/players), `heroes`, `units` (`mcp_dump`).
- **`dota_selftest`** — one orchestrated smoke run: optionally launch a map, ping the SDK, run `commands`, check
  `asserts` (Lua booleans → PASS/FAIL via `mcp_assert`), watch for errors, and screenshot — returns a single pass/fail report.

The SDK also exposes `mcp_spawn`, `mcp_gold`, `mcp_level`, `mcp_item`, `mcp_event` (fire a custom UI event), `mcp_hud`
(clean screenshots) and `mcp_pause` — all callable via `dota_send_console_command` too.

## Reference library — collect & search shipping games

Build a **persistent, self-curating** local library of custom-game source code, then search it on demand ("how does a
shipping game do X?"). Stored under `~/.dota2-workshop-mcp/reflib` (override `DOTA2_REFLIB_DIR`).

- **`ref_harvest`** — search the Workshop by `query` (or pass `ids`), optionally `download:true` via SteamCMD, extract
  the code (lua/KV/panorama), **score code quality** (0–100; rewards substance/structure/comments, penalizes
  obfuscation), classify **topics** (tower-defense, auto-chess, arpg, arena, ui-heavy, backend, …), and index it.
- **`ref_search`** — full-text search across all extracted code, ranked so higher-quality games come first.
- **`ref_list` / `ref_inspect` / `ref_get`** — browse the library, list a game's files, read one.
- **`ref_curate`** — prune low-quality / obfuscated games (with `dryRun`). **`ref_stats`** — library summary.

## Generating maps from a description

Turn a request like *"a small square map with a central platform, ringed by a road the monsters
walk — tower defense"* into a real map:

- **`map_build`** — one call: clone the template, shape terrain, place entities, lay waypoint paths,
  register and compile. Terrain ops work on the **Dota tile grid** (`verticesHeight` / `verticesWater` /
  `cellsTileSet`) over shapes (`rect` / `circle` / `ring` / `path`): raise platforms, carve roads
  (different tileset), flood water moats, etc.
- **`map_terrain`** — apply terrain ops to an existing map.
- **`map_preview`** — render the map top-down to an **image straight from the data**, no game launch —
  the fast way to iterate on a layout (water = blue, road = tan, grass = green, shaded by height).
- **`entity_catalog`** — the placeable-entity reference (spawners, `path_track` waypoints, triggers,
  lights, props, …) so you know what to place.
- **`map_tile_to_world`** — convert tile coords to world units so terrain and entities line up.

Coordinates: terrain ops use tile units (default 64×64 grid; world = origin + tile×256); entity/path
positions use world units.

## Learn from other custom games

Find, fetch and dissect any published custom game — the same Steam UGC backend the client uses,
driven from outside the game:

- **`workshop_search`** — search by name (e.g. `"tower defense"`) → ids, titles, subscriber counts.
- **`workshop_download`** — download by id via SteamCMD (anonymous; auto-installs SteamCMD on first
  use). No Steam login needed for Dota custom games. By default it then **extracts the code and
  decompiles the compiled Panorama** into the reference library so it's instantly browsable/searchable
  (`extract:false` to skip).
- **`workshop_grep`** — full-text **search the code across all downloaded/subscribed games** straight
  from their VPKs (lua/KV/panorama, compiled panorama decompiled on the fly) — scope to one `id` or
  search everything; filter by `ext` to go faster.
- **`workshop_list` / `workshop_inspect` / `workshop_read`** — list local items (subscribed +
  downloaded) and read any file straight out of their VPK to study how they're built. Published games ship
  Panorama **compiled** (`.vcss_c`/`.vjs_c`/`.vxml_c`); `workshop_read` (and `vpk_read`) **auto-decompile** these
  back to CSS/JS/XML source so you can study real shipping UI, animations and HUDs.
- **Reference library** (`ref_harvest` / `ref_search` / …) — collect games into a persistent, quality-scored,
  topic-classified local code library (including decompiled Panorama UI) and search across all of it on demand.
- **`asset_db`** — a SQLite index of **every file across all unpacked games**, so finding any
  model/particle/sound/texture by **kind/extension/name** is a fast structured query instead of a scan.
  `action=search` (default) / `stats` / `rebuild`; auto-updates on download/unpack. e.g.
  `asset_db query="tower" kind="model"`.

So you can go from *"how does a popular TD spawn waves?"* to reading its actual `waves.lua` in a couple
of calls.

### Preview assets without launching Dota

Eyeball particles, textures, models and sounds straight from the downloaded games — decoded
out-of-engine via [ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)
(auto-installs on first use, Windows). Both tools return an **inline image in chat** (a numbered
contact sheet), so previews are viewable **over remote-access** where opening a browser isn't possible,
*and* write a self-contained HTML page for richer local viewing.

- **`asset_preview`** — find matching particles (`.vpcf`), textures (`.vtex`) or models (`.vmdl`),
  decode them (textures → PNG, models → GLB, particles → their sprite texture), and return a numbered
  contact-sheet image inline + an HTML gallery with interactive 3D `<model-viewer>` for models. e.g.
  `asset_preview query="spark" kind="particle"`.
- **`sound_preview`** — find matching sounds (`.vsnd`), decode them, and return an inline image (a real
  amplitude waveform for the rare PCM sound; a labelled speaker tile + accurate duration for MP3, the
  usual Dota codec — MP3 can't be waveformed out-of-engine) + an HTML **soundboard** with a real
  `<audio>` player per sound; small sounds are also embedded inline as playable audio. e.g.
  `sound_preview query="explosion"`.
- **`preview_studio`** — build a rich **interactive** gallery and expose it on a **public share link**
  (Cloudflare quick tunnel) you open in any browser, including a phone over remote-access. Particles are
  replayed live as animated additive billboards from their real `.vpcf` parameters (move + glow); models
  are interactive 3D (rotate); sounds get a player. Every card has a stable **ID** (P#/M#/S#/T#) and a
  **«выбрать» button**: pick by clicking (the click posts to the gallery server) or by telling the agent
  the ID. `preview_selections` returns what was clicked, `preview_pick id="M3,P7"` resolves explicit IDs —
  both map the choice back to the source game + asset path. `preview_studio_stop` tears it down.

## Built-in references (offline)

No need to leave the editor to look things up:

- **`lua_api_search` / `lua_api_get`** — the VScript (Lua) server API.
- **`panorama_api_search` / `panorama_api_get`** — the Panorama JS API. Globals resolve to their
  interface: `panorama_api_get $`, `panorama_api_get GameEvents`, `panorama_api_get Players.GetLocalPlayer`.
- **`docs_search` / `docs_get` / `docs_list`** — the ModDota guides. Browse with `docs_list`, search
  with `docs_search modifier`, read with `docs_get abilities/ability-keyvalues`.
- **`tools_catalog`** — the curated list of tools/libraries/references (filter by category or query).

## Building maps

`.vmap` files are DMX documents. The MCP edits them as text via Valve's `dmxconvert.exe`
(binary ↔ keyvalues2), then compiles with `resourcecompiler` (`-game <dota>/game/dota`) into a
playable `.vpk` — a pipeline verified end to end.

- **`map_create`** — clone the official template map (ground + lighting + team spawns) into your
  addon and register it in `addoninfo.txt`. Pass `compile: true` to produce the `.vpk` immediately.
- **`map_add_entity`** — place any entity (`info_player_start_*`, `npc_dota_spawner`, `env_*`,
  `prop_dynamic`, `point_*`, …) with origin/angles/properties.
- **`map_to_text` / `map_from_text`** — read/write the full vmap DMX text for arbitrary edits.
- **`map_compile`** — compile a map's `.vmap` → `.vpk`.
- **`map_list`** — list maps with source/compiled status.

Then launch it: `addon_launch_custom_game map="<name>"`.

> Limitation: bespoke **geometry** (terrain/brushwork — the `CDmePolygonMesh` half-edge data) is
> authored in **Hammer**. The MCP builds maps by cloning a working base and placing entities; it
> doesn't sculpt arbitrary meshes from scratch.

## Notes & limitations

- `kv_read` returns the file's own wrapper block and lists `#base` includes, but does not yet inline
  `#base` files — read those directly via `path`.
- Editing an entry with `kv_upsert_entry` preserves comments on *other* entries; the edited entry is
  regenerated from your JSON.
- Heroes can only be created by overriding an existing hero (`scaffold_hero` writes an `override_hero`
  block) — this is a Dota engine constraint.

## Development

```bash
npm run dev    # run the server from source via tsx
npm test       # KV parser/serializer unit tests
npm run smoke  # boot the server over stdio and exercise the tools end-to-end
```

## License

MIT — see [LICENSE](LICENSE).

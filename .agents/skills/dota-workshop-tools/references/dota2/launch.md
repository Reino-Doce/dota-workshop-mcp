# Dota 2 launch

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `dota_launch` | Launch the selected installation with optional `addon`, `map` and `vconPort`; `map` defaults to `dota`, while `map:""` requests only the tools hub. |
| `addon_launch_tools` | Supply `projectRoot` or `addon` to open its tools hub, optionally starting a `map`. |
| `addon_launch_custom_game` | Supply `projectRoot` or `addon` plus the required `map` to launch directly into a local custom game. |
| `dota_status` | Inspect the installation, game window and VConsole connection before driving the session; optionally supply `vconPort`. |

All three launch endpoints accept `dryRun:true` to preview their command.

## Select and launch

Select the installation through the [MCP](../mcp.md), inspect existing sessions,
and preview `dota_launch` with `dryRun:true`. For example:

```json
{"addon":"<addon>","map":"<compiled-map>","vconPort":29017,"dryRun":true}
```

Confirm the executable, addon and endpoint before launching. For parameters
outside the MCP schema, use this installation's executable and working directory.

| Client build | Parameters and purpose |
|---|---|
| 2439 / 2017-10-03 | [Historical launch options](launch-options-2439.md) |
| 6964 / 2026-10-19 | [Current snapshot launch options](launch-options-6964.md) |

Use the list matching `steam.inf`; absence from a list does not prove an option
is unsupported. For another build, document its parameters and conditions here
using that build's documentation or observed behavior.

## Build 2439

Select `activeVersion:"2439"` or its `installationId`. The MCP launch profile adds
this family's offline/insecure arguments and loads `dota` by default to initialize
the command loop. Supply `addon` and `map` for a custom game. `map:""` opens only
the tools hub, which can emit logs without processing console commands.

For the historical Workshop Manager CLI fallback:

```text
<ROOT>/game/bin/win64/dota2.exe -addon <ADDON> -tools -tool workshopmanager -workshop_items -nosteam -condebug
```

Use that executable's directory as the working directory and capture a fresh
log boundary. `-nosteam` is not network isolation. This editor recipe differs
from the MCP map-launch profile; verify the command loop before sending commands.
The parameter list records `-nowindow` shutdown behavior and the `VPROJECT`
requirement and tools-instance limit of `-allowmultiple`.

## Current and other builds

Check launch/build dry runs against the selected installation's paths. Historical
offline flags and editor/compiler options do not automatically apply to a newer
build. Use [Workshop Manager](../workshop-manager.md) for editor interaction and
[VConsole](../vconsole.md) for endpoint ownership and protocol constraints.

## Startup console commands

Plus-prefixed arguments execute console commands; they are separate from dash
options. For example, `+map` does not establish a `-map` option.

| Command | What it does |
|---|---|
| `+map <map>` | Load a map at startup. |
| `+dota_launch_custom_game <addon> <map>` | Launch the addon's custom game and map. |
| `+sv_cheats 1` | Enable cheat-protected commands in a local test session. |
| `+developer 1` | Enable developer console output. |

After compilation, follow [runtime validation](runtime.md) for local map and
asset checks. Launching the process alone does not establish those results.

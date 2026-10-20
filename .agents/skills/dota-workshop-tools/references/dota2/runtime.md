# Dota 2 runtime validation

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `dota_send_console_command` | Send a verified local test `command` to the selected `vconPort`, with a bounded `waitMs`. |
| `dota_screenshot` | Use `method:"game"` for an engine-rendered frame, or `method:"window"` to inspect the game window. |
| `dota_record` | Use `target:"game"`, `seconds` and `fps` to capture a short GIF of a windowed/borderless session; first use may install FFmpeg. |
| `dota_reload_scripts` | Supply `projectRoot` for Lua function-body edits; `build:false` skips the optional script build. |
| `dota_restart_game` | Supply the required `map` and inspect `dryRun:true` before restarting the selected process for KV or structural changes. |
| `dota_watch_errors` | Use a bounded `windowMs` and `clear:false` to check recent console output without clearing the buffer. |

For launching a new session, use the [launch endpoints](launch.md#mcp-endpoints).

## Runtime checks

After compiling, use Hammer's launch option or the documented command: [D5]

```text
dota_launch_custom_game <addon> <map_name>
```

Replace the placeholders with the addon name and compiled map; do not use the Windows path to the
VMF. Check local help for subfolders/names outside the simple case. To enter
Radiant when appropriate, documentation uses `jointeam good`. [D14]

For a requested minimap workflow, run `dota_minimap_create` after loading the
compiled map, then verify the generated overview under the addon before copying
or replacing anything.

**Local tools documented, to confirm with autocomplete in this build:**
`dota_dev forcegamestart`, `dota_dev hero_teleport`, `dota_create_unit`, and
`noclip`. The latter affects the camera; it does not make the hero a no-collision
entity. Some commands require `sv_cheats 1`; use them only in the local test
session and record/restore temporary settings. [D15]

**Proposed test matrix:** walk on ramps/passages; observe a tree before/after
cutting and a building in available states; compare skins, scale, and animation;
check terrain, river, overlays, lighting, fog, and particles. Evaluate navigation
mesh separately from visible geometry and model collision.

Compare first under equivalent camera/time/conditions. `env_global_light` and
`ent_dota_lightinfo` are in the historical documentation, but confirm which
classes and properties this build uses before editing. Do not add probes/bake
because a tutorial for another branch requires them. [D12]

Material/particle changes and addon behavior can be validated in runtime; loading
an old map alone cannot prove S1 rules were restored. A unit's appearance may be
selected by data or scripts, not by the prop shown in Hammer. [D1]

Documentation: [D1, D5, D12, D14, D15](../sources.md). Menus depend on the selected build.

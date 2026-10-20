# Source Filmmaker

## MCP endpoints

MCP has no endpoint for SFM sessions, timeline/camera edits or movie exports.
Use these supporting endpoints, then the editor workflow below:

| Endpoint | Usage |
|---|---|
| `dota_launch` | Supply `addon` and inspect `dryRun:true` to prepare the selected build's tools session. |
| `map_list` | Supply `projectRoot` to check registered maps and whether their compiled files exist. |
| `vconsole_logs` | Read bounded engine events with `pattern`, `after` and `limit` when map/resource loading fails. |
| `dota_diagnose` | Inspect blocking dialogs and process health when the tools session stalls. |

## Editor workflow

**Route depends on the local UI:** find SFM in Asset Browser's menu/icon. Do not
launch separate Source 1 SFM. Confirm the addon and create a test session in a
writable directory. Identify the map selector in the viewport/menu (for example,
`Load Map`, if present), locate [Hammer's compiled output](hammer.md#build), and
record which resource was loaded.

Capture the UI and action name before running it: the exact SFM labels in the
selected binary have not been directly verified here. Do not inject a map command
from another branch. If the map does not appear, inspect build/mounting/logs; do
not rename a VPK to BSP or VMAP_C.

**Proposed procedure:** create fixed shots of Radiant, Dire, river, Roshan, and a
vegetated region; use only areas that exist in that era. Record camera, lighting,
time, and resolution. Reopen the session to test persistence. Avoid extra
cinematic lights in the initial comparison.

SFM evaluates the rendered representation. It does not prove pathfinding,
gameplay model swaps, tree cut/regrowth, or map rules. If the tool is missing from
this installation, continue visual validation in Dota and leave the SFM step
explicitly pending.

See [source and evidence limits](sources.md). Menus depend on the selected build.

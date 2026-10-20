# Panorama debugger

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `panorama_api_search` | Supply `query` and API `version` to find globals, interfaces and members. |
| `panorama_api_get` | Supply an exact `name` and API `version` to read its signature and documentation. |
| `scaffold_panorama_panel` | Supply `projectRoot` and `name` to create panel layout/style/script files; review the UI-manifest registration afterwards. |
| `addon_build` | Supply `projectRoot` and inspect `dryRun:true` before running the TypeScript template's script/Panorama build. |
| `vpk_read` | Supply a base-game Panorama `path`; compiled CSS/JS/XML is decoded to text. |
| `panorama_decompile` | Supply a locally available Workshop `id` and optional `path` to inspect recovered UI sources; `outDir` exports the tree. |
| `dota_read_console_log` | Use `grep`, `limit` and the selected `vconPort` to inspect live UI/script diagnostics. |

Select the appropriate [MCP API family](mcp.md#api-versions) and read its provenance before
applying documentation to the installed engine.

## Debugger fallback

Documentation specifies `F6` followed by selecting a UI
panel. Use it only to diagnose UI that blocks testing/launch; confirm the local
binding. XML/CSS/JS and Lua are addon authoring tools, not geometry, VMT, or MDL
converters. [D1, D16]

Documentation: [D1, D16](sources.md). Menus depend on the selected build.

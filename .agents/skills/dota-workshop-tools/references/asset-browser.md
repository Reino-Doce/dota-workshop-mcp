# Asset Browser

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `assets_list` | Supply `projectRoot` and an optional extension `type` to inventory addon content and compiled assets. |
| `assets_search` | Supply `projectRoot`, a path-substring `query` and optional `type` to locate addon assets. |
| `vpk_find` | Search the selected installation's base VPK with `query`; use a bounded `limit`. |
| `vpk_read` | Read a base-game text `path`; loose files take precedence, and compiled Panorama is decoded automatically. |
| `asset_preview` | Use `query` and `kind` to preview models, textures or particle sprites from the downloaded Workshop library; optional `id` restricts that library search. |

`asset_preview` may install its decoder on first use. Its library is separate
from the selected installation. Opening an asset in its native editor uses the
browser workflow below.

## Editor workflow

**D — entry point:** top icons or the tools menu. Double-clicking an asset opens
its associated editor. The browser can filter by name, mod, and type; preview
shows dependencies. [D2]

1. Capture the browser and record the active addon.
2. Clear the previous search; enter a specific part of the path/name.
3. Select the appropriate type and locate the staging addon under `Mods`.
4. Select the asset once; read its path and dependencies before opening it.
5. Open it in the corresponding editor. Confirm its path in the editor and that
   the source exists on disk, not only the name shown in the thumbnail.

**Proposed — audit:** keep the old and modern selections separate in your record.
If the browser does not show the physical source, use the source file, manifest/log,
and a copy with an unambiguous namespace. The thumbnail may be cached. Never
conclude provenance from the thumbnail alone.

Do not use `Mods` to mount/unmount content: in this workflow it is a navigation
filter. Do not drag an entire asset set into the map to import it; dragging may
create new scene instances rather than convert files.

Documentation: [D2](sources.md). Menus depend on the selected build.

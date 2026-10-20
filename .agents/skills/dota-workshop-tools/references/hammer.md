# Hammer

## MCP endpoints

These endpoints work with map files and template tile grids. VMF import and
bespoke geometry editing use Hammer's editor.

| Endpoint | Usage |
|---|---|
| `map_list` | Supply `projectRoot` to list registered maps and their source/compiled-file status. |
| `map_create` | Supply `projectRoot` and `name` to clone the official template and register a new map. |
| `map_to_text`, `map_from_text` | Read a `map` as editable DMX text, then write the complete edited `text` back; supply `projectRoot` for both. |
| `entity_catalog` | Filter by `query` or `category` to look up entity classes and their keyvalues. |
| `map_add_entity` | Supply `projectRoot`, `map`, `classname` and optional transform/properties to add an entity. |
| `map_terrain` | Supply `projectRoot`, `map` and `ops` to change a Dota tile grid; coordinates use tile units. |
| `map_build` | Supply `projectRoot`, `name` and terrain/entities/paths to generate a map from the template. |
| `map_compile` | Supply `projectRoot` and `name`; inspect `dryRun:true` before compiling the map with ResourceCompiler. |
| `map_preview` | Supply `projectRoot` and `map` for a schematic top-down tile-grid image; this does not render map materials or models. |

Use [Workshop Manager](workshop-manager.md) to open the selected build, and [VConsole](vconsole.md) for logs.

## Existing project import

Open Hammer through Asset Browser. Use `File > Open`; in the file picker, choose
the Source 1 filter for `.vmf` (the label may include “1.0”). Open the prepared
VMF. Use the [build-2439 workflow](source1import/2439.md) for historical
Source1Import details and limits. Confirm this route separately on other builds.

Do not pass a BSP to the VMF filter. If the expected filter is missing, first
confirm the instance and build; do not install another Hammer or change Windows
file associations.

Watch warnings in Hammer and VConsole. Save the result with the `.vmap` extension
under `ROOT\content\dota_addons\ADDON\maps\<era>_raw.vmap`. Confirm the absolute
path in the dialog. Preserve the raw copy and work in `<era>_working.vmap`.

## Navigation

| Action | Documented control |
|---|---|
| Look and move the 3D camera | Hold right mouse button + mouse movement/WASD. |
| Center the selection | `Shift+A`. |
| Orbit | `Alt` + left mouse button. |
| Zoom/pan | `Alt` + right mouse button / middle mouse button. |
| Top/front/side 2D views | `F2` / `F3` / `F4`, with the correct viewport active. |

Focus the viewport before using shortcuts; do not type WASD into a property field.
To inspect a tree/tower, select the **entity/object**, not vertices or faces, and
open its properties using the existing control. Record the class, transform,
model, skin, and exposed parameters before editing. Do not assume the exact name
of every field. Use the resource picker beside the model field and confirm the
full path. This inspection sequence is this skill's procedure, not a guarantee
that every entity has an editable model field.

Use mesh, material, and entity tools to fix identified differences. Tile Editor
creates/edits terrain with tiles; do not apply it indiscriminately over imported
S1 geometry, because the goal is preservation, not replacing it with Reborn
terrain. [D1]

## Build

Use `File > Build Map` or `F9`. Review `Settings` and record the selected builders.
For testing, the documentation offers `Load in engine after building` and `Bring
engine to front`. Click `Build` and capture completion in the log.

Documentation for this generation describes the compiled map under
`game\dota_addons\ADDON\maps\<map>.vpk`. Record the actual build output, including
associated resources; do not require a standalone `.vmap_c` as the only result.
The minimap option is separate and is not required to prove asset conversion.

**Failure:** first preserve the first meaningful error and the paths involved. If
a partial compile is used, record omitted components; not rebuilding World does
not prove that a geometry change was validated.

Documentation: [D1, D4, D5](sources.md). Menus depend on the selected build.

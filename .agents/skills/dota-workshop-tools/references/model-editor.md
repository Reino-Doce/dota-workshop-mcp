# Model Editor

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `assets_search` | Supply `projectRoot`, `query` and `type:"vmdl"` to find model sources; use `type:"vmdl_c"` for compiled files. |
| `asset_preview` | Use `query`, `kind:"model"` and optional library `id` to view decoded models from downloaded Workshop games. |
| `addon_compile_content` | Supply `projectRoot` and inspect `dryRun:true` before compiling model sources and dependencies with the selected build. |

Model previews may install a decoder on first use and do not prove rendering in
the selected engine. Mesh, bone, collision and animation edits use Model Editor;
MCP has no dedicated endpoints for those editor operations.

## Create a VMDL source

Open the editor through its icon or from a model in the browser. For a compatible
source mesh, use `File > New VMDL From Mesh File` and select the file already
placed in the addon's `content`. FBX, OBJ, and DMX are documented; SMD appears in
the catalog, but confirm the filter and build result. The VMDL is created from the
mesh name and location; check the generated destination, including `fbx` and
`dmx` folder conventions, before proceeding.

Saving may trigger compilation, as may changes to open dependencies. Do not open
shared assets as editable if the compiler could overwrite them.

## Edit and verify

In Outliner, distinguish `Editable Data` from `Compiled Data`: viewing compiled
data does not imply recovered/editable sources. Use `Tools > View Materials` for
inspection. In the `Model` menu, `Add Material Remap` maps an existing material
to the converted one; select the Outliner entry and fill in source/destination
using the pickers. Moving the VMDL in Explorer is not enough.

As needed and if present in the menu:

- `Model > Collision > Add Physics Mesh`: attach an available collision mesh;
  inspect it in `Display > Collision Geo`. This does not automatically derive
  S1 physics.
- `Model > Add Material Group`: organize skins.
- Attachments menu: create/verify the name and parent bone, then the transform.
- `Animation > Add Animation`: add animation sources, choosing the group if
  prompted. Inspect playback and pose in the editor.

For a manual update, use `Tools > Recompile > Recompile Asset`; use the forced
variant only when indicated. Check completion in the log. Replaying an animation
does not prove preservation of gameplay events, physics, or every LOD.

## Compiled S1 MDL input — build probing

An `.mdl` with `.vvd/.vtx/.phy` is not the same input as FBX/DMX. Inspect filters
and native import commands. If an MDL route is available, provide the complete
dependency set from the snapshot and run an isolated test. Distinguish a model
actually imported from an existing S2 resource opened under the same name. Verify
the new output and its provenance.

If no functional native route is identified, record `needs_source_mesh` or
`native_import_unverified`, as appropriate. Do not claim that Model Editor
“decompiles any MDL.” Preparing meshes outside these tools is an explicit handoff,
not something this procedure performed.

## Historical build 2439

Use this build's Model Editor and compiler with the
[Source1Import workflow](source1import/2439.md). Modern ModelDoc and another
game's tools are not substitutes for historical asset import. Preserve sources for
separate compilation and validation on a later runtime.

Documentation: [D7-D11](sources.md). Menus depend on the selected build.

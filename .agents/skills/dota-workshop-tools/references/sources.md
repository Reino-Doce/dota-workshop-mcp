# Capabilities, evidence, and sources

## Evidence scale

- **U — user-reported:** an observation reported for a specific installation;
  retain its build and context rather than treating it as local proof.
- **D — documented:** the capability is described in Dota/Reborn documentation,
  but this skill has not run it in the local installation.
- **L — locally validated:** the operation was observed with a screenshot/log and
  a file attributable to that run. Promote U/D to L only with attributable operation evidence.
- **P — proposed:** a staging, audit, or test policy designed for this task, not
  a capability promised by Valve.
- **? — not established:** presence/support depends on the binary and assets.

Research was performed on 2026-10-20. The historical translated pages hosted on
Dota's official Chinese site reproduce VDC documentation, but they are **not a
frozen, certified manual for the 2017-10-03 build**. Therefore, UI labels and
actual support must be confirmed locally. Modern documentation does not replace
that check. The copied documentary catalog does not establish a new runtime test.

## Operational matrix

| Tool/component | Supported use | Limit to preserve | Initial evidence |
|---|---|---|---|
| Workshop Manager | Select an addon and open tools. | It is not a batch converter. | D3 |
| Asset Browser | Search, filter, preview dependencies, and open an editor. | Preview/filter does not prove runtime origin. | D2 |
| Hammer | Import a VMF if the selected build exposes that route, edit the map, and compile. | It does not decompile the BSP in this workflow; it does not prove every asset was ported. | D1/D5; version-specific evidence |
| Tile/mesh/entity tools | Edit map components. | Do not assume they automatically reconstruct S1 terrain with modern S2 tiles. | D1; P |
| Model Editor | Create VMDL from compatible meshes; fix materials, skins, attachments, animations, and collision using source files. | Do not assume universal MDL decompilation; compiled data is not source. | D7–D11 |
| Material Editor | Create/edit VMAT, select shaders/textures, and compile. | Do not assume automatic VMT/VTF import or shader equivalence. | D6/D6b; ? |
| Particle Editor | Edit/preview S2 effects and their dependencies. | Native PCF→VPCF conversion has not been demonstrated here. | D13; ? |
| Source1Import | Internal `dota2.exe` Source 1 asset converter; see the [2439 workflow](source1import/2439.md). | Removed after build 2440; validate outputs by asset class. | U; version-specific evidence |
| ResourceCompiler | Build through editors and compile resources. | Verify the installed CLI before automating it. | D5/D7; P |
| VConsole | Process commands, autocomplete, and logs. | It must be connected to the correct session. | D14 |
| Dota runtime | Test the addon, appearance, states, and navigation. | An old map does not automatically restore old rules. | D1/D15; P |
| Source Filmmaker | Cinematic validation when present in the installation. | Observe the labels/load path; it does not validate gameplay. | version-specific evidence; ? |
| Panorama debugger | Inspect UI. | It does not convert 3D resources; confirm F6 locally. | D1/D16 |
| Sound/sound-event tools | Inspect and test only tools/formats that are present. | Incomplete documentation does not authorize inventing an editor/importer. | D18; ? |
| Item tools | Cosmetic workflow, if exposed. | Do not use as an addon substitute or publish without a request. | version-specific evidence; P |
| VPK/texture/other viewers | Inventory and use what is available. | Reading/packing does not convert a resource format. | ?; P |

## Criteria for claiming native support

Record four things: **input is genuinely Source 1**, **operation exists in this
build**, **valid new output**, and **visual/dependency identity**. If any are
missing, the result is inconclusive, partial, or manually reconstructed. Missing
documentation for a capability does not prove that the binary lacks it.

Do not treat an earlier research claim of a “golden reference” or complete
internal pipeline as executable validation. Use earlier reports to guide
inspection, not as proof that specific models/materials/particles were already
converted.

## Primary/documentary source catalog

The instructions are synthesized; this package does not include full copies of
documentation, Valve assets, DLLs, or executables.

### D1 — Valve, official Reborn/tools overview
https://www.dota2.com/reborn/part2

Supports the Hammer/Material/Model/Particle/Console/Panorama/Lua toolset and its
integration with the game. Historical feature evidence, not an exhaustive list
of every 2017 menu.

### D2 — Asset Browser, Dota documentation
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Addon_Overview/Asset_Browser.htm

Search by name, Mods, types, dependencies, and opening tools.

### D3 — Getting Started, Dota documentation
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Level_Design/Getting_Started.htm

Launcher, addon, opening Hammer, and its relationship to the Dota process.

### D4 — Navigation, Dota Hammer
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Level_Design/Navigation.htm

Navigation shortcuts and viewport focus; do not confuse with Source 1 Hammer.

### D5 — Compile and Run
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Level_Design/Compile_and_Run.htm

Build Map/F9, run options, packed maps, and launching a custom game.

### D6 — Material Editor
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Materials/Material_Editor.htm

Interface, features/variables, history, logs, and compilation.

### D6b — Material Creation
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Materials/Material_Creation.htm

Creating a material, a shader example, and choosing a source texture.

### D7 — Model Editor
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Model_Editor.htm

Opening and automatic recompilation on save/dependency changes.

### D8 — Model Creation and formats
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Modeling/Model_Creation.htm
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Modeling.htm

Creating VMDL from a mesh; collision menu; listed formats.

### D9 — Model Editor Layout
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Model_Editor/Layout.htm

Editable/Compiled Data, materials, and recompilation. Warnings about incomplete
features reinforce the need to test the build.

### D10 — Model Menu
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Model_Editor/Model_Menu.htm

Material remapping, groups, LODs, attachments, and collision.

### D11 — Animation Menu
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Model_Editor/Animation_Menu.htm

Adding animations/groups/constraints from available source files.

### D12 — Lighting, Dota
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Level_Design/Dota/Lighting.htm

Documents dynamic lighting and entities for this generation. Do not extrapolate
shader/render-pipeline names to every version without inspection.

### D13 — Particle Editor
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Particles/Particle_Editor.htm

Functions, properties, children, preview, and simulation controls.

### D14 — VConsole
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Addon_Overview/VConsole.htm

Autocomplete, command selection, and log separation.

### D15 — Common Developer Commands
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Level_Design/Dota/Common_Developer_Commands.htm

Local testing commands; confirmation through autocomplete remains required.

### D16 — Panorama Debugger, VDC documentation
https://developer.valvesoftware.com/wiki/Zh/Dota_2_Workshop_Tools/Panorama/Debugger

F6 and panel selection. Content was consulted through an indexed result; direct
VDC access was limited by HTTP 403 on several pages during this research.

### D17 — Microsoft, Hard Links and Junctions
https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions

Sharing content/attributes through hardlinks. Basis for isolating writable staging
from an immutable inventory.

### D18 — Sounds, historical documentation
https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Sounds.htm

The page says audio authoring was planned, without detailing tools. It does not
prove those tools were absent in 2017; it marks the limits of available evidence.

### D19 — Agent Skills specification
https://agentskills.io/specification

SKILL.md format, frontmatter, scripts, and optional reference loading. This is the
skill package specification, not Valve documentation.

### Historical implementation evidence

The [Source1Import reference](source1import/2439.md) scopes native conversion to
the historical build. Check the installed configuration and binaries;
changes to a tracked configuration block do not prove that implementation code
was removed or that a public importer exists.

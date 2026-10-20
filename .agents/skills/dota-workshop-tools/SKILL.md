---
name: dota-workshop-tools
description: Operate Dota Workshop Tools across current and historical builds using the Dota Workshop MCP, with local CLI and editor fallback. Use for installation selection, addon build and launch, VConsole debugging, or Source 1 map and asset import with provenance and fidelity checks.
metadata:
  version: "2.0.0"
---

# Dota Workshop Tools

Use the Dota Workshop MCP as the primary interface. Pin the installation before
operating on an addon; its folder name, API reference family and source asset
snapshot are separate identities.

## 1. Select the installation

Discover the available MCP tools and read their schemas. Names below are server
tool names; the host may add a namespace. Read the [MCP reference](references/mcp.md)
for installation selection, API versions and fallback.

1. Call `dota_installations`. If the requested installation is missing, register
   its root or executable with `dota_register_installation`; registration does
   not select it.
2. Call `dota_select_installation` with its returned `installationId`, or its
   exact `activeVersion` when unambiguous. Set the intended `vconPort` and, when
   known, `pid`. Selection does not restart Dota.
3. Confirm the returned installation and `steam.inf` identity. Pass the addon's
   absolute `projectRoot` to project tools, or use `DOTA2_ADDON_DIR`. The plugin
   directory is not an addon.

If MCP is unavailable, establish the same executable/build, addon and endpoint
through fallback before changing files or starting tools.

## 2. Choose the tool

References are organized by tool. Read the page for the requested operation;
its first section lists MCP endpoints and short usage notes. Build-specific
settings and editor fallback live with that tool's instructions.

| Tool | Read when |
|---|---|
| [Dota 2](references/dota2/launch.md) | Launching the selected build or choosing startup parameters; use [runtime validation](references/dota2/runtime.md) for local map/asset checks. |
| [Workshop Manager](references/workshop-manager.md) | Opening the correct editor session, discovering installed tools or recovering an editor operation. |
| [Asset Browser](references/asset-browser.md) | Finding resources, inspecting their origin or opening an editor. |
| [Hammer](references/hammer.md) | Importing a VMF, editing geometry/entities or building a map. |
| [Source1Import](references/source1import/2439.md) | Converting Source 1 assets through the internal historical tool; read [staging and fidelity](references/source1import/staging-and-fidelity.md) for dependencies and comparisons. |
| [ResourceCompiler](references/resourcecompiler.md) | Compiling sources with the selected build's compiler. |
| [Material Editor](references/material-editor.md) | Editing VMAT sources, shaders and textures. |
| [Model Editor](references/model-editor.md) | Editing meshes, materials, skins, animations and collision. |
| [Particle Editor](references/particle-editor.md) | Editing effects, children and control points. |
| [VConsole](references/vconsole.md) | Sending commands, collecting logs or switching MCP/gateway/VConsole2 ownership. |
| [Source Filmmaker](references/source-filmmaker.md) | Comparing rendered scenes in the selected installation. |
| [Panorama](references/panorama.md) | Looking up APIs or debugging addon UI. |
| [Sound tools](references/sound-tools.md) | Checking audio resources and the installed preview/editor capabilities. |
| [Asset auditor](references/asset-auditor.md) | Taking read-only file snapshots and comparing changes. |

Tool pages use the [source catalog](references/sources.md) for documentation and
evidence labels. Confirm menus and capabilities in the selected build.

## 3. Run the smallest useful operation

Use `dota_doctor` and `addon_info` for setup inspection. Preview available
launch/build commands with `dryRun:true`, then perform the authorized operation.
For console work, verify `vconsole_status` with `connect:true` and inspect its
health fields; receiving a response alone is not a successful round trip.
Use bounded logs and read the command's actual output before deciding to retry.

For operations absent from MCP, use the selected installation's verified CLI,
then the relevant editor page above. MCP failure does not justify switching to
a different build. After a timed-out mutation, inspect files and runtime state before any
fallback or retry; the original operation may have completed.

For Source 1 conversion, start with a ground material, prop, alpha-cutout tree and
building; include animation or particles when their source inputs exist. Preserve
source-relative paths and the dependency chain. Save a raw map import before
editing a working copy.

## 4. Preserve identity and record evidence

- Keep source snapshot, importer/compiler build and target runtime separate.
  Use writable staging copies and separate compiled trees for each target.
  Preserve source VPK chunks, entities, collision, particles and dependencies.
- Keep immutable inputs and hardlinked inventories out of editor write paths.
  For necessary `gameinfo.gi` changes, back up independently, serialize sessions
  sharing that file, record the diff, and restore/hash-check it after the run.
- Use the [session template](assets/session.template.json) for a multi-step run
  and the [report template](assets/report.template.md) for its results. Record
  MCP calls or fallback commands, inputs, output hashes, logs and limitations.
- The copied [asset auditor](scripts/audit_assets.py) provides read-only SHA-256
  snapshots and diffs. Read [audit usage](references/asset-auditor.md) before
  using it; a file diff proves changes, not conversion or rendering.
- Preview galleries can use a separate asset corpus. A preview thumbnail or
  approximate particle animation does not establish the selected runtime's
  loaded asset. Use the bundled `share-preview` skill when the user requests
  browsing, sharing or recording.

## Completion

Track `generated`, `compiled`, `preview_verified`, `runtime_verified` and
`fidelity_verified` independently. Tool discovery, dry runs, successful command
transport and static inspection do not establish any later gate. A runtime test
validates only that identified build. Leave unobserved gates `not_tested`.

For unavailable editor control, finish useful file/CLI checks and state the
specific pending UI action. Local addon work does not include Workshop publishing,
matchmaking, updating historical installations or terminating unrelated sessions.
Deliver the concrete output paths, validated gates, unresolved asset classes and
restored or pending temporary settings.

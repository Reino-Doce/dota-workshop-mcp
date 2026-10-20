# Particle Editor

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `assets_search` | Supply `projectRoot`, `query` and `type:"vpcf"` to find particle sources. |
| `kv3_read` | Supply `projectRoot` and the source `path` to inspect a KV3-text VPCF. |
| `asset_preview` | Use `query` and `kind:"particle"` for particle sprite previews from the downloaded Workshop library. |
| `preview_studio` | Use `query` and `share:false` for a local gallery with approximate particle animation; `share:true` publishes a tunnel URL. |
| `addon_compile_content` | Supply `projectRoot` and inspect `dryRun:true` before compiling changed content with the selected build. |
| `vconsole_logs` | Read bounded events with `pattern`, `after` and `limit` to investigate runtime effect/dependency errors. |

Preview endpoints may install their decoder on first use and use a separate
downloaded library. Operator, child and control-point edits use Particle Editor;
the gallery does not validate engine simulation.

## Editor workflow

**D [D13]:** open an addon VPCF. Use the function panel to select the component;
edit parameters in the properties panel. Also inspect `Children`, which refers to
child effects, and the resources used by renderers.

In preview, `Restart sim` restarts the effect; `Pause/Play sim` controls the
simulation; `Stop sim` stops emission without immediately removing living
particles. `Reset camera` restores the framing. Control-point options help verify
execution conditions. [D1, D13]

**Proposed:** record materials/textures, children, position, scale, time, and
control points. Test in isolation and on the entity that instantiates it. A
missing flame may be an unconverted child or undefined control point, not a map
failure. Do not silently remove operators to avoid warnings.

For S1 PCF, look for a genuinely exposed native action and test it. Do not assume
that `File > Open` on a VPCF converts PCF. This skill has no experimental proof of
universal PCF import in the selected build.

The historical internal converter is covered by [Source1Import](source1import/2439.md).

Documentation: [D13](sources.md). Menus depend on the selected build.

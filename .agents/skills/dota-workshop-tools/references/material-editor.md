# Material Editor

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `assets_search` | Supply `projectRoot`, `query` and `type:"vmat"` to find material sources. |
| `kv_read`, `kv3_read` | Supply `projectRoot` and `path`; choose `kv_read` for KV1 text or `kv3_read` for KV3 text. |
| `asset_preview` | Use `query` and `kind:"texture"` to inspect decoded textures from the downloaded Workshop library; it does not render the material shader. |
| `addon_compile_content` | Supply `projectRoot` and inspect `dryRun:true` before compiling changed addon content with the selected build. |

Texture previews may install a decoder on first use. Shader and material-property
editing uses the native editor; MCP has no dedicated editor-property endpoint.

## Source 2 source workflow

Open the material from the browser or the editor icon. Confirm that you are editing
a writable `.vmat` source in the addon. To create one manually: use `File > New`,
save under `content\dota_addons\ADDON\materials\...`, choose the shader, and
select the image with the file button under `Variables`, group `Color`. The
tutorial uses `Global Lit Simple`; it is an example, not a universal replacement
for S1 shaders.

`Shader Features` options determine which variables are available. Adjust only
properties supported by the old data: color, cutout/transparency, normal, masks,
emissive, double-sided rendering, and blending **when exposed by the shader**.
Do not automatically treat alpha as opacity.

Save. Use `File > Force Compile To Disk` when needed and check the log. The hosted
materials panel can open resources and work with a model's materials; do not
confuse it with batch VMT conversion.

## VMT/VTF input — build probing

For the historical internal converter, use [Source1Import](source1import/2439.md);
its build-2439 workflow is separate from this editor's ordinary VMAT authoring.

Inspect `File`, any import options, and the file picker filter. If a Source 1 route
exists, test one VMT with all referenced VTFs in staging. Record the exact
command/menu, generated images, `.vmat`, compiled files, and warnings.

If the editor accepts only S2 sources/images, it is still useful for reauthoring
and validation, but that **does not prove automatic VMT/VTF→S2 conversion**. Do
not run a guessed `vmt_to_vmat.exe`, rename VTF to TGA, or save VMT as VMAT by
changing its extension.

**Proposed acceptance:** reopen the material, confirm the images it actually
references, and apply it to a test asset. Inspect leaf/alpha against light and
dark backgrounds. A correct shader with a modern texture is a provenance failure.

Documentation: [D6, D6b](sources.md). Menus depend on the selected build.

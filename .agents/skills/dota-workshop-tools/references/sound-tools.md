# Sound tools

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `soundevents_list` | Supply `projectRoot` to list addon `.vsndevts` files and their event names. |
| `soundevents_get` | Supply `projectRoot`, `file` and `event` to inspect one sound-event definition. |
| `soundevents_upsert` | Supply `projectRoot`, `name`, `vsnd_files` and optional mixing fields to create/update an event; recompile afterwards. |
| `kv3_read` | Supply `projectRoot` and `path` to inspect a KV3-text sound-event source. |
| `sound_preview` | Use `query` and optional library `id` to audition decoded sounds from downloaded Workshop games; first use may install the decoder. |
| `addon_compile_content` | Supply `projectRoot` and inspect `dryRun:true` before compiling sound resources/events with the selected build. |

These endpoints cover sound-event files and library previews. Native waveform
editing and Source 1 sound-script conversion require a verified editor workflow.

## Editor fallback

Inventory extensions and dependencies. If this build has a sound
viewer or sound-event editor, record its actual name, preview, accepted format,
and output. An old page says audio authoring was still to be added; that does not
prove presence or absence in 2017. Do not invent a universal `Sound Editor` or
automatic conversion for all Source 1 sound scripts. [D18]

Documentation: [D18](sources.md). Menus depend on the selected build.

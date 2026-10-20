# Dota Workshop MCP

Discover the server's tools and inspect their current schemas. The host may add
a namespace to tool names. MCP availability does not prove a game is running.

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `dota_installations` | List discovered/registered installations, their stable IDs and the current selection. |
| `dota_register_installation` | Supply a root or executable `path` to register an installation without selecting it. |
| `dota_select_installation` | Choose one selector (`installationId`, `activeVersion`, `path` or compatibility `version`), plus the intended `vconPort` and optional known `pid`. |
| `dota_doctor` | Supply `projectRoot` to inspect the selected installation, tools and addon setup. |

Endpoints on each tool page are MCP tool names. Supply the named inputs using
the host's tool-call interface; read the current schema for optional arguments.

## Installation selection

1. Use `dota_installations`; register a missing root/executable with
   `dota_register_installation`.
2. Select its `installationId` with `dota_select_installation`, including the
   intended `vconPort` and known `pid`. Selection does not restart Dota.
3. Check the selected root's `game/dota/steam.inf`. ClientVersion, SourceRevision,
   source asset snapshot and Steam BuildID are separate identities.
4. Pass the addon's absolute `projectRoot` to project tools or configure
   `DOTA2_ADDON_DIR`. The plugin directory is not the addon.

Build 2439 identifies the 2017-10-03 client, SourceRevision 4163623.
"Current" is a moving family: record the actual ClientVersion and use the
matching tool notes. Directory names such as "reborn" do not establish a build.
Installation discovery can register unfamiliar builds without certifying their
flags, editors, compiler formats or APIs. If metadata is missing, retain that
uncertainty and verify one representative resource before batching.

## Operations and fallback

| Operation | Preferred MCP tools | Tool reference / fallback |
|---|---|---|
| Installation and setup | `dota_installations`, `dota_register_installation`, `dota_select_installation`, `dota_doctor`, `addon_info`, `addon_audit` | Read the selected root's metadata, addon paths and process identity. |
| Launch | `dota_launch` | [Dota 2](dota2/launch.md) |
| Commands and logs | `vconsole_status`, `dota_send_console_command`, `vconsole_logs`, `vconsole_tail`, `vconsole_audit` | [VConsole](vconsole.md) |
| Resource compilation | `addon_compile_content` | [ResourceCompiler](resourcecompiler.md) or [Hammer](hammer.md) |
| Script build | `addon_build` | The addon's declared build script and dependencies; raw Lua does not require a TypeScript scaffold. |
| Lua API lookup | `lua_api_search`, `lua_api_get`, `lua_api_class_methods` | Matching bundled captures, local engine help, then primary documentation. |
| Panorama API lookup | `panorama_api_search`, `panorama_api_get` | [Panorama](panorama.md) and matching API documentation. |
| Native import and editor work | A discovered tool only when it supports the requested operation | [Source1Import](source1import/2439.md) or the specific editor page linked from the skill. |

Preview launch/build operations with `dryRun:true`. When MCP cannot perform an
operation, preserve the selected build, addon and endpoint through CLI/editor
fallback. After a timeout, inspect logs and outputs before retrying: the first
mutation may have completed. Do not silently select the current Steam install.

## API versions

Installation selectors accept exact build numbers such as `"2439"`; API `version`
accepts `"auto"`, `"2017"` or `"current"`, not arbitrary ClientVersion values.

- `2017` uses build-2439 engine captures with labeled supplemental declarations,
  pinned to [GameTracking b0c2741](https://github.com/SteamTracking/GameTracking-Dota2/tree/b0c2741e6f27ec8dbf7c64b5dd16b09b744e8b43).
- `current` uses the bundled upstream ModDota reference, not a dump of the
  installed engine. Confirm uncertain functions/enums through local help or a
  small addon test on that build.
- `auto` selects a family reference. Read the returned provenance and check
  `DOTA2_API_VERSION`, which can override automatic selection.

For an unfamiliar build, verify uncertain APIs against version-matched captures
or local help. Modern guides and TypeScript dependencies may not fit an older
addon. API lookup and command transport do not establish conversion or rendering.

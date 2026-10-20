# Build 6964: launch options

Options for the 2026-10-19 client, using its module messages and this repository's
launch profile. This list does not transfer historical build-2439 behavior to
current installations.

## Tools and launch

| Parameter | What it does |
|---|---|
| `-tools` | Start in Workshop Tools mode. |
| `-addon <name>` | Select the addon in the MCP launch profile. |
| `-asset <path>` | Supply an asset to the startup tool. |
| `-game <name>` | Set the game/mod name; the engine also accepts the `VMOD` environment variable. |
| `-console` | Enable the developer console in the MCP launch profile. |
| `-dev` | Enable developer mode and additional debug messages. |
| `-uidev` | Enable UI development mode in the MCP development profile. |
| `-vconport <port>` | Select the VConsole listener port in the MCP launch profile. |
| `-novid` | Request skipping the intro video in the MCP launch profile. |
| `-insecure` | Start without VAC. |
| `-noassetbrowser` | Suppress the Asset Browser window. |
| `-playtest` | Disable reading and writing user configuration. |
| `-nohltv` | Prevent creation of the SourceTV socket. |
| `-tvprimaryonly`, `-tvmasteronly` | Restrict SourceTV to primary-only mode; this is not a one-viewer limit. |

## Rendering and debugging

| Parameter | What it does |
|---|---|
| `-dx11` | Select the Direct3D 11 renderer. |
| `-vulkan` | Select the Vulkan renderer. |
| `-dx11debug` | Enable native Direct3D error diagnostics. |
| `-renderdoc` | Enable RenderDoc integration; RenderDoc must be installed. |
| `-vulkan_track_device_addresses` | Track GPU address bindings so diagnostics can resolve Vulkan device addresses. |
| `-vulkan_track_pipeline_compile_times` | Measure Vulkan pipeline compilation times; clear the shader cache to measure fresh compilation. |
| `-shaderstats` | Enable shader statistics required by `mat_shading_complexity`. |
| `-stringtabledebug` | Force string-table debugging. |
| `-memstackstats` | Enable memory stack statistics used by `stackstats`. |
| `-vscriptdebug` | Wait for a VScript debugger connection. |
| `-vscriptdebug_script <script>` | Wait for a VScript debugger connection for the specified script. |
| `-clearassertstate` | Clear remembered assertion-ignore state. |
| `-disable_stall_monitor` | Suppress the tools stall-monitor thread. |
| `-testmode` | Suppress the tools stall monitor for testing; other test-mode effects are not documented here. |
| `-nominidumps` | Disable minidump generation. |
| `-noloaderlockprobe` | Skip the loader-lock probe; a workaround for the reported loader-lock probe error. |
| `-resource_exit_after_time <seconds>` | Exit after the resource-system time limit. |

## Additional Source-reference options

These names occur in this build's strings. Their descriptions come from the
supplied `cmd-line.md` table and remain untested on this build.

| Parameter | What it does |
|---|---|
| `-buildcubemaps` | Build cubemaps after a map finishes loading, then quit. |
| `-noassert` | Change assertion handling to allow debugger attachment. |
| `-nocrashdialog` | Suppress some crash-message dialogs on Windows. |
| `-testscript <file>` | Load a `.vtest` test script. |

## Unidentified flags

String candidates retained from this build; meanings and launch support are
unverified.

`-RestartSelfFromAlternateLocation_RelaunchTime`, `-abandoned`, `-aggs`, `-all`, `-allents`, `-allow_third_party_software`, `-antiaddiction_test`, `-assert`, `-assert_content`, `-attachtodebugger`, `-binary`, `-botworldstatetosocket_dire`, `-botworldstatetosocket_radiant`, `-breakimmediately`, `-buildsparseshadowtree`, `-cached`, `-classes`, `-cloth`, `-collision`, `-component`, `-con_logfile`, `-concommandpipe`, `-consoleapp`, `-consolelog`, `-debugbreak`, `-diff`, `-empty`, `-enable_qaccessible`, `-error`, `-error_if_idle`, `-extended`, `-instance`, `-loose`, `-mem`, `-more`, `-multiple`, `-multiple_tools_instances`, `-no_mouse`, `-noautoargs`, `-nofocus`, `-noiocp`, `-nopretty`, `-noscreenshot`, `-pdiff`, `-perfectworld`, `-product`, `-psrs`, `-report`, `-retail`, `-retire`, `-rollback`, `-rtest1`, `-rtx`, `-save`, `-sdk`, `-shaderdebugging`, `-show_none`, `-show_used_combos`, `-snap`, `-snapshots`, `-steampath`, `-stream`, `-testscript_inline`, `-toggle`, `-touch`, `-trusted`, `-vulkan_disable_dontinline`, `-vulkan_disable_validation_core_checks`, `-vulkan_disable_validation_object_lifetimes`, `-vulkan_disable_validation_shaders`, `-vulkan_disable_validation_unique_handles`, `-vulkan_enable_gpu_validation`, `-vulkan_enable_sync_validation`, `-vulkan_enable_sync_validation_conservative`, `-vulkan_enable_thread_safety_validation`, `-vulkan_gpuav_shader_names`, `-world`, `-worldwide`

Sources: [build-6964 tracking snapshot](https://github.com/SteamTracking/GameTracking-Dota2/tree/4b1b9b2bbfb8e96f352b9936545d3cc298882cd6),
[Valve Developer Community](https://developer.valvesoftware.com/wiki/Command_line_options),
[MCP launch profile](https://github.com/Reino-Doce/dota-workshop-mcp/blob/8431bbf7db1d3a6c29b65a4c4122df6b87611b43/src/dota/launch.ts).

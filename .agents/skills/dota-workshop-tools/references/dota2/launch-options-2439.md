# Build 2439: launch options

Options for the 2017-10-03 client. Descriptions combine the supplied `cmd-line.md`
table and Valve Developer Community reference with this build's recorded flags.
General Source descriptions and aliases are not all runtime-tested on this build.
The `-nowindow` and `-allowmultiple` notes reflect reported build-2439 behavior.

## Tools and console

| Parameter | What it does |
|---|---|
| `-tools` | Start in Workshop Tools mode. |
| `-addon <name>` | Select the addon. |
| `-tool <name>` | Open a named tool, such as `workshopmanager`. |
| `-asset <path>` | Supply an asset to the startup tool. |
| `-nowindow` | Run without the game window. Closing all tool windows leaves the engine running: send `exit` or `quit` through VConsole2 or MCP, or terminate that specific process after saving work. |
| `-allowmultiple` | Allow additional engine processes only when `VPROJECT` is defined in their environment. It does **not** allow multiple tool instances. |
| `-console` | Enable the developer console at startup. |
| `-dev` | Enable developer mode and additional debug messages. |
| `-allowdebug` | Allow debug modules and developer startup behavior unless `-nodev` overrides it. |
| `-nodev` | Override the startup effects of `-dev` and `-allowdebug`. |
| `-hideconsole` | Keep the game console hidden, overriding console/developer startup switches. |
| `-uidev` | Enable UI development mode; included by the MCP development launch profile. |
| `-vconsole` | Enable the VConsole communication module. |
| `-vconport <port>` | Select the VConsole listener port; default `29000`. This is separate from the game-server port. |
| `-vconbuffer <size>` | Set the VConsole buffer-size input; default `8192`. |
| `-condebug` | Write console output to `console.log`. |
| `-conclearlog` | Clear `console.log` at startup; requires `-condebug`. |
| `-flushlog` | Flush log output periodically; the Source reference describes a one-second interval. |
| `-uselogdir` | Write logs under a map-specific `logs/(mapname)/` directory. |
| `-toconsole` | Start at the console unless `+map` selects a map. |
| `-vguimessages` | Emit VGUI diagnostic messages. |
| `-vguifocus` | Emit VGUI input-focus diagnostics. |
| `-nocrashdialog` | Suppress some unhandled-error dialogs. |
| `-noassert` | Change assertion handling to allow debugger attachment. |
| `-nobreakpad` | Disable the Breakpad crash handler. |
| `-nominidumps` | Disable minidump generation. |

## Display and performance

| Parameter | What it does |
|---|---|
| `-w <pixels>`, `-width <pixels>` | Set the horizontal resolution. |
| `-h <pixels>`, `-height <pixels>` | Set the vertical resolution. |
| `-fullscreen`, `-full` | Start fullscreen. |
| `-sw`, `-window`, `-windowed`, `-startwindowed` | Start windowed. |
| `-noborder` | Remove the border from a windowed game; combine with a windowed-mode option. |
| `-x <position>`, `-y <position>` | Set the horizontal or vertical position of a borderless window. |
| `-refresh <rate>`, `-refreshrate <rate>`, `-freq <rate>` | Request a display refresh rate. |
| `-dx11` | Select the Direct3D 11 renderer. |
| `-vulkan` | Select the Vulkan renderer. |
| `-gl` | Select the OpenGL renderer when the installed platform/modules provide it. |
| `-adapter <index>` | Select a GL graphics adapter; applicable to the GL renderer. |
| `-autoconfig` | Restore hardware-derived video/performance defaults and ignore configuration-file overrides while present. |
| `-high` | Request high process priority. |
| `-low` | Request low process priority. |
| `-threads <count>` | Set the thread-pool size. |
| `-forcenovsync` | Force vertical synchronization off. |
| `-disallowhwmorph` | Disable hardware morphing, equivalent to `mat_disablehwmorph 1` in the Source reference. |
| `-resizing` | Allow resizing the game window below its normal minimum resolution. |

Renderer availability depends on the installed platform and modules. The short
window/fullscreen aliases and refresh-rate forms above are described by the
Source reference; confirm the chosen spelling before relying on it in automation.

## Content, input and networking

| Parameter | What it does |
|---|---|
| `-game <directory>` | Select the game/mod directory. |
| `-defaultgamedir <directory>` | Set the fallback game directory when `-game` is omitted. |
| `-language <name>` | Select a language, for example `english`. |
| `-all_languages` | Load all language files. |
| `-override_vpk` | Prefer loose files over matching VPK contents. |
| `-makereslists` | Generate resource lists; scripted collection with `-textmode` is described by the Source reference but remains unverified here. |
| `-noasync` | Use synchronous filesystem operations instead of asynchronous access. |
| `-tempcontent` | Add the game's `_tempcontent` directory to the content search paths. |
| `-noclearsave` | Preserve the save directory after restoring a save. |
| `-novid` | Skip the Valve intro video. |
| `-endgamevid` | Use `EndGameVids.txt` instead of `StartupVids.txt` and keep startup-video playback enabled. |
| `-recapvid` | Use `RecapVids.txt` instead of `EndGameVids.txt` for the recap sequence. |
| `-forcestartupmenu` | Force the background menu map to load, including developer/direct-map startup. |
| `-lv` | Enable low-violence mode; the affected content depends on the game. |
| `-nosound` | Disable audio support. |
| `-nomouse` | Disable in-game mouse input. |
| `-nojoy` | Disable joystick input. |
| `-useforcedmparms` | Enable the `-noforcemaccel` and `-noforcemspd` controls. |
| `-noforcemaccel` | Use the operating system's mouse acceleration settings; requires `-useforcedmparms`. |
| `-noforcemspd` | Use the operating system's mouse speed settings; requires `-useforcedmparms`. |
| `-port <port>` | Select the listen-server port; the Source reference gives `27015` as its default. |
| `-maxplayers <count>` | Request the server's maximum player count. |
| `-tickrate <rate>` | Request a server tick rate where the engine branch permits changes; this build's behavior is unverified. |
| `-nodns` | Disable DNS lookups. |
| `-noip` | Disable IP binding/network support; this is separate from Steam offline mode. |
| `-nohltv` | Disable SourceTV and its listening socket. |
| `-steamport <port>` | Set the master-server updater port; the Source reference places Steam authentication on the following port. |
| `-NoQueuedPacketThread` | Prevent creation of the queued-packet thread on Linux; support in `dota2.exe` is unverified. |
| `-insecure` | Disable VAC. This does not make the process offline. |

The mouse-parameter controls are described for Windows.

## Diagnostics and profiling

| Parameter | What it does |
|---|---|
| `-bugbait` | Tell the engine it is loading an internal Bugbait bug report. |
| `-debugdxsupport` | Print DirectX hardware-configuration diagnostics while shader devices load their settings. |
| `-dumpvidmemstats` | Write video-memory statistics to `vidmemstats.txt`; the diagnostic stops the model loader. |
| `-fs_log <file>` | Record filesystem accesses in a file-copy batch script. |
| `-fs_logbins` | Include loaded binaries in the `-fs_log` copy script. |
| `-fs_target <directory>` | Set the destination game directory used by the `-fs_log` copy commands. |
| `-gamestatslogging` | Enable game-statistics logging. |
| `-gamestatsloggingtofile` | Write game statistics to `gamestats.log`; also enables `-gamestatslogging`. |
| `-heapcheck` | Check heap integrity at startup and each frame on Windows. |
| `-ignoredxsupportcfg` | Skip reading `dxsupport.cfg`. |
| `-log_opened_files` | Record opened file paths in `opened_files.txt` for load diagnostics. |
| `-netspike <count>` | Set the network-trace record threshold before clearing `netspike.txt`. |
| `-pme` | Enable performance-monitoring events on supported Intel processors. |
| `-profile` | Log additional profiling details, including map startup time. |
| `-textmessagedebug` | Print client text messages to the console. |

## Unidentified flags

String candidates retained from this build; meanings and launch support are
unverified.

`-A`, `-B`, `-DANGER_MODE_ignore_schema_mismatches`, `-R`, `-ReturnFromExternalScene`, `-addon_path`, `-aggs`, `-allents`, `-allocwarnmb`, `-animdecodecachemem`, `-antiaddiction_test`, `-arrangements_file`, `-arrangments_file`, `-as-exclH`, `-as-withH`, `-attachtodebugger`, `-autoconfig_level`, `-background`, `-batchwarnings`, `-bench`, `-benchframes`, `-benchnoexit`, `-benchnote`, `-benchtime`, `-border`, `-botworldstatetosocket_dire`, `-botworldstatetosocket_frames`, `-botworldstatetosocket_radiant`, `-breakimmediately`, `-breaksteam`, `-bugvoice`, `-c`, `-classes`, `-clearassertstate`, `-comment`, `-con_logfile`, `-con_timestamp`, `-consoleapp`, `-consolelog`, `-contentroot`, `-coop_fullscreen`, `-cursor_scale_percent`, `-curtimeasserts`, `-curtimewarnings`, `-debug_exitprocess`, `-debugbreak`, `-debugsoundqueue`, `-debugwelcome`, `-dedicated`, `-devcontent`, `-disable_auto_vpk_loading`, `-disable_cursor_clip`, `-disableboneuniformbuffers`, `-dontEvictTextures`, `-dota_league_static_data_force_webapi`, `-dotatestmodels`, `-dumpallshaders`, `-dx9`, `-dxlevel`, `-dxwarp`, `-e`, `-emaildumps`, `-empty`, `-etwprofile`, `-exit_on_resource_load_failure`, `-f`, `-fail_vpk_crc`, `-fill_with_bots`, `-filmgrain`, `-find_unlocalized`, `-forceReloadParticleSnapshots`, `-force_all_resource_loads_to_fail`, `-force_allow_coop_fullscreen`, `-force_allow_excl_fullscreen`, `-force_pc_bang`, `-forcetouch`, `-fpexcept`, `-framesamples`, `-fs`, `-full_memory_dumps`, `-full_render_callback_clear`, `-g`, `-gamestatsfileoutputonly`, `-gl_amd_pinned_memory`, `-gl_apitrace`, `-gl_debug`, `-gl_disable_420pack`, `-gl_disable_binary_shaders`, `-gl_disable_buffer_storage`, `-gl_disable_compressed_texture_pixel_storage`, `-gl_disable_defer_shader_compiles`, `-gl_disable_dsa`, `-gl_disable_immutable_textures`, `-gl_disable_shared_constant_buffers`, `-gl_enable_compressed_texture_pixel_storage`, `-gl_enable_pseudobufs`, `-gl_force_sm30`, `-gl_nv_bindless_texturing`, `-gl_perf_marker_ado`, `-gl_perf_marker_gremedy`, `-gl_perf_marker_khr`, `-gl_recreate_ubos_on_update`, `-gl_small_pmbs`, `-gl_time_shader_compiles`, `-gl_validate_shader_early`, `-glcheckerrors`, `-glmdisabletrustblit`, `-glmenabletrustblit`, `-glmrenderer0`, `-glmrenderer1`, `-glmrenderer2`, `-glmrenderer3`, `-glmspewcaps`, `-glrenderthreadstack`, `-gtpoollimitexec`, `-gtpoolstacksize`, `-hero`, `-herophotos`, `-herorecorder`, `-herorecorder_preview`, `-hlsl_to_spirv`, `-hometest`, `-hud_nospectate`, `-hugeportrait`, `-hushsteam`, `-icon_editor`, `-ignorecontentasserts`, `-ignorepartneraccountstate`, `-input_button_code_is_scan_code`, `-input_message_spew`, `-inputss_update_spew`, `-ioidlecheck`, `-kshadows`, `-limitvsconst`, `-loose`, `-luajit`, `-lunarg_no_present_fence`, `-mainthreadpriority`, `-mantle`, `-materialsystem2_strict`, `-maxdxlevel`, `-maxelements`, `-maxtextureres`, `-more`, `-mpi_worker`, `-msaa`, `-multigpu`, `-multiple`, `-multiplier`, `-net_no_parallel_build`, `-netconpassword`, `-netconport`, `-networkspew`, `-networkspewcreate`, `-networkspewentity`, `-networkspewexcludes`, `-networkvar_validate`, `-newlayout`, `-newtexturestreaming`, `-newuser`, `-nexonDISABLED`, `-no_bundle_module`, `-no_environment_maps`, `-no_in_game_scaleform`, `-no_irrad_volumes`, `-no_mouse`, `-no_tier2_bundle`, `-no_tier3_bundle`, `-no_vrconfig`, `-noasyncmaterialload`, `-noautoargs`, `-nocustomermachine`, `-nodedicatedconsole`, `-noexecheck`, `-noexitprocess`, `-nofocus`, `-nogamestats`, `-nogammaramp`, `-noime`, `-nolod`, `-nomultigpu`, `-nopanorama`, `-nopassiveasserts`, `-nophud`, `-nopvs`, `-norebornhud`, `-noscaleform`, `-noscaleformhud`, `-noscripting`, `-noshaderopts`, `-nostartupmenu`, `-notoolsdev`, `-notransport2`, `-novconsole`, `-novpk`, `-novr`, `-novsync`, `-nowatchdog`, `-nv`, `-oldtexturestreaming`, `-onethreadpool`, `-panoramajoy`, `-particle_perf`, `-pass_vk_processkey`, `-perfectworld`, `-phased_window_create`, `-playtest`, `-preloadtextures`, `-pressdemo`, `-processheap`, `-profilemapload`, `-profilemapload_noquit`, `-profiletraces`, `-projection_enabled`, `-psrs`, `-publiccontent`, `-pv8execspace`, `-pv8oldspace`, `-pv8poolthreads`, `-pv8semispace`, `-quitonservershutdown`, `-r_max_device_threads`, `-rendersystem_thread_mode`, `-rendersystemdll`, `-reservewarnmb`, `-reset_keybindings`, `-resource_exit_after_time`, `-resource_system_verbose`, `-resourceleaks`, `-retail`, `-rndebug`, `-samplers_file`, `-save`, `-scene_system_partitions`, `-sdl_displayindex`, `-sequences_file`, `-servertime`, `-set_locale_disable`, `-sgpu`, `-shaderdebugging`, `-shaders`, `-shaderstats`, `-show_none`, `-show_used_combos`, `-showasserts`, `-skipcustomnavmeshgeneration`, `-slowmsgreceipt`, `-snapshots`, `-specialautographreward`, `-spewserializers`, `-spherecastunittest`, `-sse2`, `-sse3`, `-sse4`, `-start_resource_profiling`, `-steam`, `-steamconsole`, `-steamos`, `-stereo`, `-subprocess`, `-team`, `-testmode`, `-testpanloadout`, `-ti_onstage`, `-toggle`, `-toolsonly`, `-toolsvr`, `-touch`, `-tvmasteronly`, `-unbufferedio`, `-unittest`, `-use_panel_id_in_rt_name`, `-use_riftconfig`, `-use_tier2_bundle`, `-use_tier3_bundle`, `-use_viveconfig`, `-useappid`, `-usebroadcastcameraman`, `-uselocalweb`, `-usercon`, `-validate`, `-vconmaxlisten`, `-vguiconsole`, `-vktrace`, `-vr`, `-vrdebug`, `-vrdemo`, `-vrdemobutton`, `-vscriptdebug`, `-vsync`, `-vulkan_alloc_callbacks`, `-vulkan_cmd_buffer_pool_size`, `-vulkan_depth_texture_as_r32f`, `-vulkan_descriptor_sets_per_pool`, `-vulkan_disable_device_coherent_allocations`, `-vulkan_disable_khr_descriptor_update_template`, `-vulkan_disable_nv_dedicated_allocation`, `-vulkan_disable_occlusion_queries`, `-vulkan_disable_pipeline_cache`, `-vulkan_disable_pool_textures`, `-vulkan_dump_shaders`, `-vulkan_enable_nvx_trim_command_pool`, `-vulkan_enable_validation`, `-vulkan_force_sm30`, `-vulkan_minimal_validation`, `-vulkan_no_image_transitions`, `-vulkan_nv_disable_kepler_workaround`, `-vulkan_use_dynamic_buffer_offsets`, `-vulkan_use_glsl`, `-vulkan_use_pcgl_vcs`, `-vulkanrenderthreadstack`, `-warmtime`, `-wv`

Sources: [Valve Developer Community](https://developer.valvesoftware.com/wiki/Command_line_options),
[build-2439 tracking snapshot](https://github.com/SteamTracking/GameTracking-Dota2/tree/b0c2741e6f27ec8dbf7c64b5dd16b09b744e8b43).

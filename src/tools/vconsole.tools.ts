import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getVConsole, defaultVconPort, matchesLog, closeVConsoles } from "../dota/vconsole.js";
import { requireDotaPaths, discoverDotaInstallations, registerDotaInstallation, findDotaInstallation, resolveDotaPaths, invalidateDotaPaths } from "../dota/paths.js";
import { registeredInstallationPaths } from "../dota/installation-registry.js";
import { buildLaunchArgs } from "../dota/launch.js";
import { spawnDetached } from "../dota/process.js";
import { launchVConsoleApp, vconsoleDeviceName, VCONSOLE_SETTINGS_KEY } from "../dota/vconsole-app.js";
import { findDotaProcess, findDotaProcessForInstallation } from "../dota/target.js";
import { pathExists } from "../util/fsx.js";
import { guard, json } from "../util/result.js";

const port = z.number().int().min(1).max(65535).optional();
const filter = {
  limit: z.number().int().min(0).max(4000).optional(),
  channel: z.number().int().min(0).max(0xffffffff).optional(),
  pattern: z.string().max(256).optional().describe("Case-insensitive literal substring."),
  after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().describe("Only events newer than this eventId."),
};

export function registerVConsoleTools(server: McpServer) {
  server.registerTool("dota_register_installation", {
    description: "Register an installation root or dota2.exe path for future MCP sessions. Detects the build number from steam.inf, returns an installationId, and leaves the active selection unchanged.",
    inputSchema: { path: z.string().min(1).describe("Installation root containing game/bin/win64/dota2.exe, or that executable's path.") },
  }, guard(async ({ path }) => json({ installation: await registerDotaInstallation(path) })));

  server.registerTool("dota_installations", {
    description: "List registered and discovered Dota installations with build numbers and stable installation IDs. Reports the selected installation and activeVersion. Registered paths are retained even when temporarily unavailable.",
    inputSchema: {},
  }, guard(async () => {
    let selectionError: string | null = null;
    const selected = await resolveDotaPaths(true).catch((error: unknown) => {
      selectionError = error instanceof Error ? error.message : String(error);
      return undefined;
    });
    const installations = await discoverDotaInstallations();
    return json({
      registrations: (await registeredInstallationPaths()).map((entry) => ({
        ...entry, available: installations.some((installation) => installation.installationId === entry.installationId),
      })),
      installations, selected: selected ?? null,
      activeVersion: selected?.version ?? null, selectionError,
    });
  }));

  server.registerTool("dota_select_installation", {
    description: "Select activeVersion by detected build number, or installationId when multiple paths share a build. Use activeVersion:auto to resume detection. Selection and the VConsole port apply to this MCP session; automatic API references follow the selected build.",
    inputSchema: {
      activeVersion: z.string().regex(/^(auto|[1-9]\d*)$/).optional().describe("Detected build number, for example 2439, or auto."),
      installationId: z.string().regex(/^dota-[a-f0-9]{20}$/).optional(),
      version: z.enum(["auto", "2017", "current"]).optional().describe("Optional compatibility family selector."),
      path: z.string().min(1).optional().describe("Explicit installation root or dota2.exe path for this session."),
      vconPort: port, pid: z.number().int().positive().optional(),
    },
  }, guard(async ({ activeVersion, installationId, version, path, vconPort, pid }) => {
    if ([activeVersion, installationId, path, version].filter((value) => value !== undefined).length > 1) {
      throw new Error("Choose one of activeVersion, installationId, path or version.");
    }
    const requested = activeVersion ?? version ?? "auto";
    const selected = await findDotaInstallation({ path, installationId, version: requested }, vconPort);
    if (pid !== undefined) {
      if (!selected) throw new Error("No installation found for the requested PID.");
      await findDotaProcessForInstallation(selected.dota2Exe, vconPort ?? defaultVconPort(), pid);
    }
    closeVConsoles();
    delete process.env.DOTA2_EXE;
    delete process.env.DOTA2_PATH;
    delete process.env.DOTA2_PID;
    process.env.DOTA2_VERSION = requested;
    if (selected && (path || installationId || requested !== "auto")) process.env.DOTA2_PATH = selected.root;
    if (vconPort !== undefined) process.env.DOTA2_VCONPORT = String(vconPort);
    if (pid !== undefined) process.env.DOTA2_PID = String(pid);
    invalidateDotaPaths();
    return json({ selected: selected ?? null, activeVersion: selected?.version ?? null, vconPort: defaultVconPort(), pid: pid ?? null });
  }));

  server.registerTool("vconsole_status", {
    title: "VConsole health and protocol",
    description: "Report verified connection health, observed D2/D3/D4 wire version, bounded log buffer, queue, counters and last error. Optionally perform a harmless marker round trip.",
    inputSchema: { vconPort: port, connect: z.boolean().optional(), timeoutMs: z.number().int().min(100).max(30000).optional() },
  }, guard(async ({ vconPort, connect, timeoutMs }) => {
    const client = getVConsole(vconPort);
    if (connect) {
      try { await client.connect(timeoutMs ?? 5000); } catch { /* Return the diagnostic status too. */ }
    }
    return json(client.status());
  }));

  server.registerTool("vconsole_reconnect", {
    description: "Disconnect and reconnect the VConsole socket. Does not restart Dota. Can keep reconnecting automatically while Dota restarts.",
    inputSchema: { vconPort: port, automatic: z.boolean().default(true), timeoutMs: z.number().int().min(100).max(30000).default(5000) },
  }, guard(async ({ vconPort, automatic, timeoutMs }) => {
    const client = getVConsole(vconPort);
    client.disconnect();
    if (automatic) client.startReconnecting();
    await client.connect(timeoutMs);
    return json(client.status());
  }));

  server.registerTool("vconsole_disconnect", {
    description: "Close the VConsole socket and stop automatic retries. Leaves Dota and VConsole2 running.",
    inputSchema: { vconPort: port },
  }, guard(async ({ vconPort }) => { const client = getVConsole(vconPort); client.disconnect(); return json(client.status()); }));

  server.registerTool("vconsole_audit", {
    description: "Read local command audit metadata, outcomes and hashes. Command arguments and console output are not persisted. LAN requests have a separate principal-aware audit endpoint.",
    inputSchema: { vconPort: port, limit: z.number().int().min(1).max(2000).default(200) },
  }, guard(async ({ vconPort, limit }) => json({ events: getVConsole(vconPort).audit.recent(limit) })));

  server.registerTool("vconsole_logs", {
    description: "Read bounded console events with channel, literal pattern and event cursor filters. Filter before applying the line limit. No game connection is started.",
    inputSchema: { vconPort: port, ...filter },
  }, guard(async ({ vconPort, ...query }) => {
    const client = getVConsole(vconPort);
    return json({ lines: client.logs(query), status: client.status() });
  }));

  server.registerTool("vconsole_tail", {
    description: "Wait for new matching console events, then return a batch and cursor. Use after from the previous call to follow the stream over stdio.",
    inputSchema: { vconPort: port, ...filter, timeoutMs: z.number().int().min(1).max(30000).default(5000) },
  }, guard(async ({ vconPort, timeoutMs, ...query }) => {
    const client = getVConsole(vconPort);
    await client.connect();
    const after = query.after ?? client.status().lastEventId;
    const next = { ...query, after };
    if (!client.logs(next).length) await client.waitForLine((line) => matchesLog(line, next), timeoutMs, true);
    const lines = client.logs(next);
    return json({ lines, lastEventId: lines.at(-1)?.eventId ?? after, firstAvailableEventId: client.status().firstEventId });
  }));

  server.registerTool("dota_launch", {
    description: "Launch the selected Dota installation in tools mode, optionally with an addon. Map defaults to dota so the 2017 command loop initializes; pass an empty map to open only the tools hub. Uses offline/insecure mode for 2017. dryRun previews the command.",
    inputSchema: { addon: z.string().regex(/^[\w-]+$/).optional(), map: z.string().regex(/^[\w/-]*$/).default("dota"), vconPort: port, dryRun: z.boolean().default(false) },
  }, guard(async ({ addon, map, vconPort, dryRun }) => {
    const dota = await requireDotaPaths(vconPort);
    const args = buildLaunchArgs({ addon, map, vconPort: vconPort ?? defaultVconPort(), legacy: dota.versionFamily === "2017", dev: true });
    return json(dryRun ? { executable: dota.dota2Exe, args, dryRun } : await spawnDetached(dota.dota2Exe, args, dota.binWin64));
  }));

  server.registerTool("vconsole_launch", {
    description: "Launch the selected VConsole2 and select a saved loopback device for its VConsole port, preserving other devices. Close existing VConsole2 windows first. Dota 2017 serves one VConsole connection: disconnect MCP/other clients first. configureDevice:false keeps saved GUI settings. Optional pid verifies the selected game; it is not a VConsole2 CLI flag. dryRun previews the settings change.",
    inputSchema: {
      pid: z.number().int().positive().optional(), vconPort: port,
      configureDevice: z.boolean().default(true), dryRun: z.boolean().default(false),
    },
  }, guard(async ({ pid, vconPort, configureDevice, dryRun }) => {
    const selectedPort = vconPort ?? defaultVconPort();
    const dota = await requireDotaPaths(selectedPort);
    if (!(await pathExists(dota.vconsoleExe))) throw new Error("vconsole2.exe is missing from the selected installation.");
    const args = ["-retail"];
    const settings = configureDevice ? { device: vconsoleDeviceName(selectedPort), registryKey: VCONSOLE_SETTINGS_KEY } : null;
    if (dryRun) return json({ executable: dota.vconsoleExe, args, settings, exclusiveEndpoint: dota.versionFamily === "2017", dryRun });
    if (pid !== undefined && (await findDotaProcess(selectedPort))?.pid !== pid) {
      throw new Error("The requested PID does not match the selected Dota installation and VConsole endpoint.");
    }
    return json(await launchVConsoleApp(dota.vconsoleExe, dota.binWin64, selectedPort, configureDevice, dota.versionFamily === "2017"));
  }));

  server.registerResource("vconsole-status", "dota://vconsole/status", {
    mimeType: "application/json", description: "VConsole protocol, health and metrics for the configured endpoint.",
  }, async (uri) => ({ contents: [{ uri: uri.href, text: JSON.stringify(getVConsole().status()) }] }));
}

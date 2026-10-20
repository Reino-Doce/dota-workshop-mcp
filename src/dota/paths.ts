// Locate the Dota 2 + Workshop Tools install and derive the paths the MCP needs.
//
// Explicit paths win; otherwise prefer the selected running endpoint, then the
// current build from Steam libraries. Build identity comes from steam.inf.
// The result is validated by checking that game/bin/win64/dota2.exe exists.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname, resolve, basename } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { pathExists } from "../util/fsx.js";
import { installationId, registeredInstallationPaths, saveRegisteredInstallation } from "./installation-registry.js";

const execFileAsync = promisify(execFile);

export interface DotaPaths {
  installationId: string;
  version: string | null;
  root: string;
  binWin64: string;
  dota2Exe: string;
  resourceCompilerExe: string;
  vconsoleExe: string;
  gameDotaAddons: string;
  contentDotaAddons: string;
  /** The folder containing gameinfo.gi (game/dota) — the correct -game target for resourcecompiler. */
  dotaGameDir: string;
  gameInfo: string;
  dmxconvertExe: string;
  pak01DirVpk: string;
  workshopContentDir: string; // steamapps/workshop/content/570 (subscribed custom games)
  screenshotsDir: string;
  source: string; // how the root was found
  build?: Record<string, string>;
  versionFamily?: "2017" | "current" | "unknown";
}

const DEFAULT_PATH = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta";

function derive(root: string, source: string): DotaPaths {
  const binWin64 = join(root, "game", "bin", "win64");
  return {
    installationId: installationId(root),
    version: null,
    root,
    binWin64,
    dota2Exe: join(binWin64, "dota2.exe"),
    resourceCompilerExe: join(binWin64, "resourcecompiler.exe"),
    vconsoleExe: join(binWin64, "vconsole2.exe"),
    gameDotaAddons: join(root, "game", "dota_addons"),
    contentDotaAddons: join(root, "content", "dota_addons"),
    dotaGameDir: join(root, "game", "dota"),
    gameInfo: join(root, "game", "dota", "gameinfo.gi"),
    dmxconvertExe: join(binWin64, "dmxconvert.exe"),
    pak01DirVpk: join(root, "game", "dota", "pak01_dir.vpk"),
    workshopContentDir: join(root, "..", "..", "workshop", "content", "570"),
    screenshotsDir: join(root, "game", "dota", "screenshots"),
    source,
  };
}

export async function inspectDotaInstallation(root: string, source = "explicit path"): Promise<DotaPaths | undefined> {
  const normalized = basename(root).toLowerCase() === "dota2.exe" ? resolve(dirname(root), "../../..") : resolve(root);
  if (!(await pathExists(join(normalized, "game", "bin", "win64", "dota2.exe")))) return undefined;
  const paths = derive(await realpath(normalized), source);
  try {
    const info = await readFile(join(paths.dotaGameDir, "steam.inf"), "utf8");
    paths.build = Object.fromEntries(info.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }));
  } catch { /* Some installations do not ship steam.inf. */ }
  const year = Number(paths.build?.VersionDate?.match(/\b(20\d{2})\b/)?.[1]);
  paths.version = /^[1-9]\d*$/.test(paths.build?.ClientVersion ?? "") ? paths.build!.ClientVersion : null;
  paths.versionFamily = paths.version === "2439" || year === 2017 ? "2017" : year >= 2020 ? "current" : "unknown";
  return paths;
}

/** Register a validated installation without changing the active selection. */
export async function registerDotaInstallation(path: string): Promise<DotaPaths> {
  const installation = await inspectDotaInstallation(path, "registered path");
  if (!installation) throw new Error("No dota2.exe in the requested installation.");
  if (!installation.version) throw new Error("The installation must provide a numeric ClientVersion in game/dota/steam.inf.");
  await saveRegisteredInstallation(installation.root);
  invalidateDotaPaths();
  return installation;
}

async function runningDotaEndpoint(port = Number(process.env.DOTA2_VCONPORT ?? 29000)): Promise<{ executable?: string; port: number }> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid DOTA2_VCONPORT.");
  if (process.platform !== "win32") return { port };
  try {
    const script = `$owner = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($owner) { (Get-Process -Id $owner -ErrorAction SilentlyContinue).Path }`;
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeout: 10000, windowsHide: true });
    const executable = stdout.trim();
    return { port, ...(basename(executable).toLowerCase() === "dota2.exe" ? { executable } : {}) };
  } catch { return { port }; }
}

/** Discover coexisting installs; never infer a build solely from its folder name. */
export async function discoverDotaInstallations(port?: number): Promise<DotaPaths[]> {
  const candidates = new Map<string, string>();
  const add = (root: string | undefined, source: string) => { if (root && !candidates.has(root)) candidates.set(root, source); };
  add(process.env.DOTA2_EXE ?? process.env.DOTA2_PATH, "configured path");
  const running = await runningDotaEndpoint(port);
  add(running.executable, `running VConsole endpoint :${running.port}`);
  for (const entry of await registeredInstallationPaths()) add(entry.root, "registered path");
  const steam = await findSteamRoot();
  const libraries = new Set<string>(steam ? [steam] : []);
  if (steam) {
    try {
      const vdf = await readFile(join(steam, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const match of vdf.matchAll(/"path"\s*"([^"]+)"/g)) libraries.add(match[1].replace(/\\\\/g, "\\"));
    } catch { /* Default library still works. */ }
  }
  for (const library of libraries) {
    let name = "dota 2 beta";
    try {
      const manifest = await readFile(join(library, "steamapps", "appmanifest_570.acf"), "utf8");
      const installed = manifest.match(/"installdir"\s*"([^"]+)"/)?.[1];
      if (installed && !/[\\/:]/.test(installed) && installed !== "." && installed !== "..") name = installed;
    } catch { /* The standard Steam folder remains a fallback. */ }
    add(join(library, "steamapps", "common", name), "Steam library");
  }
  add(DEFAULT_PATH, "default path");
  const installations: DotaPaths[] = [];
  for (const [root, source] of candidates) {
    const paths = await inspectDotaInstallation(root, source);
    if (paths && !installations.some((p) => p.installationId === paths.installationId)) installations.push(paths);
  }
  return installations;
}

async function regQuery(key: string, value: string): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const { stdout } = await execFileAsync("reg", ["query", key, "/v", value], { timeout: 2000, windowsHide: true });
    // Output: "    SteamPath    REG_SZ    c:/program files (x86)/steam"
    const line = stdout.split(/\r?\n/).find((l) => l.includes(value));
    if (!line) return undefined;
    const m = line.match(/REG_\w+\s+(.+)$/);
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

async function findSteamRoot(): Promise<string | undefined> {
  const candidates = [
    await regQuery("HKCU\\Software\\Valve\\Steam", "SteamPath"),
    await regQuery("HKLM\\SOFTWARE\\Wow6432Node\\Valve\\Steam", "InstallPath"),
    await regQuery("HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"),
  ];
  for (const c of candidates) {
    if (c) {
      const normalized = c.replace(/\//g, "\\");
      if (await pathExists(normalized)) return normalized;
    }
  }
  return undefined;
}

let cached: DotaPaths | undefined;
let cachedConfig: string | undefined;
let cachedAt = 0;

export function invalidateDotaPaths(): void {
  cached = undefined;
  cachedConfig = undefined;
  cachedAt = 0;
}

export interface InstallationSelection {
  path?: string;
  installationId?: string;
  version?: string;
}

/** Resolve a selection before the caller changes session state or closes connections. */
export async function findDotaInstallation(selection: InstallationSelection, port?: number): Promise<DotaPaths | undefined> {
  if (selection.path !== undefined) {
    const explicit = await inspectDotaInstallation(selection.path);
    if (!explicit) throw new Error("No dota2.exe in the requested installation. Refusing to fall back to another installation.");
    return explicit;
  }
  const version = selection.version ?? "auto";
  if (!["auto", "2017", "current"].includes(version) && !/^[1-9]\d*$/.test(version)) {
    throw new Error("DOTA2_VERSION must be auto, a build number, 2017 or current.");
  }
  const installations = await discoverDotaInstallations(port);
  if (!selection.installationId && version === "auto") {
    return installations.find((p) => p.source.startsWith("running VConsole")) ??
      installations.find((p) => p.versionFamily === "current") ?? installations[0];
  }
  const matches = installations.filter((p) => selection.installationId
    ? p.installationId === selection.installationId
    : p.version === version || p.versionFamily === version);
  if (matches.length > 1) throw new Error(`Multiple installations match ${version}. Select an installationId from dota_installations.`);
  if (!matches.length) throw new Error(`No installation found for ${selection.installationId ?? version}. Register its path with dota_register_installation.`);
  return matches[0];
}

/** Resolve the Dota install. Returns undefined if no valid install is found. */
export async function resolveDotaPaths(force = false, port?: number): Promise<DotaPaths | undefined> {
  const config = JSON.stringify([process.env.DOTA2_PATH, process.env.DOTA2_EXE, process.env.DOTA2_VERSION, process.env.DOTA2_INSTALLATIONS_DIR, port ?? process.env.DOTA2_VCONPORT]);
  if (cached && !force && cachedConfig === config && Date.now() - cachedAt < 5000) return cached;
  const remember = (result: DotaPaths | undefined) => {
    cached = result;
    cachedConfig = config;
    cachedAt = Date.now();
    return result;
  };

  const envRoot = process.env.DOTA2_EXE ?? process.env.DOTA2_PATH;
  if (envRoot !== undefined) {
    const explicit = await inspectDotaInstallation(envRoot, process.env.DOTA2_EXE ? "DOTA2_EXE env" : "DOTA2_PATH env");
    if (!explicit) throw new Error("The configured Dota installation does not contain game/bin/win64/dota2.exe. Refusing to fall back to another installation.");
    return remember(explicit);
  }
  return remember(await findDotaInstallation({ version: process.env.DOTA2_VERSION }, port));
}

/** Like resolveDotaPaths but throws a helpful error when not found. */
export async function requireDotaPaths(port?: number): Promise<DotaPaths> {
  const p = await resolveDotaPaths(false, port);
  if (!p) {
    throw new Error(
      "Could not locate the Dota 2 install. Register a path with dota_register_installation, or set DOTA2_PATH to your " +
        'installation root (the one containing game\\bin\\win64\\dota2.exe), or set DOTA2_EXE.',
    );
  }
  return p;
}

export async function hasWorkshopTools(p: DotaPaths): Promise<boolean> {
  // The tools DLC ships resourcecompiler.exe + the sdktools manifest.
  return (await pathExists(p.resourceCompilerExe)) && (await pathExists(join(p.binWin64, "..", "sdkenginetools.txt")));
}

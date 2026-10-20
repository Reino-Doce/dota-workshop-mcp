import { requireDotaPaths } from "./paths.js";
import { run } from "./process.js";
import { defaultVconPort } from "./vconsole.js";

export interface DotaProcess { pid: number; path: string; }

export function selectDotaProcess(processes: DotaProcess[], executable: string, listenerPid?: number, configuredPid?: number): DotaProcess | undefined {
  const normalize = (value: string) => value.replace(/\//g, "\\").toLowerCase();
  const matches = processes.filter((p) => normalize(p.path) === normalize(executable));
  if (configuredPid !== undefined) {
    const target = matches.find((p) => p.pid === configuredPid);
    if (!target) throw new Error("DOTA2_PID does not belong to the selected installation.");
    if (listenerPid && listenerPid !== configuredPid) throw new Error("DOTA2_PID and the configured VConsole port select different processes.");
    return target;
  }
  if (listenerPid) {
    const target = matches.find((p) => p.pid === listenerPid);
    if (!target) throw new Error("The VConsole port belongs to another installation or process.");
    return target;
  }
  if (matches.length > 1) throw new Error("Multiple matching Dota processes. Set DOTA2_PID or select their VConsole port.");
  return matches[0];
}

/** Resolve by executable AND endpoint, never by the first dota2.exe process. */
export async function findDotaProcess(port = defaultVconPort()): Promise<DotaProcess | undefined> {
  if (process.platform !== "win32") throw new Error("Dota process control requires Windows.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid VConsole port.");
  const dota = await requireDotaPaths(port);
  const configured = process.env.DOTA2_PID === undefined ? undefined : Number(process.env.DOTA2_PID);
  if (configured !== undefined && (!Number.isSafeInteger(configured) || configured <= 0)) throw new Error("Invalid DOTA2_PID.");
  const script = `
$ErrorActionPreference = 'Stop'
$items = @(Get-Process -Name dota2 -ErrorAction SilentlyContinue | ForEach-Object { @{ pid = $_.Id; path = $_.Path } })
$owner = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
@{ processes = $items; listenerPid = $owner } | ConvertTo-Json -Compress -Depth 3
`;
  const result = await run("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeoutMs: 15000 });
  if (result.code !== 0) throw new Error("Could not inspect Dota processes.");
  const data = JSON.parse(result.stdout.trim()) as { processes: DotaProcess[]; listenerPid?: number };
  return selectDotaProcess(data.processes.filter((p) => typeof p.path === "string"), dota.dota2Exe, data.listenerPid, configured);
}

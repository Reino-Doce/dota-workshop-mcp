import { run } from "./process.js";

export const VCONSOLE_SETTINGS_KEY = "HKCU:\\Software\\Valve\\VConsole2 SDK";

export function vconsoleDeviceName(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid VConsole port.");
  return `127.0.0.1:${port}`;
}

export function buildVConsoleLaunchScript(executable: string, cwd: string, port: number, configureDevice: boolean, exclusiveEndpoint = false): string {
  const device = vconsoleDeviceName(port);
  const input = Buffer.from(JSON.stringify({ executable, cwd, configureDevice, exclusiveEndpoint }), "utf8").toString("base64");
  return `
$ErrorActionPreference = 'Stop'
$launchInput = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${input}')) | ConvertFrom-Json
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$launchMutex = [Threading.Mutex]::new($false, ('Global\\DotaWorkshopMcp.VConsole2.' + $userSid))
$lockTaken = $false
try {
try { $lockTaken = $launchMutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $lockTaken = $true }
if (!$lockTaken) { throw 'Another VConsole2 launch is in progress. Retry after it completes.' }
$settingsResult = $null
if ($launchInput.exclusiveEndpoint) {
  $connections = @(Get-NetTCPConnection -RemotePort ${port} -State Established -ErrorAction SilentlyContinue |
    Where-Object { $_.RemoteAddress -in @('127.0.0.1', '::1') })
  if ($connections.Count -gt 0) {
    throw 'Dota 2017 serves one VConsole connection at a time. Use vconsole_disconnect or stop the other gateway/client before opening VConsole2.'
  }
}
if ($launchInput.configureDevice) {
if (@(Get-Process -Name vconsole2 -ErrorAction SilentlyContinue).Count -gt 0) {
  throw 'Close existing VConsole2 windows before selecting a saved device, or use configureDevice:false to keep their current settings.'
}
$settingsPath = '${VCONSOLE_SETTINGS_KEY}'
$devicesPath = Join-Path $settingsPath 'Devices'
$size = 0
if (Test-Path -LiteralPath $devicesPath) {
  $size = [int](Get-Item -LiteralPath $devicesPath).GetValue('size', 0)
}
if ($size -lt 0 -or $size -gt 256) { throw 'Unexpected VConsole2 device count. Settings were not changed.' }
$deviceIndex = 0
for ($index = 1; $index -le $size; $index++) {
  $entryPath = Join-Path $devicesPath ([string]$index)
  if (!(Test-Path -LiteralPath $entryPath)) { continue }
  $entry = Get-Item -LiteralPath $entryPath
  if ($entry.GetValue('deviceName', '') -eq '${device}') {
    if ([int]$entry.GetValue('deviceType', -1) -ne 0) { throw 'Saved device has an unexpected type. Settings were not changed.' }
    $deviceIndex = $index
    break
  }
}
$created = $deviceIndex -eq 0
if ($created) {
  if ($size -ge 256) { throw 'VConsole2 device limit reached. Select an existing device or remove an unused device in the GUI.' }
  $deviceIndex = $size + 1
  $entryPath = Join-Path $devicesPath ([string]$deviceIndex)
  if (Test-Path -LiteralPath $entryPath) { throw 'Unindexed VConsole2 device found. Settings were not changed.' }
  New-Item -Path $entryPath -Force | Out-Null
  New-ItemProperty -LiteralPath $entryPath -Name 'deviceName' -Value '${device}' -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $entryPath -Name 'deviceType' -Value 0 -PropertyType DWord -Force | Out-Null
} else { $entryPath = Join-Path $devicesPath ([string]$deviceIndex) }
New-ItemProperty -LiteralPath $entryPath -Name 'connectAtStartup' -Value 'true' -PropertyType String -Force | Out-Null
if ($created) {
  New-ItemProperty -LiteralPath $devicesPath -Name 'size' -Value $deviceIndex -PropertyType DWord -Force | Out-Null
}
New-ItemProperty -LiteralPath $settingsPath -Name 'activeDevice' -Value '${device}' -PropertyType String -Force | Out-Null
$settingsResult = @{ device = '${device}'; created = $created }
}
$guiProcess = Start-Process -FilePath $launchInput.executable -ArgumentList '-retail' -WorkingDirectory $launchInput.cwd -PassThru
@{ pid = $guiProcess.Id; settings = $settingsResult } | ConvertTo-Json -Compress -Depth 3
} finally {
  if ($lockTaken) { $launchMutex.ReleaseMutex() }
  $launchMutex.Dispose()
}
`;
}

/** Both tested builds use QSettings, not -pid. A per-user named mutex covers
 * connection checks, settings AND process creation across MCP processes. */
export async function launchVConsoleApp(executable: string, cwd: string, port: number, configureDevice: boolean, exclusiveEndpoint = false): Promise<{
  command: string; pid: number; settings: { device: string; created: boolean } | null;
}> {
  if (process.platform !== "win32") throw new Error("VConsole2 application launch requires Windows.");
  const script = buildVConsoleLaunchScript(executable, cwd, port, configureDevice, exclusiveEndpoint);
  const result = await run("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeoutMs: 25000 });
  if (result.code !== 0) throw new Error(`Could not launch VConsole2: ${result.stderr.trim() || "launch command failed"}`);
  return { ...JSON.parse(result.stdout.trim()), command: `"${executable}" -retail` };
}

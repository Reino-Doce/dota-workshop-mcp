import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVConsoleLaunchScript } from "../src/dota/vconsole-app.js";
import { run } from "../src/dota/process.js";

test("exclusive endpoint checks precede launch even without device configuration", { skip: process.platform !== "win32" }, async () => {
  for (const configureDevice of [false, true]) {
    const script = `
function Get-NetTCPConnection {
  param($RemotePort, $State, $ErrorAction)
  if ($RemotePort -ne 29017) { throw 'wrong endpoint' }
  [pscustomobject]@{ RemoteAddress = '127.0.0.1' }
}
function Get-Process { throw 'settings were inspected before rejecting the connection' }
function New-Item { throw 'settings were modified' }
function New-ItemProperty { throw 'settings were modified' }
function Start-Process { throw 'application was launched' }
try {
${buildVConsoleLaunchScript("unused.exe", ".", 29017, configureDevice, true)}
throw 'busy endpoint was accepted'
} catch {
  if ($_.Exception.Message -notlike '*one VConsole connection at a time*') { throw }
  Write-Output 'blocked-before-launch'
}
`;
    const result = await run("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), "blocked-before-launch");
  }
});

test("settings-free launch succeeds when the exclusive endpoint is available", { skip: process.platform !== "win32" }, async () => {
  const script = `
function Get-NetTCPConnection { }
function New-Item { throw 'settings were modified' }
function New-ItemProperty { throw 'settings were modified' }
function Start-Process { [pscustomobject]@{ Id = 123 } }
${buildVConsoleLaunchScript("unused.exe", ".", 29017, false, true)}
`;
  const result = await run("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { pid: 123, settings: null });
});

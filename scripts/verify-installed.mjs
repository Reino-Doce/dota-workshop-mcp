#!/usr/bin/env node
// Opt-in live verification. Only diagnostics, reference reads and launch previews.
// Never starts/stops games or changes an addon. The game must already have a map.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [family, portText] = process.argv.slice(2);
const port = Number(portText);
if (!["2017", "current"].includes(family) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Usage: node scripts/verify-installed.mjs 2017|current <vconsole-port>");
}
const env = { ...process.env, DOTA2_VERSION: "auto", DOTA2_API_VERSION: "auto", DOTA2_VCON_PROTOCOL: "auto", DOTA2_VCONPORT: String(port) };
delete env.DOTA2_PATH; delete env.DOTA2_EXE; delete env.DOTA2_PID;
const client = new Client({ name: "installed-verification", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath, args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))], env,
});
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name}: ${(result.content ?? []).map((c) => c.text ?? "").join("\n")}`);
  return result;
};
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  for (const name of ["dota_installations", "dota_select_installation", "vconsole_status", "vconsole_audit", "dota_send_console_command", "lua_api_get", "panorama_api_get"]) {
    assert.ok(tools.some((tool) => tool.name === name), `Missing ${name}`);
  }
  const installs = (await call("dota_installations")).structuredContent;
  assert.equal(installs.selected.versionFamily, family);
  const status = (await call("vconsole_status", { connect: true, timeoutMs: 15000 })).structuredContent;
  assert.equal(status.connected, true, JSON.stringify(status.lastError));
  assert.equal(status.wireVersion, family === "2017" ? "0x00d30000" : "0x00d40000");
  const result = (await call("dota_send_console_command", { command: "status", waitMs: 5000 })).structuredContent;
  assert.ok(result.output.length > 0, "status produced no console output");
  const lua = (await call("lua_api_get", { name: "CreateUnitByName" })).structuredContent;
  assert.equal(lua.metadata.version, family);
  const panorama = (await call("panorama_api_get", { name: "Panel" })).structuredContent;
  assert.equal(panorama.metadata.version, family);
  const launch = (await call("dota_launch", { dryRun: true, map: "dota" })).structuredContent;
  assert.ok(launch.args.includes("+map"));
  const gui = (await call("vconsole_launch", { dryRun: true })).structuredContent;
  assert.ok(gui.executable.toLowerCase().endsWith("vconsole2.exe"));
  assert.equal(gui.settings.device, `127.0.0.1:${port}`);
  assert.deepEqual(gui.args, ["-retail"]);
  const archive = (await call("vpk_find", { query: ".txt", limit: 1 })).structuredContent;
  assert.ok(archive.count > 0);
  await call("vpk_read", { path: archive.files[0], maxChars: 1000 });
  const heroes = (await call("vpk_read", { path: "scripts/npc/npc_heroes.txt", maxChars: 1000 })).structuredContent;
  const hero = (await call("base_kv_entry", { kind: "heroes", key: "npc_dota_hero_axe" })).structuredContent;
  assert.ok(hero.found || hero.bases.length > 0);
  const window = (await call("dota_window", { action: "info" })).structuredContent;
  assert.ok(window.pid > 0);
  const diagnosis = (await call("dota_diagnose")).structuredContent;
  assert.deepEqual(diagnosis.processes.map((process) => process.pid), [window.pid]);
  console.log(JSON.stringify({
    family, build: installs.selected.build.ClientVersion, protocol: status.wireVersion,
    tools: tools.length, channels: status.channels.length, statusLines: result.output.length,
    api: lua.metadata.version, archive: "readable", heroSource: heroes.source, windowPid: window.pid, launchPreviews: "passed",
  }, null, 2));
} finally { await client.close(); }

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registeredInstallationPaths } from "../src/dota/installation-registry.js";
import { registerDotaInstallation, inspectDotaInstallation, resolveDotaPaths, invalidateDotaPaths } from "../src/dota/paths.js";
import { closeVConsoles, getVConsole } from "../src/dota/vconsole.js";
import { registerVConsoleTools } from "../src/tools/vconsole.tools.js";
import { registerApiTools } from "../src/tools/api.tools.js";

test("registered paths persist, detect builds, and drive MCP selection without machine-specific folders", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "dota-registry-"));
  const names = ["DOTA2_PATH", "DOTA2_EXE", "DOTA2_VERSION", "DOTA2_PID", "DOTA2_VCONPORT", "DOTA2_API_VERSION", "DOTA2_INSTALLATIONS_DIR"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.DOTA2_INSTALLATIONS_DIR = join(temporary, "registry");
  const server = new McpServer({ name: "registration-test", version: "1" });
  registerVConsoleTools(server);
  registerApiTools(server);
  const client = new Client({ name: "registration-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
    closeVConsoles();
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    invalidateDotaPaths();
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  });
  const fixture = async (name: string, build: string, date: string) => {
    const root = join(temporary, name);
    await mkdir(join(root, "game/bin/win64"), { recursive: true });
    await mkdir(join(root, "game/dota"), { recursive: true });
    await writeFile(join(root, "game/bin/win64/dota2.exe"), "");
    await writeFile(join(root, "game/dota/steam.inf"), `ClientVersion=${build}\nVersionDate=${date}\n`);
    return root;
  };
  const oldRoot = await fixture("arbitrary-a", "2439", "Oct 03 2017");
  const currentRoot = await fixture("arbitrary-b", "990001", "Oct 15 2026");
  process.env.DOTA2_PATH = currentRoot;
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.content));
    return result.structuredContent!;
  };

  const registered = await call("dota_register_installation", { path: oldRoot });
  const old = registered.installation as Awaited<ReturnType<typeof registerDotaInstallation>>;
  assert.equal(old.version, "2439");
  assert.equal((await resolveDotaPaths(true))?.root, currentRoot, "registration does not change active installation");
  const again = await registerDotaInstallation(join(oldRoot, "game/bin/win64/dota2.exe"));
  assert.equal(again.installationId, old.installationId);
  const modern = await registerDotaInstallation(currentRoot);
  assert.equal((await registeredInstallationPaths()).length, 2, "root and executable registration deduplicate");
  assert.deepEqual(JSON.parse(await readFile(join(process.env.DOTA2_INSTALLATIONS_DIR!, `${old.installationId}.json`), "utf8")), { root: old.root });

  const registryModule = new URL("../src/dota/installation-registry.ts", import.meta.url).href;
  const child = await promisify(execFile)(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e",
    `import { registeredInstallationPaths } from ${JSON.stringify(registryModule)}; console.log(JSON.stringify(await registeredInstallationPaths()));`,
  ], { env: process.env });
  assert.deepEqual(JSON.parse(child.stdout), await registeredInstallationPaths(), "a fresh process reads registrations");
  await assert.rejects(registerDotaInstallation(join(temporary, "absent")), /No dota2.exe/);
  const unidentified = await fixture("unidentified", "not-a-build", "");
  await assert.rejects(registerDotaInstallation(unidentified), /ClientVersion/);
  assert.equal((await registeredInstallationPaths()).length, 2);

  const previousClient = getVConsole(29017);
  // Discovery must use the requested endpoint even when the previous one is invalid.
  process.env.DOTA2_VCONPORT = "invalid";
  const selected = await call("dota_select_installation", { installationId: old.installationId, vconPort: 29017 });
  assert.equal(selected.activeVersion, "2439");
  assert.equal(process.env.DOTA2_VCONPORT, "29017");
  assert.notEqual(getVConsole(29017), previousClient, "switching releases old clients");
  assert.equal((await resolveDotaPaths())?.root, old.root);
  const lua = await call("lua_api_get", { name: "CreateUnitByName" });
  assert.equal((lua.metadata as { build: { ClientVersion: string } }).build.ClientVersion, "2439");
  const preview = await call("dota_launch", { dryRun: true });
  assert.equal(preview.executable, old.dota2Exe);

  const next = await call("dota_select_installation", { activeVersion: modern.version!, vconPort: 29026 });
  assert.equal(next.activeVersion, "990001");
  assert.equal((await resolveDotaPaths())?.root, modern.root);
  assert.equal(((await call("lua_api_get", { name: "CreateUnitByName" })).metadata as { version: string }).version, "current");
  assert.equal((await call("dota_installations")).activeVersion, "990001");

  const duplicateRoot = await fixture("arbitrary-c", "990001", "Oct 15 2026");
  await registerDotaInstallation(duplicateRoot);
  const currentClient = getVConsole(29026);
  for (const args of [
    { activeVersion: "990001" },
    { activeVersion: "999999999" },
    { path: join(temporary, "missing"), vconPort: 29999 },
    { activeVersion: "2439", installationId: old.installationId },
  ]) {
    const failure = await client.callTool({ name: "dota_select_installation", arguments: args });
    assert.equal(failure.isError, true);
    assert.equal((await resolveDotaPaths())?.root, modern.root);
    assert.equal(process.env.DOTA2_VCONPORT, "29026");
    assert.equal(getVConsole(29026), currentClient, "failed selection preserves connections");
  }
  await call("dota_select_installation", { installationId: modern.installationId });
  await writeFile(join(currentRoot, "game/dota/steam.inf"), "ClientVersion=990002\nVersionDate=Oct 15 2026\n");
  assert.equal((await inspectDotaInstallation(currentRoot))?.version, "990002", "build metadata is refreshed");
  assert.equal((await call("dota_installations")).activeVersion, "990002");
  await rm(join(currentRoot, "game/bin/win64/dota2.exe"));
  await assert.rejects(resolveDotaPaths(true), /Refusing to fall back/);
  const lost = await client.callTool({ name: "dota_select_installation", arguments: { installationId: modern.installationId } });
  assert.equal(lost.isError, true);
  assert.ok((await registeredInstallationPaths()).some((entry) => entry.installationId === modern.installationId));
  const unavailable = await call("dota_installations");
  assert.equal(unavailable.activeVersion, null);
  assert.match(String(unavailable.selectionError), /Refusing to fall back/);
  assert.ok((unavailable.registrations as { installationId: string; available: boolean }[])
    .some((entry) => entry.installationId === modern.installationId && !entry.available));
  const automatic = await call("dota_select_installation", { activeVersion: "auto" });
  assert.equal(process.env.DOTA2_PATH, undefined);
  assert.equal(process.env.DOTA2_VERSION, "auto");
  assert.ok(automatic.selected);
});

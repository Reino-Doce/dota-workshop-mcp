import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { prepareRuntime } from "../scripts/plugin-server.mjs";
import { forwardedEnvironment } from "../scripts/codex-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), "workshop plugin "));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("plugin manifest discovers the canonical skills and a relocatable local server", async () => {
  const manifest = await json(join(root, ".codex-plugin/plugin.json"));
  const catalog = await json(join(root, ".agents/plugins/marketplace.json"));
  assert.equal(catalog.plugins[0].name, manifest.name);
  assert.equal(catalog.plugins[0].source.path, "./");
  assert.equal(manifest.requires_local_executor, true);
  for (const path of [manifest.skills, manifest.mcpServers]) {
    assert.ok(path.startsWith("./") && !path.split("/").includes(".."));
    assert.ok(await stat(join(root, path)));
  }
  const config = (await json(join(root, manifest.mcpServers))).mcpServers["dota2-workshop"];
  assert.equal(config.command, "node");
  assert.equal(config.cwd, "./");
  assert.equal(config.args[0], "scripts/plugin-server.mjs");
  assert.ok(config.startup_timeout_sec >= 180);
  assert.deepEqual(new Set(config.env_vars), new Set(["DOTA2_ADDON_DIR", ...forwardedEnvironment]));
  assert.deepEqual(config.disabled_tools, ["image_generate"]);
  for (const name of ["dota-workshop-tools", "share-preview"]) {
    const content = await readFile(join(root, manifest.skills, name, "SKILL.md"), "utf8");
    assert.match(content, new RegExp(`\\nname: ${name}\\r?\\n`));
  }
});

test("the portable Workshop skill has no dangling local references or preverified gates", async () => {
  const skill = join(root, ".agents/skills/dota-workshop-tools");
  async function check(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) { await check(path); continue; }
      if (!item.name.endsWith(".md")) continue;
      const content = await readFile(path, "utf8");
      assert.doesNotMatch(content, /PROJECT_ROOT|_shared\/|C:\\Users\\|workshop_testbed/);
      for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^https?:|^#/.test(target)) continue;
        const resolved = resolve(dirname(path), target.split("#")[0]);
        assert.ok(!relative(skill, resolved).startsWith(".."), target);
        assert.ok(await stat(resolved), `${path}: ${target}`);
      }
    }
  }
  await check(skill);
  const session = await json(join(skill, "assets/session.template.json"));
  assert.equal(session.root, null);
  assert.equal(session.runtime_target, null);
  for (const capability of Object.values(session.runtime_capabilities)) {
    if (!Array.isArray(capability)) assert.equal(capability.status, "not_tested");
  }
  assert.ok(Object.values(session.asset_record_template.gate_status).every((value) => value === "not_tested"));
});

async function fixture(t) {
  const directory = await scratch(t);
  await mkdir(join(directory, "src"));
  for (const name of ["package.json", "package-lock.json", "tsconfig.json"]) {
    await writeFile(join(directory, name), "{}");
  }
  await writeFile(join(directory, "src/index.ts"), "// fixture");
  return directory;
}

async function fakeBuild(args, runtime) {
  if (args[0] === "ci") {
    await mkdir(join(runtime, "node_modules/@modelcontextprotocol/sdk"), { recursive: true });
    await writeFile(join(runtime, "node_modules/@modelcontextprotocol/sdk/package.json"), "{}");
  } else {
    await mkdir(join(runtime, "dist"), { recursive: true });
    await writeFile(join(runtime, "dist/index.js"), "// built");
  }
}

test("setup serializes simultaneous starts, reuses the runtime and rebuilds changed inputs", async (t) => {
  const directory = await fixture(t);
  await mkdir(join(directory, "node_modules"));
  await writeFile(join(directory, "node_modules/keep.txt"), "existing checkout");
  const calls = [];
  const run = async (args, runtime) => { calls.push(args); await fakeBuild(args, runtime); };
  const entries = await Promise.all([prepareRuntime(directory, { run }), prepareRuntime(directory, { run })]);
  assert.equal(entries[0], entries[1]);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("--ignore-scripts"));
  assert.equal(await prepareRuntime(directory, { run }), entries[0]);
  assert.equal(calls.length, 2);
  await writeFile(join(directory, "src/index.ts"), "// updated");
  assert.notEqual(await prepareRuntime(directory, { run }), entries[0]);
  assert.equal(calls.length, 4);
  assert.equal(await readFile(join(directory, "node_modules/keep.txt"), "utf8"), "existing checkout");
});

test("failed setup leaves no ready marker and a retry can finish", async (t) => {
  const directory = await fixture(t);
  await assert.rejects(prepareRuntime(directory, {
    run: async () => { throw new Error("registry unavailable"); },
  }), /registry unavailable/);
  const cache = join(directory, ".plugin-runtime");
  const items = await readdir(cache);
  assert.ok(items.every((name) => !name.endsWith(".lock")));
  await assert.rejects(stat(join(cache, items[0], "ready")), { code: "ENOENT" });
  const entry = await prepareRuntime(directory, { run: fakeBuild });
  assert.ok(await stat(entry));
});

test("simultaneous starts preserve an abandoned setup lock instead of racing to reclaim it", async (t) => {
  const directory = await fixture(t);
  await assert.rejects(prepareRuntime(directory, {
    run: async () => { throw new Error("fixture failure"); },
  }), /fixture failure/);
  const cache = join(directory, ".plugin-runtime");
  const [key] = await readdir(cache);
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore", windowsHide: true });
  await once(child, "exit");
  const lock = join(cache, `${key}.lock`);
  await writeFile(lock, String(child.pid));
  const run = async () => assert.fail("setup must not run while the interrupted lock remains");
  await Promise.all(Array.from({ length: 20 }, () =>
    assert.rejects(prepareRuntime(directory, { run, waitMs: 1000 }), /Plugin setup was interrupted/)));
  assert.equal(await readFile(lock, "utf8"), String(child.pid));
});

test("a source-only plugin installs dependencies and serves MCP from an unrelated directory", { timeout: 180_000 }, async (t) => {
  const directory = await scratch(t);
  const installed = join(directory, "installed plugin");
  await mkdir(installed);
  for (const path of ["package.json", "package-lock.json", "tsconfig.json", "src", "scripts/plugin-server.mjs",
    ".codex-plugin", ".mcp.json", ".agents/skills", ".agents/plugins"]) {
    await mkdir(dirname(join(installed, path)), { recursive: true });
    await cp(join(root, path), join(installed, path), { recursive: true, filter: (source) => !source.includes("__pycache__") });
  }
  await assert.rejects(stat(join(installed, "node_modules")), { code: "ENOENT" });
  await assert.rejects(stat(join(installed, "dist")), { code: "ENOENT" });
  const manifest = await json(join(installed, ".codex-plugin/plugin.json"));
  const config = (await json(join(installed, manifest.mcpServers))).mcpServers["dota2-workshop"];
  // Resolve the host's plugin-relative cwd, then use an absolute launcher from
  // an unrelated cwd as a stricter relocation check.
  const launcher = resolve(installed, config.cwd, config.args[0]);
  const addon = join(directory, "addon");
  await mkdir(addon);
  await writeFile(join(addon, "fixture.txt"), '"Example" { "value" "plugin" }');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith("DOTA2_")));
  const transport = new StdioClientTransport({
    command: process.execPath, args: [launcher], cwd: directory, stderr: "pipe",
    env: { ...env, DOTA2_ADDON_DIR: addon, DOTA2_INSTALLATIONS_DIR: join(directory, "installations") },
  });
  const client = new Client({ name: "plugin-test", version: "1.0.0" });
  let errors = "";
  transport.stderr?.on("data", (chunk) => { errors = (errors + chunk).slice(-12000); });
  try {
    await client.connect(transport, { timeout: 170_000 });
    const { tools } = await client.listTools();
    for (const name of ["dota_installations", "dota_select_installation", "addon_compile_content", "asset_preview",
      "panorama_api_search", "panorama_api_get"]) assert.ok(tools.some((tool) => tool.name === name), name);
    const kv = await client.callTool({ name: "kv_read", arguments: { path: "fixture.txt" } });
    assert.ok(!kv.isError, JSON.stringify(kv));
    assert.equal(kv.structuredContent.data.value, "plugin");
    const api = await client.callTool({ name: "lua_api_get", arguments: { name: "CreateUnitByName", version: "2017" } });
    assert.ok(!api.isError, JSON.stringify(api));
    assert.equal(api.structuredContent.metadata.build.ClientVersion, "2439");
    // Warm starts must need neither the registry nor another build.
    await prepareRuntime(installed, { run: async () => { throw new Error("unexpected reinstall"); } });
  } catch (error) {
    throw new Error(`${error.message}\n${errors}`, { cause: error });
  } finally {
    await client.close();
    await transport.close();
  }
});

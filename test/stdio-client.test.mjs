import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { codexConfiguration } from "../scripts/codex-config.mjs";

test("stdio client can initialize and use offline tools from an unrelated working directory", { timeout: 30000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "mcp-client-"));
  const addon = join(temporary, "addon with spaces");
  await mkdir(addon);
  await writeFile(join(addon, "package.json"), '{"name":"client_fixture"}');
  await writeFile(join(addon, "fixture.txt"), '"Example" { "value" "portable" }');
  const client = new Client({ name: "portable-client-test", version: "1.0.0" }, { capabilities: {} });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith("DOTA2_")));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    cwd: temporary,
    env: { ...env, DOTA2_ADDON_DIR: addon, DOTA2_API_VERSION: "current", DOTA2_INSTALLATIONS_DIR: join(temporary, "installations") },
    stderr: "pipe",
  });
  let stderr = "";
  try {
    await client.connect(transport);
    transport.stderr?.on("data", (data) => { stderr += data; });
    assert.equal(client.getServerVersion().name, "dota2-workshop-mcp");
    assert.match(client.getInstructions(), /playback.*vary|playback depends/i);
    const { tools } = await client.listTools();
    assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
    for (const tool of tools) assert.equal(tool.inputSchema.type, "object", tool.name);
    assert.ok(tools.some((tool) => tool.name === "dota_register_installation"));
    assert.doesNotMatch(tools.find((tool) => tool.name === "dota_record").description, /Then Read|opened with Read/);
    const result = await client.callTool({ name: "kv_read", arguments: { path: "fixture.txt" } });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(result.structuredContent.path, join(addon, "fixture.txt"));
    assert.equal(result.structuredContent.data.value, "portable");
    assert.ok(result.content.some((item) => item.type === "text"));
    const missing = await client.callTool({ name: "kv_read", arguments: { path: "missing.txt" } });
    assert.equal(missing.isError, true);
    const api = await client.callTool({ name: "lua_api_get", arguments: { name: "CreateUnitByName", version: "2017" } });
    assert.ok(!api.isError);
    assert.equal(api.structuredContent.metadata.build.ClientVersion, "2439");
    const resources = await client.listResources();
    assert.ok(resources.resources.some((item) => item.uri === "dota://guide/sharing"));
    const guide = await client.readResource({ uri: "dota://guide/sharing" });
    assert.doesNotMatch(JSON.stringify(guide), /SendUserFile|claude-remote-control|Then.*Read/);
    const prompt = await client.getPrompt({ name: "record_motion" });
    assert.ok(prompt.messages.length);
    const config = await codexConfiguration(addon, 1200);
    assert.match(config, /tool_timeout_sec = 1200/);
    assert.ok(config.includes(JSON.stringify(addon)));
    await assert.rejects(codexConfiguration(addon, 0), /positive integer/);
    await assert.rejects(codexConfiguration(join(temporary, "missing")));
  } catch (error) {
    throw new Error(`${error.message}\nServer stderr: ${stderr}`, { cause: error });
  } finally {
    await client.close();
    await transport.close();
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  }
});

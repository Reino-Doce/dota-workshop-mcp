import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadApi } from "../src/api/loader.js";
import { apiStats, getClass, getEnum, getFunction, getMethod, searchApi } from "../src/api/search.js";
import { getPanorama, getPanoramaInterface, loadPanorama, panoramaStats, searchPanorama } from "../src/api/panorama.js";
import { parseLuaHelp, mergeLuaHelp, parsePanoramaHelp } from "../src/api/engine.js";
import { resolveApiVersion, validateBuildProvenance, type ApiDatasetMetadata } from "../src/api/version.js";
import { buildApiSnapshots } from "../scripts/build-api-snapshots.mjs";
import { registerApiTools } from "../src/tools/api.tools.js";
import { registerDocsTools } from "../src/tools/docs.tools.js";

const dataset = new URL("../src/data/versions/2439/", import.meta.url);
const source = new URL("source/", dataset);

test("2017 engine data retains different enum values, symbols and server/client availability", async () => {
  const old = await loadApi("2017");
  const modern = await loadApi("current");
  assert.notStrictEqual(old, modern);
  assert.strictEqual(await loadApi("2017"), old);
  assert.strictEqual(await loadApi("current"), modern);
  assert.equal(old.metadata.build?.ClientVersion, "2439");
  assert.equal(old.metadata.provenance, "engine-help");
  assert.equal(modern.metadata.provenance, "bundled-reference");
  assert.ok(modern.metadata.limitations.some((limit) => limit.includes("did not record")));

  const oldAttributes = await getEnum("Attributes", "2017");
  const modernAttributes = await getEnum("Attributes", "current");
  assert.equal(oldAttributes?.members?.find((m) => m.name === "DOTA_ATTRIBUTE_MAX")?.value, 3);
  assert.equal(modernAttributes?.members?.find((m) => m.name === "DOTA_ATTRIBUTE_MAX")?.value, 4);
  assert.equal(oldAttributes?.members?.find((m) => m.name === "DOTA_ATTRIBUTE_ALL"), undefined);
  assert.ok(modernAttributes?.members?.find((m) => m.name === "DOTA_ATTRIBUTE_ALL"));
  assert.equal(await getFunction("GetDedicatedServerKeyV3", "2017"), undefined);
  assert.ok(await getFunction("GetDedicatedServerKeyV3", "current"));
  assert.ok((await searchApi("DOTA_ATTRIBUTE_STRENGTH", { version: "2017", kind: "enum" })).some((hit) => hit.name === "Attributes"));
  assert.ok((await searchApi("CreateUnitByName", { version: "2017", available: "server", kind: "function" })).some((hit) => hit.name === "CreateUnitByName"));
  assert.equal((await searchApi("CreateUnitByName", { version: "2017", available: "client", kind: "function" })).length, 0);
  assert.equal((await getFunction("AngleDiff", "2017"))?.available, "both");
  assert.ok(await getClass("C_DOTA_BaseNPC", false, "2017"));
});

test("inherited lookup remains version-specific and identifies historical inheritance", async () => {
  for (const version of ["2017", "current"] as const) {
    const direct = await getClass("CDOTA_BaseNPC_Hero", false, version);
    const inherited = await getClass("CDOTA_BaseNPC_Hero", true, version);
    assert.ok(direct && inherited);
    assert.ok(inherited.methods.length > direct.methods.length);
    const method = await getMethod("CDOTA_BaseNPC_Hero", "AddAbility", version);
    assert.equal(method?.owner, "CDOTA_BaseNPC");
    assert.equal(method?.method.name, "AddAbility");
  }
  assert.match((await getClass("CDOTA_BaseNPC_Hero", false, "2017"))?.inheritanceSource ?? "", /410db4c72fb50215be87517f3f74761a9973812a/);
  assert.equal(await getMethod("CDOTA_BaseNPC_Hero", "IsDebuffImmune", "2017"), undefined);
  assert.ok(await getMethod("CDOTA_BaseNPC_Hero", "IsDebuffImmune", "current"));
});

test("Panorama exposes engine and historical evidence separately and keeps partial declarations", async () => {
  const old = await loadPanorama("2017");
  const modern = await loadPanorama("current");
  assert.notStrictEqual(old, modern);
  assert.strictEqual(await loadPanorama("2017"), old);
  assert.strictEqual(await loadPanorama("current"), modern);
  assert.equal(await getPanorama("LocalInventory", "2017"), undefined);
  assert.ok(await getPanorama("LocalInventory", "current"));
  const observed = await getPanorama("GameEvents.Subscribe", "2017");
  assert.ok(observed?.kind === "member");
  assert.equal(observed.member.source, "engine-help");
  assert.ok(observed.member.referenceSignatures?.some((signature) => signature.startsWith("Subscribe(")));
  assert.deepEqual(await getPanorama("CPanoramaScript_GameEvents.Subscribe", "2017"), observed);
  assert.ok(await getPanoramaInterface("CPanoramaScript_GameEvents", "2017"));
  const reference = await getPanorama("Players.GetLocalPlayer", "2017");
  assert.ok(reference?.kind === "member");
  assert.equal(reference.member.source, "historical-reference");
  const createPanel = await getPanorama("$.CreatePanel", "2017");
  assert.ok(createPanel?.kind === "member");
  assert.ok(createPanel.member.referenceSignatures?.some((signature) => signature.includes('"Label"')));
  assert.ok(createPanel.member.referenceSignatures?.some((signature) => signature.includes('"DOTAAbilityImage"')));
  const label = await getPanoramaInterface("LabelPanel", "2017");
  assert.ok(label?.members.some((member) => member.name === "SetParent" && member.inheritedFrom === "Panel"));
  assert.match(label?.members.find((member) => member.name === "SetParent")?.inheritanceSource ?? "", /410db4c72/);
  const enumValue = await getPanorama("Attributes.DOTA_ATTRIBUTE_MAX", "2017");
  assert.ok(enumValue?.kind === "enum-member");
  assert.equal(enumValue.member.value, 3);
  assert.ok((await searchPanorama("DOTA_ATTRIBUTE_MAX", 10, "2017")).some((hit) => hit.kind === "enum" && hit.name === "Attributes"));
  assert.equal((await panoramaStats("2017")).enums, 47);
});

test("auto uses build metadata and environment changes never reuse another version's cache", async (t) => {
  const names = ["DOTA2_API_VERSION", "DOTA2_PATH", "DOTA2_EXE", "DOTA2_VERSION"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const root = await mkdtemp(join(tmpdir(), "dota-api-version-"));
  t.after(async () => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("dota-api-version-"));
    await rm(root, { recursive: true, force: true });
  });
  const fixture = async (name: string, date: string, build: string) => {
    const directory = join(root, name);
    await mkdir(join(directory, "game", "bin", "win64"), { recursive: true });
    await mkdir(join(directory, "game", "dota"), { recursive: true });
    await writeFile(join(directory, "game", "bin", "win64", "dota2.exe"), "");
    await writeFile(join(directory, "game", "dota", "steam.inf"), `ClientVersion=${build}\nVersionDate=${date}\n`);
    return directory;
  };
  // Arbitrary folder names must not determine build identity.
  const oldRoot = await fixture("custom-a", "Oct 03 2017", "2439");
  const modernRoot = await fixture("custom-b", "Oct 15 2026", "6962");
  const unknownRoot = await fixture("unknown", "Oct 15 2019", "999");
  delete process.env.DOTA2_EXE;
  delete process.env.DOTA2_VERSION;
  process.env.DOTA2_API_VERSION = "auto";
  process.env.DOTA2_PATH = oldRoot;
  assert.equal(await resolveApiVersion(), "2017");
  assert.equal((await loadApi()).metadata.version, "2017");
  assert.equal((await loadPanorama()).metadata.version, "2017");
  process.env.DOTA2_PATH = modernRoot;
  assert.equal((await loadApi()).metadata.version, "current");
  assert.equal((await loadPanorama()).metadata.version, "current");
  process.env.DOTA2_PATH = oldRoot;
  assert.equal((await loadApi()).metadata.version, "2017");

  process.env.DOTA2_API_VERSION = "current";
  assert.equal((await loadApi()).metadata.version, "current");
  assert.equal((await loadApi("2017")).metadata.version, "2017");
  process.env.DOTA2_PATH = join(root, "absent");
  process.env.DOTA2_API_VERSION = "2017";
  assert.equal((await loadApi()).metadata.version, "2017", "explicit API selection works without an installation");
  process.env.DOTA2_API_VERSION = "invalid";
  await assert.rejects(loadApi(), /API version must be/);
  await assert.rejects(loadPanorama(), /API version must be/);
  process.env.DOTA2_API_VERSION = "auto";
  process.env.DOTA2_PATH = unknownRoot;
  await assert.rejects(loadApi(), /no known API dataset/);
  assert.equal((await loadApi("current")).metadata.version, "current");
});

test("captured sources have verified hashes and retain every documented binding", async () => {
  const capture = JSON.parse(await readFile(new URL("capture.json", source), "utf8"));
  const texts = new Map<string, string>();
  for (const evidence of capture.captures) {
    const text = await readFile(new URL(evidence.file, source), "utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), evidence.sha256);
    assert.equal(Buffer.byteLength(text), evidence.bytes);
    assert.equal(evidence.completed, true);
    texts.set(evidence.command, text);
  }
  const parsed = mergeLuaHelp(parseLuaHelp(texts.get("script_help2")!, "server"), parseLuaHelp(texts.get("cl_script_help2")!, "client"));
  const bundled = await loadApi("2017");
  assert.deepEqual(bundled.functions, parsed.functions);
  assert.deepEqual(bundled.enums, parsed.enums);
  for (const cls of parsed.classes) assert.deepEqual(bundled.classes.find((candidate) => candidate.name === cls.name)?.methods, cls.methods);
  const panorama = parsePanoramaHelp(texts.get("cl_panorama_script_help_2")!);
  assert.equal(panorama.interfaces.length, 9);
  assert.equal(panorama.interfaces.reduce((count, iface) => count + iface.members.length, 0), 235);
  assert.deepEqual((await loadPanorama("2017")).enums, panorama.enums);
});

test("both API datasets retain the exact build reference and all twelve user-provided depot manifests", async () => {
  const capture = JSON.parse(await readFile(new URL("capture.json", source), "utf8"));
  const provenance = validateBuildProvenance(
    JSON.parse(await readFile(new URL("build-provenance.json", source), "utf8")), capture.build,
  );
  assert.equal(provenance.gameTracking.commit, "b0c2741e6f27ec8dbf7c64b5dd16b09b744e8b43");
  assert.equal(provenance.gameTracking.committedAt, "2017-10-03T21:33:23Z");
  assert.equal(provenance.gameTracking.commitMessage, "2439");
  assert.deepEqual(provenance.gameTracking.steamInf.fields, capture.build);
  assert.equal(provenance.gameTracking.builtFromCl.value, "4163522");
  assert.notEqual(provenance.gameTracking.builtFromCl.value, capture.build.SourceRevision);
  assert.deepEqual(provenance.gameTracking.fileComparisons.map((entry) => [entry.file, entry.normalization, entry.localSha256]), [
    ["game/dota/scripts/npc/npc_heroes.txt", "crlf-to-lf", "475dd51eb2d470ad04a4f66a3ecda7ba499685b118607e1bf6e3db753c10d1de"],
    ["game/dota/scripts/npc/npc_abilities.txt", "crlf-to-lf", "008c208e7213f07a4e1eaefbf8baf1b87f4b64c559639597e7ef2f488bdcd1b9"],
  ]);
  assert.equal(provenance.steamDepots.source, "user-provided");
  assert.equal(provenance.steamDepots.verification, "not-verified-with-steam");
  assert.deepEqual(provenance.steamDepots.manifests.map((entry) => `${entry.depotId}:${entry.manifestId}:${entry.timestampUtc}`), [
    "401531:2584546951486746157:2017-08-04T05:01:32Z",
    "401535:2143530079580212094:2017-08-04T05:01:32Z",
    "401536:7563459139404866682:2017-08-25T22:58:55Z",
    "373301:4455679832719950819:2017-10-03T21:31:46Z",
    "373302:6325604447374221668:2017-10-03T21:31:46Z",
    "373303:1595066998195080085:2017-10-03T21:31:46Z",
    "381450:5476841312133665669:2017-10-03T21:31:46Z",
    "381451:3696387136197526337:2017-10-03T21:31:46Z",
    "381452:4017046896180454612:2017-09-22T22:03:09Z",
    "381453:2666756805838218907:2017-09-18T23:31:18Z",
    "381454:2522752685000682766:2017-09-14T22:43:31Z",
    "381455:9216358069417351890:2017-09-19T23:46:50Z",
  ]);
  const depotManifestRecords = JSON.parse(await readFile(new URL("depots.json", dataset), "utf8"));
  assert.equal(depotManifestRecords.length, 12);
  assert.ok(depotManifestRecords.every((entry: Record<string, unknown>) =>
    Object.keys(entry).sort().join(",") === "date,depot-id,manifest-id"));
  assert.deepEqual(depotManifestRecords.map((entry: Record<string, string>) =>
    `${entry["depot-id"]}:${entry["manifest-id"]}:${entry.date}`),
  provenance.steamDepots.manifests.map((entry) => `${entry.depotId}:${entry.manifestId}:${entry.timestampUtc}`));
  for (const metadata of [(await loadApi("2017")).metadata, (await loadPanorama("2017")).metadata]) {
    assert.deepEqual(metadata.buildProvenance, provenance);
    assert.ok(metadata.sources.some((entry) => entry.commit === provenance.gameTracking.commit));
    assert.ok(metadata.limitations.some((entry) => entry.includes("no Steam depot download or manifest verification")));
  }
  assert.equal((await loadApi("current")).metadata.buildProvenance, undefined);
  assert.equal((await loadPanorama("current")).metadata.buildProvenance, undefined);
});

test("provenance validation rejects mismatched builds, rounded identifiers and unsupported verification claims", async () => {
  const capture = JSON.parse(await readFile(new URL("capture.json", source), "utf8"));
  const text = await readFile(new URL("build-provenance.json", source), "utf8");
  const valid = JSON.parse(text);
  assert.throws(() => validateBuildProvenance(valid, { ...capture.build, SourceRevision: "4163624" }), /captured build does not match/);
  const missingField = JSON.parse(text);
  delete missingField.gameTracking.steamInf.fields.ServerVersion;
  assert.throws(() => validateBuildProvenance(missingField, capture.build), /captured build does not match/);
  const rounded = JSON.parse(text);
  rounded.steamDepots.manifests[11].manifestId = Number(rounded.steamDepots.manifests[11].manifestId);
  assert.throws(() => validateBuildProvenance(rounded, capture.build), /decimal strings/);
  const overflow = JSON.parse(text);
  overflow.steamDepots.manifests[0].manifestId = "18446744073709551616";
  assert.throws(() => validateBuildProvenance(overflow, capture.build), /decimal strings/);
  const duplicate = JSON.parse(text);
  duplicate.steamDepots.manifests.push(duplicate.steamDepots.manifests[0]);
  assert.throws(() => validateBuildProvenance(duplicate, capture.build), /duplicate depot/);
  const claimedVerification = JSON.parse(text);
  claimedVerification.steamDepots.verification = "verified-with-steam";
  assert.throws(() => validateBuildProvenance(claimedVerification, capture.build), /unverified provenance/);
  const eighteenDigits = JSON.parse(text);
  eighteenDigits.steamDepots.manifests[0].manifestId = "123456789012345678";
  assert.equal(validateBuildProvenance(eighteenDigits, capture.build).steamDepots.manifests[0].manifestId, "123456789012345678");
});

test("offline builder reproduces the bundles and rejects a mismatched capture before publishing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dota-api-provenance-"));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("dota-api-provenance-"));
    await rm(root, { recursive: true, force: true });
  });
  const network = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Network access is forbidden during an offline build.");
  });
  const output = join(root, "generated");
  await buildApiSnapshots({ source: fileURLToPath(source), output });
  for (const name of ["dota-api.json", "panorama-api.json"]) {
    assert.equal(await readFile(join(output, name), "utf8"), await readFile(new URL(`../${name}`, source), "utf8"));
  }
  const mismatchedSource = join(root, "mismatched");
  const rejectedOutput = join(root, "rejected");
  await mkdir(mismatchedSource);
  const capture = JSON.parse(await readFile(new URL("capture.json", source), "utf8"));
  capture.build.SourceRevision = "4163624";
  await writeFile(join(mismatchedSource, "capture.json"), JSON.stringify(capture));
  await writeFile(join(mismatchedSource, "build-provenance.json"), await readFile(new URL("build-provenance.json", source)));
  await assert.rejects(buildApiSnapshots({ source: mismatchedSource, output: rejectedOutput }), /captured build does not match/);
  await assert.rejects(readFile(join(rejectedOutput, "dota-api.json")), { code: "ENOENT" });
  await assert.rejects(readFile(join(rejectedOutput, "panorama-api.json")), { code: "ENOENT" });
  assert.equal(network.mock.callCount(), 0);
});

test("help parsers reject truncated or malformed output instead of publishing a partial dataset", () => {
  const valid = "---[[ Foo  Description ]]\n-- @return void\n-- @param int_1 int\nfunction Foo( int_1 ) end\n";
  assert.equal(parseLuaHelp(valid, "server").functions[0].name, "Foo");
  assert.throws(() => parseLuaHelp(valid.replace("int_1 )", "missing )"), "server"), /parameter/);
  assert.throws(() => parseLuaHelp(valid.slice(0, -6), "server"), /Incomplete/);
  assert.throws(() => parseLuaHelp("Unknown command: script_help2", "server"), /Incomplete/);
  const table = '=== Example ===\n{| class="standard-table"\n! Function\n! Signature\n! Description\n|-\n| Foo\n| <code>Foo()</code>\n| Example\n|}\n';
  assert.equal(parsePanoramaHelp(table).interfaces[0].members[0].name, "Foo");
  assert.throws(() => parsePanoramaHelp(table.slice(0, -3)), /Incomplete/);
  assert.throws(() => parsePanoramaHelp(table.replace("| Example\n", "")), /Invalid/);
});

test("MCP responses and not-found errors expose the selected version and source", async () => {
  const server = new McpServer({ name: "api-contract-test", version: "1.0.0" });
  registerApiTools(server);
  registerDocsTools(server);
  const client = new Client({ name: "api-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const legacy = await client.callTool({ name: "lua_api_get", arguments: { name: "CreateUnitByName", version: "2017" } });
    const legacyData = legacy.structuredContent as { metadata: ApiDatasetMetadata };
    assert.equal(legacy.isError, undefined);
    assert.equal(legacyData.metadata.version, "2017");
    assert.equal(legacyData.metadata.build?.ClientVersion, "2439");
    assert.equal(legacyData.metadata.buildProvenance?.gameTracking.commit, "b0c2741e6f27ec8dbf7c64b5dd16b09b744e8b43");
    const missing = await client.callTool({ name: "lua_api_get", arguments: { name: "GetDedicatedServerKeyV3", version: "2017" } });
    assert.equal(missing.isError, true);
    assert.equal((missing.structuredContent as { metadata: { version: string } }).metadata.version, "2017");
    const present = await client.callTool({ name: "lua_api_get", arguments: { name: "GetDedicatedServerKeyV3", version: "current" } });
    assert.equal(present.isError, undefined);
    const panorama = await client.callTool({ name: "panorama_api_get", arguments: { name: "Players.GetLocalPlayer", version: "2017" } });
    const panData = panorama.structuredContent as { metadata: ApiDatasetMetadata; member: { source: string } };
    assert.equal(panData.metadata.version, "2017");
    assert.equal(panData.member.source, "historical-reference");
    assert.deepEqual(panData.metadata.buildProvenance, legacyData.metadata.buildProvenance);
    assert.equal(panData.metadata.buildProvenance?.steamDepots.manifests[11].manifestId, "9216358069417351890");
    const en = await client.callTool({ name: "panorama_api_get", arguments: { name: "Attributes.DOTA_ATTRIBUTE_MAX", version: "2017" } });
    assert.equal((en.structuredContent as { member: { value: number } }).member.value, 3);
    const stats = await apiStats("2017");
    assert.ok(stats.metadata.sources.some((item) => item.command === "script_help2"));
  } finally {
    await client.close();
    await server.close();
  }
});

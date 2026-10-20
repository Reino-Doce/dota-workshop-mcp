#!/usr/bin/env node
// Offline by default:
//   node --import tsx scripts/build-api-snapshots.mjs
// To restore the three pinned community reference sources:
//   node --import tsx scripts/build-api-snapshots.mjs --download-reference
// Runtime source capture is separate: scripts/build-api-capture.mjs.
import ts from "typescript";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLuaHelp, mergeLuaHelp, parsePanoramaHelp } from "../src/api/engine.ts";
import { validateBuildProvenance } from "../src/api/version.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "data", "versions", "2439");
const SOURCE = join(OUT, "source");
const COMMIT = "410db4c72fb50215be87517f3f74761a9973812a";
const REPOSITORY = "https://github.com/ModDota/API";
const REFERENCES = [
  { file: "_data/lua_server.json", sha256: "c50bef30de3898bfc83e91dd13692cadd105e2aedf428a7315f440a59180cf7f", lastChangedAt: "2017-06-21T00:46:52Z" },
  { file: "dota.d.ts", sha256: "2c1604e210d7b498449daa6680cac26cfcde046c7188bd437d7c579616daa880", lastChangedAt: "2017-09-24T11:22:32Z" },
  { file: "dota_panels.d.ts", sha256: "0d54f57904c9198c930940ba908619a7ff4fdfdb4adeb9fd2b394528b294e09c", lastChangedAt: "2017-09-17T11:50:59Z" },
];
const hash = (text) => createHash("sha256").update(text).digest("hex");
const referenceSource = (ref) => ({
  name: "ModDota/API historical reference",
  url: `${REPOSITORY}/blob/${COMMIT}/${ref.file}`,
  file: ref.file, commit: COMMIT, lastChangedAt: ref.lastChangedAt, sha256: ref.sha256,
});

function jsdoc(node) {
  return (node.jsDoc ?? []).map((doc) => typeof doc.comment === "string" ? doc.comment : "").filter(Boolean).join("\n") || undefined;
}

/** Merge TypeScript interface declarations before inheritance (DollarStatic is partial). */
function parseReferences(files) {
  const interfaces = new Map();
  const globals = [];
  for (const [file, text] of files) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length) throw new Error(`Invalid historical TypeScript source: ${file}.`);
    for (const node of source.statements) {
      if (ts.isInterfaceDeclaration(node)) {
        const name = node.name.text;
        const iface = interfaces.get(name) ?? { name, members: [], source: "historical-reference" };
        iface.description ??= jsdoc(node);
        const bases = node.heritageClauses?.flatMap((clause) => clause.types.map((type) => type.expression.getText(source)));
        if (bases?.length) {
          iface.extends = [...new Set([...(iface.extends ?? []), ...bases])];
          iface.inheritanceSource = `ModDota/API@${COMMIT}`;
        }
        for (const member of node.members) {
          const name = member.name?.getText(source) ??
            (ts.isCallSignatureDeclaration(member) ? "(call)" : ts.isIndexSignatureDeclaration(member) ? "[index]" : undefined);
          if (!name) throw new Error(`Unsupported historical declaration in ${iface.name}.`);
          const signature = member.getText(source).replace(/\s+/g, " ").trim().replace(/;$/, "");
          if (iface.members.some((m) => m.signature === signature)) continue;
          iface.members.push({
            name, signature, source: "historical-reference", description: jsdoc(member),
            kind: ts.isMethodSignature(member) || ts.isCallSignatureDeclaration(member) ? "method" : "property",
          });
        }
        interfaces.set(name, iface);
      } else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.type) throw new Error(`Unsupported historical global in ${file}.`);
          globals.push({
            name: declaration.name.text, type: declaration.type.getText(source), declared: true,
            source: "historical-reference", description: jsdoc(node),
          });
        }
      }
    }
  }
  return { interfaces: [...interfaces.values()], globals };
}

function flattenInherited(interfaces) {
  const byName = new Map(interfaces.map((iface) => [iface.name, iface]));
  const own = new Map(interfaces.map((iface) => [iface.name, iface.members]));
  const cache = new Map();
  const resolve = (name, stack = new Set()) => {
    if (cache.has(name)) return cache.get(name);
    if (stack.has(name)) throw new Error(`Historical Panorama inheritance cycle at ${name}.`);
    const iface = byName.get(name);
    if (!iface) return []; // CSSStyleDeclaration is intentionally not filled from a modern DOM library.
    stack.add(name);
    const members = [...own.get(name)];
    const names = new Set(members.map((member) => member.name));
    for (const base of iface.extends ?? []) {
      for (const member of resolve(base, stack)) {
        if (!names.has(member.name)) members.push({
          ...member, inheritedFrom: member.inheritedFrom ?? base, inheritanceSource: iface.inheritanceSource,
        });
      }
    }
    stack.delete(name);
    cache.set(name, members);
    return members;
  };
  for (const iface of interfaces) iface.members = resolve(iface.name);
}

function combinePanorama(engine, reference) {
  const out = structuredClone(reference);
  for (const observed of engine.interfaces) {
    const aliases = engine.globals.filter((global) => global.type === observed.name);
    const priorGlobal = aliases.map((alias) => out.globals.find((global) => global.name === alias.name)).find(Boolean);
    const name = priorGlobal?.type ?? observed.name;
    let iface = out.interfaces.find((candidate) => candidate.name === name);
    if (!iface) { iface = { name, members: [] }; out.interfaces.push(iface); }
    iface.engineName = observed.name;
    iface.source = "engine-help";
    for (const member of observed.members) {
      const prior = iface.members.filter((candidate) => candidate.name === member.name);
      iface.members = iface.members.filter((candidate) => candidate.name !== member.name);
      iface.members.push({
        ...member, kind: prior[0]?.kind ?? member.kind,
        ...(prior.length ? { referenceSignatures: prior.map((candidate) => candidate.signature) } : {}),
      });
    }
    for (const alias of aliases) {
      const prior = out.globals.find((candidate) => candidate.name === alias.name);
      if (prior) Object.assign(prior, { type: name, source: "engine-help" });
      else out.globals.push({ ...alias, type: name });
    }
  }
  flattenInherited(out.interfaces);
  out.enums = engine.enums;
  return out;
}

export async function buildApiSnapshots({ source = SOURCE, output = OUT, downloadReference = false } = {}) {
  const capture = JSON.parse(await readFile(join(source, "capture.json"), "utf8"));
  if (capture.schemaVersion !== 1 || !/\b2017\b/.test(capture.build?.VersionDate ?? "")) throw new Error("Expected captured 2017 build metadata.");
  const buildProvenance = validateBuildProvenance(
    JSON.parse(await readFile(join(source, "build-provenance.json"), "utf8")), capture.build,
  );
  const references = new Map();
  for (const ref of REFERENCES) {
    // Reference declarations are data, not ambient declarations for this server.
    const storedName = ref.file.endsWith(".d.ts") ? `${ref.file}.txt` : ref.file;
    const file = join(source, "reference", ...storedName.split("/"));
    if (downloadReference) {
      const response = await fetch(`https://raw.githubusercontent.com/ModDota/API/${COMMIT}/${ref.file}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Reference download failed: ${response.status} ${ref.file}.`);
      const body = Buffer.from(await response.arrayBuffer());
      if (hash(body) !== ref.sha256) throw new Error(`Reference checksum mismatch: ${ref.file}.`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body);
    }
    const text = await readFile(file, "utf8");
    if (hash(text) !== ref.sha256) throw new Error(`Reference checksum mismatch: ${ref.file}.`);
    references.set(ref.file, text);
  }
  const dumps = new Map();
  for (const command of ["script_help2", "cl_script_help2", "cl_panorama_script_help_2"]) {
    const evidence = capture.captures.find((entry) => entry.command === command && entry.completed);
    if (!evidence || evidence.file !== `${command}.txt`) throw new Error(`Missing complete capture: ${command}.`);
    const text = await readFile(join(source, evidence.file), "utf8");
    if (hash(text) !== evidence.sha256 || Buffer.byteLength(text) !== evidence.bytes) throw new Error(`Capture checksum mismatch: ${command}.`);
    dumps.set(command, text);
  }
  const baseMetadata = {
    version: "2017", provenance: "engine-help", build: capture.build,
    buildProvenance,
    executableSha256: capture.executableSha256, capturedAt: capture.capturedAt,
  };
  const trackingSource = {
    name: "SteamTracking/GameTracking-Dota2 build reference",
    url: `${buildProvenance.gameTracking.repository}/tree/${buildProvenance.gameTracking.commit}`,
    commit: buildProvenance.gameTracking.commit, lastChangedAt: buildProvenance.gameTracking.committedAt,
    file: "source/build-provenance.json",
  };
  const depotLimitation = "Depot IDs, manifest IDs and timestamps are user-provided; no Steam depot download or manifest verification was performed.";
  const engineSources = (commands) => capture.captures.filter((entry) => commands.includes(entry.command)).map((entry) => ({
    name: "Valve Dota 2 engine help", command: entry.command, file: `source/${entry.file}`, sha256: entry.sha256,
  }));

  const lua = mergeLuaHelp(parseLuaHelp(dumps.get("script_help2"), "server"), parseLuaHelp(dumps.get("cl_script_help2"), "client"));
  const historicalLua = JSON.parse(references.get("_data/lua_server.json"));
  for (const cls of lua.classes) {
    const base = historicalLua[cls.name]?.extends;
    if (base && lua.classes.some((candidate) => candidate.name === base)) {
      cls.extends = base;
      cls.inheritanceSource = `ModDota/API@${COMMIT}`;
    }
  }
  lua.generatedAt = capture.capturedAt;
  lua.metadata = {
    ...baseMetadata, language: "vscript", label: `Dota build ${capture.build.ClientVersion} VScript engine help`,
    sources: [...engineSources(["script_help2", "cl_script_help2"]), referenceSource(REFERENCES[0]), trackingSource],
    coverage: [
      "Function names, signatures, descriptions, scoped enums and server/client availability from complete engine help captures.",
      "Server class inheritance is supplemented from the pinned historical reference and identified on each class.",
    ],
    limitations: [
      "Bindings were enumerated from this build; individual functions were not executed.",
      "Class inheritance comes from a June 2017 reference, not from the engine help output; client-only inheritance is not inferred.",
      "Unscoped constants and undocumented bindings are not enumerated by these help commands.",
      `The 2017 family selects build ${capture.build.ClientVersion}; another build can differ.`,
      depotLimitation,
    ],
  };

  const panorama = combinePanorama(
    parsePanoramaHelp(dumps.get("cl_panorama_script_help_2")),
    parseReferences([...references].filter(([file]) => file.endsWith(".d.ts"))),
  );
  panorama.generatedAt = capture.capturedAt;
  panorama.metadata = {
    ...baseMetadata, language: "panorama", label: `Dota build ${capture.build.ClientVersion} Panorama reference with engine help`,
    sources: [...engineSources(["cl_panorama_script_help_2"]), ...REFERENCES.slice(1).map(referenceSource), trackingSource],
    coverage: [
      "Captured engine interfaces, members, global aliases and enums take precedence.",
      "Dota-specific globals and panel declarations absent from the active help context are supplemented from September 2017 sources.",
      "Every historical-only global, interface and member is marked source=historical-reference; runtime members retain historical typed referenceSignatures separately.",
    ],
    limitations: [
      "Engine help is context-dependent; historical-reference members were not observed in this running build.",
      "Engine help omits return types and property distinctions; historical typed signatures and inheritance remain separate reference evidence.",
      "CSSStyleDeclaration is external to the historical sources and is not filled from a modern browser library.",
      `The 2017 family selects build ${capture.build.ClientVersion}; another build can differ.`,
      depotLimitation,
    ],
  };
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "dota-api.json"), JSON.stringify(lua) + "\n", "utf8");
  await writeFile(join(output, "panorama-api.json"), JSON.stringify(panorama) + "\n", "utf8");
  return {
    version: "2017", build: capture.build.ClientVersion,
    lua: { classes: lua.classes.length, functions: lua.functions.length, methods: lua.classes.reduce((count, cls) => count + cls.methods.length, 0), enums: lua.enums.length },
    panorama: { interfaces: panorama.interfaces.length, members: panorama.interfaces.reduce((count, iface) => count + iface.members.length, 0), globals: panorama.globals.length, enums: panorama.enums.length },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== "--download-reference")) throw new Error("Supported option: --download-reference.");
  console.log(JSON.stringify(await buildApiSnapshots({ downloadReference: process.argv.includes("--download-reference") })));
}

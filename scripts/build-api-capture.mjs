#!/usr/bin/env node
// Capture engine help only; does not launch a game, load a map or execute user scripts.
// node --import tsx scripts/build-api-capture.mjs --root <installation> --port <port> --out <new-directory>
import { mkdir, readFile, writeFile, lstat, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, relative, isAbsolute } from "node:path";
import { inspectDotaInstallation } from "../src/dota/paths.ts";
import { findDotaProcess } from "../src/dota/target.ts";
import { VConsoleClient } from "../src/dota/vconsole.ts";
import { parseLuaHelp, parsePanoramaHelp } from "../src/api/engine.ts";

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--root", "--port", "--out", "--protocol"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || options[args[i]] !== undefined) {
    throw new Error("Use --root <installation> --port <port> --out <new-directory> [--protocol auto|d2|d3|d4].");
  }
  options[args[i]] = args[i + 1];
}
if (!options["--root"] || !options["--port"] || !options["--out"]) throw new Error("--root, --port and --out are required.");
const installation = await inspectDotaInstallation(options["--root"]);
if (!installation || !installation.build?.ClientVersion) throw new Error("The installation must include dota2.exe and steam.inf build metadata.");
const port = Number(options["--port"]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
const protocol = options["--protocol"] ?? "auto";
if (!["auto", "d2", "d3", "d4"].includes(protocol)) throw new Error("Invalid protocol.");
const output = resolve(options["--out"]);
try { await lstat(output); throw new Error("The output directory must not already exist."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
process.env.DOTA2_EXE = installation.dota2Exe;
const target = await findDotaProcess(port);
if (!target) throw new Error("No running Dota process for this installation and endpoint. Start a map before capturing help.");
const client = new VConsoleClient("127.0.0.1", port, protocol, "auto");
const hash = (body) => createHash("sha256").update(body).digest("hex");
const captures = [];
const files = [];
try {
  await client.connect(10000);
  for (const command of ["script_help2", "cl_script_help2", "cl_panorama_script_help_2"]) {
    const lines = await client.sendAndCapture(command, undefined, 30000, { maxLines: 25000, maxBytes: 2 * 1024 * 1024 });
    const text = lines.map((line) => line.text).join("\n") + "\n";
    if (command === "cl_panorama_script_help_2") parsePanoramaHelp(text);
    else parseLuaHelp(text, command === "script_help2" ? "server" : "client");
    captures.push({ command, file: `${command}.txt`, bytes: Buffer.byteLength(text), sha256: hash(text), printMessages: lines.length, completed: true });
    files.push([`${command}.txt`, text]);
  }
  const current = await findDotaProcess(port);
  if (current?.pid !== target.pid) throw new Error("Dota process changed during capture; discarding output.");
  const record = {
    schemaVersion: 1, source: "Dota 2 engine help commands", capturedAt: new Date().toISOString(),
    build: installation.build, executableSha256: hash(await readFile(installation.dota2Exe)),
    protocol: client.status().wireVersion,
    completion: "VConsole marker round trip after each command", textEncoding: "UTF-8; each PRNT message separated by LF", captures,
  };
  // All command output has been parsed before creating any files. Refuse to
  // replace an existing capture directory or an installation-owned directory.
  const insideInstall = relative(installation.root, output);
  if (!insideInstall || (!insideInstall.startsWith("..") && !isAbsolute(insideInstall))) throw new Error("Keep captured API sources outside the game installation.");
  await mkdir(output, { recursive: false });
  const written = [];
  try {
    for (const [file, text] of files) {
      await writeFile(join(output, file), text, { flag: "wx" });
      written.push(file);
    }
    await writeFile(join(output, "capture.json"), JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  } catch (error) {
    // Only individual files created in this new, explicit output directory are
    // removed; never recursively delete a path derived from user input.
    for (const file of written) await rm(join(output, file), { force: true });
    throw error;
  }
  console.log(JSON.stringify({ output, build: installation.build.ClientVersion, captures }));
} finally { client.disconnect(); }

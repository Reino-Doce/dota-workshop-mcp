#!/usr/bin/env node
// Installed plugins contain sources, not node_modules or an assumed local build.
import { createHash } from "node:crypto";
import { cp, mkdir, open, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const inputs = ["package.json", "package-lock.json", "tsconfig.json", "src"];

async function fingerprint(root) {
  const hash = createHash("sha256").update(`runtime-v1:${process.version}:${process.platform}:${process.arch}`);
  async function add(relative) {
    const path = join(root, relative);
    if ((await stat(path)).isDirectory()) {
      for (const name of (await readdir(path)).sort()) await add(join(relative, name));
    } else {
      hash.update(relative).update("\0").update(await readFile(path)).update("\0");
    }
  }
  for (const input of inputs) await add(input);
  return hash.digest("hex");
}

function runNpm(args, cwd) {
  return new Promise((accept, reject) => {
    // All arguments are fixed below. The shell is needed for npm.cmd installations.
    // Install/build output must never enter the MCP stdout stream.
    const child = spawn("npm", args, {
      cwd, shell: process.platform === "win32", windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, npm_config_update_notifier: "false" },
    });
    child.stdout.pipe(process.stderr, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? accept() :
      reject(new Error(`npm ${args[0]} failed (${signal ?? code}). Check Node.js/npm and registry access, then retry.`)));
  });
}

async function exists(path) {
  return (await stat(path).catch(() => null))?.isFile() === true;
}

export async function prepareRuntime(root = pluginRoot, { run = runNpm, waitMs = 150_000 } = {}) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error("Node.js 22.13 or newer is required.");
  const key = await fingerprint(root);
  const cache = join(root, ".plugin-runtime");
  const runtime = join(cache, key);
  const ready = join(runtime, "ready");
  const entry = join(runtime, "dist", "index.js");
  const usable = async () => await exists(ready) && await exists(entry) &&
    await exists(join(runtime, "node_modules", "@modelcontextprotocol", "sdk", "package.json"));
  if (await usable()) return entry;
  await mkdir(cache, { recursive: true });
  const lockPath = join(cache, `${key}.lock`);
  const deadline = Date.now() + waitMs;
  let lock;
  while (!lock) {
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await usable()) return entry;
      // A killed setup can leave npm children alive. Never reclaim its lock
      // automatically: racing starters could unlink a new owner's live lock.
      const owner = Number(await readFile(lockPath, "utf8").catch(() => ""));
      if (Number.isSafeInteger(owner) && owner > 0) {
        try { process.kill(owner, 0); } catch (probe) {
          if (probe.code === "ESRCH") {
            throw new Error(`Plugin setup was interrupted (owner ${owner}). Check that its npm/build processes have stopped, remove ${lockPath}, then retry.`);
          }
        }
      }
      if (Date.now() >= deadline) throw new Error(`Plugin setup is still locked at ${lockPath}. Check the setup process before retrying.`);
      await delay(100);
    }
  }
  try {
    await lock.writeFile(String(process.pid));
    if (await usable()) return entry;
    await unlink(ready).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await mkdir(runtime, { recursive: true });
    for (const input of inputs) await cp(join(root, input), join(runtime, input), { recursive: true });
    console.error("Preparing Dota Workshop MCP runtime (locked dependencies and local build)...");
    await run(["ci", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund"], runtime);
    await run(["run", "build"], runtime);
    if (!(await exists(entry))) throw new Error("Plugin build did not produce dist/index.js.");
    await writeFile(ready, `${key}\n`);
    return entry;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const entry = await prepareRuntime();
    if (process.argv.includes("--prepare-only")) {
      console.error(`Dota Workshop MCP is ready in ${dirname(entry)}.`);
    } else {
      await import(pathToFileURL(entry).href);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

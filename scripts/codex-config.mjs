#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const forwardedEnvironment = [
  "DOTA2_PATH", "DOTA2_EXE", "DOTA2_VERSION", "DOTA2_INSTALLATIONS_DIR",
  "DOTA2_VCONPORT", "DOTA2_PID", "DOTA2_VCON_PROTOCOL", "DOTA2_VCON_CHANNEL_ENDIAN",
  "DOTA2_API_VERSION", "DOTA2_REFLIB_DIR", "DOTA2_ASSETDB", "DOTA2_FFMPEG",
  "DOTA2_FFMPEG_DIR", "DOTA2_VRF_DIR", "DOTA2_CLOUDFLARED", "DOTA2_CLOUDFLARED_DIR",
  "STEAMCMD_DIR",
];

export async function codexConfiguration(addon, toolTimeout = 900) {
  if (!addon) throw new Error("Provide --addon with an existing addon directory.");
  if (!Number.isSafeInteger(toolTimeout) || toolTimeout < 1) throw new Error("Tool timeout must be a positive integer in seconds.");
  const cwd = resolve(addon);
  if (!(await stat(cwd)).isDirectory()) throw new Error("The addon path must be a directory.");
  const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  if (!(await stat(entry).catch(() => null))?.isFile()) throw new Error("Build the server with npm run build first.");
  // JSON string escaping is also valid for these TOML basic strings.
  const quote = JSON.stringify;
  return `[mcp_servers.dota2-workshop]
command = ${quote(process.execPath)}
args = [${quote(entry)}]
cwd = ${quote(cwd)}
startup_timeout_sec = 30
tool_timeout_sec = ${toolTimeout}
env_vars = ${quote(forwardedEnvironment)}
# This optional backend expects file-based credentials and undocumented endpoints.
disabled_tools = ["image_generate"]

[mcp_servers.dota2-workshop.env]
DOTA2_ADDON_DIR = ${quote(cwd)}
`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: {
      addon: { type: "string" }, "tool-timeout": { type: "string", default: "900" },
      help: { type: "boolean", short: "h" },
    } });
    if (values.help) {
      console.log("Usage: node scripts/codex-config.mjs --addon <directory> [--tool-timeout <seconds>]\nPrints a TOML server entry; does not change client configuration.");
    } else {
      process.stdout.write(await codexConfiguration(values.addon, Number(values["tool-timeout"])));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { DotaPaths } from "./paths.js";
import { openDotaVpk } from "./vpk.js";

/** Legacy depots ship NPC definitions as loose files; prefer those overrides,
 * then the selected installation's archive. Never resolve outside game/dota. */
export async function readBaseGameFile(
  dota: Pick<DotaPaths, "dotaGameDir" | "pak01DirVpk">, path: string,
): Promise<{ data: Buffer; source: "loose" | "vpk" }> {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /[:\0]/.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error("Use a relative path inside the selected game's content directory.");
  }
  let loose: string | undefined;
  try { loose = await realpath(resolve(dota.dotaGameDir, normalized)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (loose) {
    const inside = relative(await realpath(dota.dotaGameDir), loose);
    if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("Content symlink resolves outside the selected game.");
    return { data: await readFile(loose), source: "loose" };
  }
  return { data: await (await openDotaVpk(dota.pak01DirVpk)).read(normalized), source: "vpk" };
}

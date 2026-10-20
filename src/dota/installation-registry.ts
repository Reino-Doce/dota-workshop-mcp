import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function installationId(root: string): string {
  const normalized = process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
  return `dota-${createHash("sha256").update(normalized).digest("hex").slice(0, 20)}`;
}

export function installationRegistryDirectory(): string {
  return resolve(process.env.DOTA2_INSTALLATIONS_DIR ?? join(homedir(), ".dota2-workshop-mcp", "installations"));
}

export async function registeredInstallationPaths(): Promise<{ installationId: string; root: string }[]> {
  const directory = installationRegistryDirectory();
  let files: string[];
  try { files = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries = [];
  for (const file of files.sort().filter((name) => /^dota-[a-f0-9]{20}\.json$/.test(name))) {
    const entry = JSON.parse(await readFile(join(directory, file), "utf8"));
    if (!entry || typeof entry.root !== "string" || !isAbsolute(entry.root) ||
        `${installationId(entry.root)}.json` !== file) {
      throw new Error(`Invalid installation registration: ${file}.`);
    }
    entries.push({ installationId: installationId(entry.root), root: entry.root });
  }
  return entries;
}

/** Each canonical root has its own file, so concurrent registrations cannot lose other roots. */
export async function saveRegisteredInstallation(root: string): Promise<void> {
  const directory = installationRegistryDirectory();
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${installationId(root)}.json`);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ root }, null, 2) + "\n", { flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

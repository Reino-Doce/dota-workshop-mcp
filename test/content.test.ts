import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readBaseGameFile } from "../src/dota/content.js";

test("base content prefers legacy loose files, reads archives and rejects traversal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dota-content-test-"));
  try {
    const entry = Buffer.alloc(18);
    entry.writeUInt16LE(6, 4); entry.writeUInt16LE(0x7fff, 6); entry.writeUInt16LE(0xffff, 16);
    const tree = Buffer.concat([Buffer.from("txt\0 \0packed\0"), entry, Buffer.from("packed\0\0\0")]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x55aa1234); header.writeUInt32LE(1, 4); header.writeUInt32LE(tree.length, 8);
    const dota = { dotaGameDir: directory, pak01DirVpk: join(directory, "pak01_dir.vpk") };
    await writeFile(dota.pak01DirVpk, Buffer.concat([header, tree]));
    assert.equal((await readBaseGameFile(dota, "packed.txt")).source, "vpk");
    assert.equal((await readBaseGameFile(dota, "packed.txt")).data.toString(), "packed");
    await writeFile(join(directory, "packed.txt"), "legacy override");
    assert.deepEqual(await readBaseGameFile(dota, "packed.txt"), { source: "loose", data: Buffer.from("legacy override") });
    for (const path of ["../secret", "..\\secret", "/absolute", "C:\\secret", "file:stream", "nul\0"]) {
      await assert.rejects(readBaseGameFile(dota, path), /relative path/);
    }
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

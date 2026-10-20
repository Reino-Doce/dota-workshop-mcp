import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { inspectDotaInstallation, resolveDotaPaths } from "../src/dota/paths.js";
import { selectDotaProcess } from "../src/dota/target.js";
import { buildLaunchArgs } from "../src/dota/launch.js";
import { vconsoleDeviceName } from "../src/dota/vconsole-app.js";

test("build identity comes from metadata, explicit executable paths work, invalid overrides never fall back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dota-install-test-"));
  const previous = { path: process.env.DOTA2_PATH, exe: process.env.DOTA2_EXE, version: process.env.DOTA2_VERSION };
  try {
    for (const [folder, date, family, version] of [["custom-a", "Oct 03 2017", "2017", "2439"], ["custom-b", "Oct 15 2026", "current", "6962"], ["unknown", "", "unknown", "999"]]) {
      const root = join(directory, folder);
      const exe = join(root, "game/bin/win64/dota2.exe");
      await mkdir(join(root, "game/bin/win64"), { recursive: true });
      await mkdir(join(root, "game/dota"));
      await writeFile(exe, "");
      await writeFile(join(root, "game/dota/steam.inf"), `ClientVersion=${version}\nVersionDate=${date}\n`);
      assert.equal((await inspectDotaInstallation(exe))?.root, root);
      assert.equal((await inspectDotaInstallation(root))?.versionFamily, family);
      process.env.DOTA2_PATH = root;
      delete process.env.DOTA2_EXE;
      assert.equal((await resolveDotaPaths())?.versionFamily, family);
    }
    process.env.DOTA2_PATH = join(directory, "missing");
    await assert.rejects(resolveDotaPaths(), /Refusing to fall back/);
  } finally {
    for (const [key, value] of Object.entries({ DOTA2_PATH: previous.path, DOTA2_EXE: previous.exe, DOTA2_VERSION: previous.version })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("process selection honors endpoint and executable and rejects ambiguous or foreign targets", () => {
  const items = [{ pid: 1, path: "C:/old/dota2.exe" }, { pid: 2, path: "C:/new/dota2.exe" }, { pid: 3, path: "C:/old/dota2.exe" }];
  assert.equal(selectDotaProcess(items, "c:\\OLD\\dota2.exe", 3)?.pid, 3);
  assert.throws(() => selectDotaProcess(items, "C:/old/dota2.exe"), /Multiple/);
  assert.throws(() => selectDotaProcess(items, "C:/old/dota2.exe", 2), /another installation/);
  assert.throws(() => selectDotaProcess(items, "C:/old/dota2.exe", 3, 1), /different processes/);
  assert.equal(selectDotaProcess(items, "C:/new/dota2.exe")?.pid, 2);
});

test("legacy launch can initialize a base map or a custom game", () => {
  const base = buildLaunchArgs({ legacy: true, map: "dota" });
  assert.ok(base.includes("-nosteam"));
  assert.deepEqual(base.slice(-2), ["+map", "dota"]);
  const custom = buildLaunchArgs({ addon: "example", map: "dota" });
  assert.deepEqual(custom.slice(-3), ["+dota_launch_custom_game", "example", "dota"]);
  assert.ok(!custom.includes("-nosteam"));
});

test("VConsole2 device selection uses the explicit loopback endpoint and rejects invalid ports", () => {
  assert.equal(vconsoleDeviceName(29017), "127.0.0.1:29017");
  assert.equal(vconsoleDeviceName(29026), "127.0.0.1:29026");
  for (const port of [0, -1, 65536, 1.5, NaN, Infinity]) {
    assert.throws(() => vconsoleDeviceName(port), /Invalid VConsole port/);
  }
});

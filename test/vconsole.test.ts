import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { VConsoleClient } from "../src/dota/vconsole.js";
import { VConsoleDecoder, decodePrint, encodeCommand } from "../src/dota/vconsole-protocol.js";
import { fakeConsole, frame, print } from "./helpers/vconsole.js";

test("D2/D3/D4 CMND wire bytes, UTF-8 and validation", () => {
  assert.equal(encodeCommand("echo mcp_ping", "d3").toString("hex"), "434d4e4400d30000001a00006563686f206d63705f70696e6700");
  for (const protocol of ["d2", "d3", "d4"] as const) {
    const encoded = encodeCommand("echo olá", protocol);
    assert.equal(encoded.readUInt32BE(6), encoded.length);
    assert.equal(encoded.subarray(12, -1).toString("utf8"), "echo olá");
  }
  for (const invalid of ["", " ", "echo x\0quit", "echo x\nquit", "á".repeat(2049), "\ud800"]) {
    assert.throws(() => encodeCommand(invalid, "d3"));
  }
});

test("fragmented and coalesced frames, unknown chunks and a >64KiB frame", () => {
  const decoder = new VConsoleDecoder();
  const bytes = Buffer.concat([frame("ZZZZ", Buffer.alloc(70000)), print("primeiro"), print("segundo")]);
  const frames = [];
  for (let start = 0; start < bytes.length; start += 97) frames.push(...decoder.push(bytes.subarray(start, start + 97)));
  assert.equal(frames.length, 3);
  assert.equal(decodePrint(frames[0]), undefined);
  assert.deepEqual(frames.slice(1).map((f) => decodePrint(f)?.text), ["primeiro", "segundo"]);
  assert.equal(decoder.pendingBytes, 0);
});

test("malformed header, version, lengths, truncated PRNT and EOF fail explicitly", () => {
  for (const length of [0, 11, 1024 * 1024 + 1]) {
    const bytes = frame("PRNT", Buffer.alloc(0));
    bytes.writeUInt32BE(length, 6);
    assert.throws(() => new VConsoleDecoder().push(bytes), /Invalid VConsole header/);
  }
  const badVersion = frame("AINF", Buffer.alloc(0));
  badVersion.writeUInt16BE(999, 4);
  assert.throws(() => new VConsoleDecoder().push(badVersion));
  assert.throws(() => decodePrint(new VConsoleDecoder().push(frame("PRNT", Buffer.alloc(2)))[0]));
  const decoder = new VConsoleDecoder();
  decoder.push(print("incomplete").subarray(0, 16));
  assert.throws(() => decoder.end(), /middle/);
});

test("D4 convar bulk uses an independent version without changing the command protocol", () => {
  const bulk = frame("CVRB", Buffer.alloc(860000), "d4");
  bulk.writeUInt16BE(2, 4);
  const frames = new VConsoleDecoder().push(Buffer.concat([bulk, print("connected", "d4")]));
  assert.equal(frames[0].protocol, undefined);
  assert.equal(frames[0].version, 2);
  assert.equal(frames[1].protocol, "d4");
  assert.equal(decodePrint(frames[1])?.channel, 7);
});
test("bounded deterministic fuzz never leaves an oversized pending buffer", () => {
  let seed = 1234;
  for (let i = 0; i < 1000; i++) {
    const bytes = Buffer.alloc(i % 81);
    for (let j = 0; j < bytes.length; j++) { seed = (seed * 1664525 + 1013904223) >>> 0; bytes[j] = seed & 255; }
    const decoder = new VConsoleDecoder();
    try { decoder.push(bytes); } catch { /* Rejection is valid. */ }
    assert.ok(decoder.pendingBytes <= 1024 * 1024);
  }
});

for (const protocol of ["d2", "d3", "d4"] as const) {
  test(`live TCP auto-negotiates ${protocol}, captures and filters logs`, async () => {
    const fake = await fakeConsole({ protocol });
    const client = new VConsoleClient("127.0.0.1", fake.port);
    try {
      await client.connect(1000);
      assert.equal(client.status().wireVersion, `0x00${protocol.slice(1) === "2" ? "d2" : protocol === "d3" ? "d3" : "d4"}0000`);
      const lines = await client.sendAndCapture("echo olá", undefined, 1000);
      assert.deepEqual(lines.map((l) => l.text), ["olá"]);
      assert.equal(client.logs({ pattern: "OLÁ", channel: 7, limit: 1 })[0].text, "olá");
      assert.equal(client.logs({ limit: 0 }).length, 0);
      assert.equal(client.listenerCount("failure"), 0);
    } finally { client.disconnect(); await fake.close(); }
  });
}

test("concurrent commands are serialized and do not share output", async () => {
  const fake = await fakeConsole();
  const client = new VConsoleClient("127.0.0.1", fake.port);
  try {
    await client.connect(1000);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => client.sendAndCapture(`echo ${i}`, "untrusted-marker", 3000)));
    assert.deepEqual(results.map((lines) => lines.map((l) => l.text)), Array.from({ length: 20 }, (_, i) => [String(i)]));
    assert.equal(client.status().queuedCommands, 0);
    assert.equal(client.listenerCount("print"), 0);
  } finally { client.disconnect(); await fake.close(); }
});

test("DebugSDK responses remain associated with concurrent callers, even after the sentinel", async () => {
  const fake = await fakeConsole({ onCommand(command, socket) {
    if (!command.startsWith("mcp_eval ")) return;
    setTimeout(() => socket.write(print(`[MCP] EVAL_OK ${command.slice(9)}`)), 20);
    return true;
  } });
  const client = new VConsoleClient("127.0.0.1", fake.port, "d3");
  try {
    await client.connect(1000);
    const results = await Promise.all([1, 2, 3].map((i) =>
      client.sendAndWait(`mcp_eval ${i}`, (line) => line.text.includes("[MCP] EVAL_OK"), 1500)));
    assert.deepEqual(results.map((line) => line.text), [1, 2, 3].map((i) => `[MCP] EVAL_OK ${i}`));
    assert.equal(client.listenerCount("print"), 0);
  } finally { client.disconnect(); await fake.close(); }
});

test("connection deadline includes preflight and its late completion cannot open a socket", async () => {
  const fake = await fakeConsole();
  const client = new VConsoleClient("127.0.0.1", fake.port, "d3", "auto",
    () => new Promise((resolve) => setTimeout(resolve, 150)));
  try {
    const started = Date.now();
    await assert.rejects(client.connect(20), /deadline/);
    assert.ok(Date.now() - started < 120);
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(fake.sockets.size, 0);
    assert.equal(client.isConnected(), false);
  } finally { client.disconnect(); await fake.close(); }
});

test("each caller has its own connection deadline without cancelling shared readiness", async () => {
  const fake = await fakeConsole();
  const client = new VConsoleClient("127.0.0.1", fake.port, "d3", "auto",
    () => new Promise((resolve) => setTimeout(resolve, 120)));
  try {
    const first = client.connect(1000);
    await assert.rejects(client.connect(20), /shared connection attempt/);
    assert.equal(client.isConnected(), false);
    await first;
    assert.equal(client.isConnected(), true);
    assert.equal(fake.sockets.size, 1);
  } finally { client.disconnect(); await fake.close(); }
});
test("capture timeout is an error and expired queued commands are never dispatched", async () => {
  const fake = await fakeConsole({ onCommand: (cmd) => cmd === "hang" || cmd.includes("__MCP_END_") });
  const client = new VConsoleClient("127.0.0.1", fake.port);
  try {
    await client.connect(1000);
    const first = client.sendAndCapture("hang", undefined, 100);
    const expired = client.sendAndCapture("must_not_run", undefined, 20);
    await assert.rejects(expired, { code: "COMMAND_TIMEOUT" });
    await assert.rejects(first, { code: "COMMAND_TIMEOUT" });
    await new Promise((r) => setTimeout(r, 25));
    assert.ok(!fake.commands.includes("must_not_run"));
    assert.equal(client.listenerCount("print"), 0);
  } finally { client.disconnect(); await fake.close(); }
});

test("EOF during command rejects promptly and reconnect uses a fresh decoder", async () => {
  let drop = true;
  const fake = await fakeConsole({ onCommand: (command, socket) => {
    if (command === "drop" && drop) { drop = false; socket.end(print("partial").subarray(0, 15)); return true; }
  } });
  const client = new VConsoleClient("127.0.0.1", fake.port);
  try {
    await client.connect(1000);
    await assert.rejects(client.sendAndCapture("drop", undefined, 1000));
    await new Promise((r) => setTimeout(r, 20));
    await client.connect(1000);
    assert.deepEqual((await client.sendAndCapture("echo recovered")).map((l) => l.text), ["recovered"]);
  } finally { client.disconnect(); await fake.close(); }
});

test("socket readiness without an echo is not game readiness", async () => {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => { sockets.add(socket); socket.on("data", () => {}); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = new VConsoleClient("127.0.0.1", (server.address() as net.AddressInfo).port);
  try {
    await assert.rejects(client.connect(80), { code: "VCONSOLE_UNAVAILABLE" });
    assert.equal(client.isConnected(), false);
  } finally {
    client.disconnect();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("disconnect cancels negotiation without a stale ready transition", async () => {
  const fake = await fakeConsole({ onCommand: (command) => command.includes("__MCP_PROBE_") });
  const client = new VConsoleClient("127.0.0.1", fake.port);
  try {
    const connecting = client.connect(1000);
    setTimeout(() => client.disconnect(), 20);
    await assert.rejects(connecting);
    assert.equal(client.isConnected(), false);
  } finally { client.disconnect(); await fake.close(); }
});

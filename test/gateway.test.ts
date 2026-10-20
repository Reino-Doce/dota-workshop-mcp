import { test } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { createGateway } from "../src/gateway/server.js";
import { gatewaySchema } from "../src/gateway/config.js";
import { commandPolicy, RateLimiter } from "../src/gateway/security.js";
import { VConsoleClient } from "../src/dota/vconsole.js";
import { fakeConsole, print } from "./helpers/vconsole.js";
import { testCertificates } from "./helpers/tls.js";

test("command policy rejects injection, aliases, indirect execution and unknown commands", () => {
  const policy = { allowCommands: ["echo", "exec", "script"], allowDangerous: false };
  assert.equal(commandPolicy("echo test", policy), "allow:echo");
  for (const cmd of ["echo x;quit", "echo x\nquit", "echo \0x", "\"echo\" x", "echo\\x", "quit", "alias x echo", "exec config", "script foo()"]) {
    assert.throws(() => commandPolicy(cmd, policy));
  }
  assert.equal(commandPolicy("exec local", { ...policy, allowDangerous: true }), "allow:exec");
});

test("token bucket enforces burst and refills predictably", () => {
  const limiter = new RateLimiter();
  limiter.take("user:cmd", 10, 2, 0);
  limiter.take("user:cmd", 10, 2, 0);
  assert.throws(() => limiter.take("user:cmd", 10, 2, 0), { code: "RATE_LIMITED" });
  limiter.take("user:cmd", 10, 2, 100);
});

test("HTTPS gateway: mTLS, roles, commands, logs, streams, audit and failure isolation", { timeout: 90000 }, async (t) => {
  const certificates = await testCertificates();
  const fake = await fakeConsole({ onCommand: (command) => command === "hang" || command.includes("__MCP_END_") && hanging });
  let hanging = false;
  const client = new VConsoleClient("127.0.0.1", fake.port, "d3");
  const config = gatewaySchema.parse({
    bind: "127.0.0.1", port: 0, vconPort: fake.port, protocol: "d3", tls: certificates.server,
    principals: ["viewer", "operator", "admin"].map((id) => ({ id, role: id, fingerprint256: certificates.clients[id].fingerprint256 })),
    policy: { allowCommands: ["echo", "hang"] },
  });
  const gateway = await createGateway(config, client);
  const port = await gateway.listen();
  const base = `https://localhost:${port}`;
  const credentials = (role?: string) => ({ ca: certificates.ca, ...(role ? certificates.clients[role] : {}), minVersion: "TLSv1.3" as const });
  const request = (path: string, role?: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; body: any; headers: IncomingHttpHeaders }>((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body);
      const req = https.request(base + path, {
        ...credentials(role), method: payload ? "POST" : "GET",
        headers: { ...(payload ? { "Content-Type": "application/json" } : {}), ...headers },
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => { try { resolve({ status: res.statusCode!, body: JSON.parse(data), headers: res.headers }); } catch (err) { reject(err); } });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(6000, () => req.destroy(new Error("test request timed out")));
      req.end(payload);
    });
  try {
    await client.connect(1000);
    await t.test("TLS requires a valid unexpired client certificate", async () => {
      await assert.rejects(request("/v1/health"));
      await assert.rejects(request("/v1/health", "expired"));
      assert.equal((await request("/v1/health", "outsider")).status, 401);
      assert.equal((await request("/v1/health", "viewer")).status, 200);
      await assert.rejects(new Promise((resolve, reject) => {
        const req = https.get(base + "/v1/health", { ...credentials("viewer"), minVersion: "TLSv1.2", maxVersion: "TLSv1.2" }, resolve);
        req.on("error", reject);
      }));
    });
    await t.test("roles and origin checks apply before execution", async () => {
      assert.equal((await request("/v1/commands", "viewer", { command: "echo forbidden" })).status, 403);
      assert.equal((await request("/v1/audit", "operator")).status, 403);
      assert.equal((await request("/v1/commands", "operator", { command: "echo nope" }, { Origin: "https://untrusted.invalid" })).status, 403);
      assert.ok(!fake.commands.includes("echo forbidden"));
    });
    await t.test("valid commands are captured; invalid, oversized and injected commands are rejected", async () => {
      const response = await request("/v1/commands", "operator", { command: "echo gateway-ok", timeoutMs: 1000 });
      assert.equal(response.status, 200);
      assert.equal(response.body.status, "completed");
      assert.deepEqual(response.body.lines.map((l: { text: string }) => l.text), ["gateway-ok"]);
      assert.equal((await request("/v1/commands", "operator", { command: "echo x;quit" })).status, 422);
      assert.equal((await request("/v1/commands", "operator", { command: "echo x", timeoutMs: -1 })).status, 400);
      assert.equal((await request("/v1/commands", "operator", { command: "á".repeat(3000) })).status, 400);
      assert.equal((await request("/v1/commands", "operator", Buffer.alloc(17000, 32))).status, 400);
      assert.equal((await request("/v1/commands", "operator", Buffer.from([0xc3, 0x28]))).status, 400);
    });
    await t.test("logs filter before limit and validate cursors", async () => {
      const result = await request("/v1/logs?pattern=gateway-ok&channel=7&limit=1", "viewer");
      assert.equal(result.body.lines[0].text, "gateway-ok");
      assert.equal((await request("/v1/logs?after=no", "viewer")).status, 400);
      assert.equal((await request("/v1/logs?limit=999999", "viewer")).status, 400);
    });
    await t.test("SSE delivers live output with event IDs", async () => {
      let stream: ClientRequest;
      let response: IncomingMessage;
      const ready = new Promise<void>((resolve, reject) => {
        stream = https.get(base + "/v1/logs/stream?limit=0&pattern=sse-proof", credentials("viewer"), (res) => {
          response = res;
          res.on("data", (chunk) => {
            if (chunk.toString().includes("vconsole.status")) resolve();
          });
        });
        stream.on("error", reject);
      });
      await ready;
      const output = new Promise<string>((resolve, reject) => {
        stream!.on("error", reject);
        response!.on("data", (chunk) => { if (chunk.toString().includes("sse-proof")) resolve(chunk.toString()); });
      });
      await request("/v1/commands", "operator", { command: "echo sse-proof" });
      assert.match(await output, /id: \d+\nevent: vconsole.print/);
      stream!.destroy();
    });
    await t.test("WebSocket authenticates, streams structured events and restricts writes", async () => {
      const ws = new WebSocket(base.replace("https:", "wss:") + "/v1/ws/logs?limit=0&pattern=ws-proof", credentials("viewer"));
      ws.on("error", () => {});
      await once(ws, "open");
      const printed = new Promise<string>((resolve) => ws.on("message", (data) => { if (data.toString().includes("ws-proof")) resolve(data.toString()); }));
      await request("/v1/commands", "operator", { command: "echo ws-proof" });
      assert.equal(JSON.parse(await printed).type, "vconsole.print");
      ws.send("quit");
      const [code] = await once(ws, "close");
      assert.equal(code, 1008);
    });
    await t.test("SSE drains large events instead of treating backpressure as failure", async () => {
      let stream: ClientRequest;
      let received = "";
      const payload = `large-proof:${"x".repeat(100000)}`;
      let delivered!: (value: string) => void;
      const output = new Promise<string>((resolve) => { delivered = resolve; });
      await new Promise<void>((resolve, reject) => {
        stream = https.get(base + "/v1/logs/stream?limit=0&pattern=large-proof", credentials("viewer"), (res) => {
          res.on("data", (chunk) => {
            received += chunk.toString();
            if (received.includes("vconsole.status")) resolve();
            if (received.includes("large-proof") && received.endsWith("\n\n")) delivered(received);
          });
        });
        stream.on("error", reject);
      });
      try {
        for (const socket of fake.sockets) socket.write(print(payload));
        const received = await Promise.race([output, new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error("Large SSE event was lost")), 3000);
          timer.unref();
        })]);
        const line = received.split("\n").find((line) => line.startsWith("data: ") && line.includes("large-proof"));
        assert.equal(JSON.parse(line!.slice(6)).text, payload);
      } finally { stream!.destroy(); }
    });
    await t.test("audit records command hashes and denials without raw command arguments", async () => {
      const result = await request("/v1/audit", "admin");
      assert.ok(result.body.events.some((e: { outcome: string }) => e.outcome === "COMMAND_DENIED"));
      assert.ok(result.body.events.some((e: { commandHash?: string }) => e.commandHash?.length === 64));
      assert.ok(!JSON.stringify(result.body).includes("gateway-ok"));
    });
    await t.test("timeout and lost Dota do not take down gateway health", async () => {
      hanging = true;
      const result = await request("/v1/commands", "operator", { command: "hang", timeoutMs: 50 });
      assert.equal(result.status, 504);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal((await request("/v1/health", "viewer")).status, 200);
      assert.equal((await request("/v1/vconsole/status", "viewer")).body.dota.reachable, false);
      hanging = false;
    });
    await t.test("request flood is bounded per identity and returns Retry-After", async () => {
      const results = await Promise.all(Array.from({ length: 60 }, () => request("/v1/health", "viewer")));
      const limited = results.filter((result) => result.status === 429);
      assert.ok(limited.length > 0);
      assert.ok(limited.every((result) => result.headers["retry-after"] === "1" && result.body.error.code === "RATE_LIMITED"));
    });
    await t.test("bearer-only access and combined certificate/token requirements", async () => {
      const digest = (value: string) => createHash("sha256").update(value).digest("hex");
      const authConfig = gatewaySchema.parse({
        ...config, tls: { ...certificates.server, requireClientCertificate: false },
        principals: [
          { id: "bearer", role: "viewer", tokenSha256: digest("test-only-bearer") },
          { id: "combined", role: "admin", tokenSha256: digest("test-only-combined"), fingerprint256: certificates.clients.admin.fingerprint256 },
        ],
      });
      const authGateway = await createGateway(authConfig, new VConsoleClient("127.0.0.1", fake.port, "d3"));
      try {
        const authPort = await authGateway.listen();
        const get = (token?: string, certificate?: string) => new Promise<number>((resolve, reject) => {
          const req = https.get(`https://localhost:${authPort}/v1/health`, {
            ...credentials(certificate), headers: token ? { Authorization: `Bearer ${token}` } : {},
          }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode!)); });
          req.on("error", reject);
        });
        assert.equal(await get("test-only-bearer"), 200);
        assert.equal(await get("invalid"), 401);
        assert.equal(await get(), 401);
        assert.equal(await get("test-only-combined"), 401);
        assert.equal(await get(undefined, "admin"), 401);
        assert.equal(await get("test-only-combined", "admin"), 200);
      } finally { await authGateway.close(); }
    });
  } finally {
    await gateway.close();
    await fake.close();
    await certificates.close();
  }
});

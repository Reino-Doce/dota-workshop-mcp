import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { VConsoleClient, ConsoleLine, LogFilter, matchesLog, createLocalVConsole } from "../dota/vconsole.js";
import { GatewayConfig, gatewaySchema } from "./config.js";
import { ApiError, RateLimiter, apiError, authenticate, authorize, commandPolicy } from "./security.js";
import { AuditLog } from "../util/command-audit.js";

const commandSchema = z.object({
  command: z.string().min(1).max(4096),
  timeoutMs: z.number().int().min(1).max(30000).default(5000),
}).strict();
const filterSchema = z.object({
  limit: z.coerce.number().int().min(0).max(4000).default(200),
  channel: z.coerce.number().int().min(0).max(0xffffffff).optional(),
  pattern: z.string().max(256).optional(),
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

function filterFrom(url: URL): LogFilter {
  const parsed = filterSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new ApiError(400, "INVALID_REQUEST", "Invalid log filter. Use limit, channel, pattern (literal substring) and after.");
  return parsed.data;
}

function printEvent(line: ConsoleLine) {
  return { type: "vconsole.print", eventId: line.eventId, channel: line.channel, text: line.text, timestamp: new Date(line.at).toISOString() };
}

function respond(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(data));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
    throw new ApiError(400, "INVALID_REQUEST", "Content-Type must be application/json.");
  }
  const body = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (error?: Error) => {
      request.off("data", onData).off("end", onEnd).off("error", onError).off("aborted", onAborted);
      if (error) { request.resume(); reject(error); } else resolve(Buffer.concat(chunks));
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16384) finish(new ApiError(400, "INVALID_REQUEST", "Request body exceeds 16384 bytes."));
      else chunks.push(chunk);
    };
    const onEnd = () => finish();
    const onError = (error: Error) => finish(error);
    const onAborted = () => finish(new ApiError(400, "INVALID_REQUEST", "Request body was interrupted."));
    request.on("data", onData).once("end", onEnd).once("error", onError).once("aborted", onAborted);
  });
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { throw new ApiError(400, "INVALID_REQUEST", "Body must be valid JSON."); }
}

/** Authenticated HTTPS API; the full filesystem/OS MCP tools remain local stdio. */
export async function createGateway(input: GatewayConfig, injectedClient?: VConsoleClient) {
  const config = gatewaySchema.parse(input);
  const client = injectedClient ?? createLocalVConsole(config.vconPort, config.protocol, config.channelEndian);
  const audit = new AuditLog(config.auditFile);
  const limiter = new RateLimiter();
  const streams = new Map<string, number>();
  const sse = new Set<ServerResponse>();
  const metrics = { requests: 0, denied: 0, rateLimited: 0, slowConsumers: 0 };
  const startedAt = Date.now();
  const [key, cert, ca] = await Promise.all([
    readFile(config.tls.key), readFile(config.tls.cert), config.tls.ca ? readFile(config.tls.ca) : undefined,
  ]);
  const server = https.createServer({
    key, cert, ca, minVersion: "TLSv1.3",
    requestCert: config.tls.requireClientCertificate || config.principals.some((p) => p.fingerprint256),
    rejectUnauthorized: config.tls.requireClientCertificate,
    maxHeaderSize: 8192,
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 128;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const wsPong = new Map<WebSocket, boolean>();
  let stopDiscovery: (() => Promise<void>) | undefined;

  function reserveStream(id: string): () => void {
    const count = streams.get(id) ?? 0;
    if (count >= 3) throw new ApiError(429, "RATE_LIMITED", "At most three log streams per principal.", true);
    streams.set(id, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (streams.get(id) ?? 1) - 1;
      remaining ? streams.set(id, remaining) : streams.delete(id);
    };
  }

  function authenticateRequest(request: IncomingMessage) {
    // Browser certificate credentials can be ambient; reject cross-origin calls.
    if (request.headers.origin) throw new ApiError(403, "FORBIDDEN", "Browser-origin requests are not enabled.");
    return authenticate(request, config);
  }

  server.on("request", (request, response) => {
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const started = Date.now();
    let principalId = "unauthenticated", outcome = "completed", rule: string | undefined, command: string | undefined;
    let action = "request";
    metrics.requests++;
    try {
      const principal = authenticateRequest(request);
      principalId = principal.id;
      limiter.take(`${principal.id}:requests`, 20, 40);
      const url = new URL(request.url ?? "/", "https://gateway.invalid");
      action = `${request.method} ${url.pathname}`;
      if (request.method === "GET" && url.pathname === "/v1/health") {
        respond(response, 200, { requestId, gateway: "ready", uptimeMs: Date.now() - startedAt, vconsole: client.status(), auditWriteErrors: audit.writeErrors });
      } else if (request.method === "GET" && url.pathname === "/v1/vconsole/status") {
        respond(response, 200, { requestId, vconsole: client.status(), dota: { reachable: client.isConnected() } });
      } else if (request.method === "GET" && url.pathname === "/v1/logs") {
        const filter = filterFrom(url);
        respond(response, 200, { requestId, lines: client.logs(filter).map(printEvent), firstEventId: client.status().firstEventId, lastEventId: client.status().lastEventId });
      } else if (request.method === "GET" && url.pathname === "/v1/logs/stream") {
        const filter = filterFrom(url);
        const lastId = request.headers["last-event-id"];
        if (lastId !== undefined) {
          if (typeof lastId !== "string" || !/^\d+$/.test(lastId) || !Number.isSafeInteger(Number(lastId))) throw new ApiError(400, "INVALID_REQUEST", "Invalid Last-Event-ID.");
          filter.after = Number(lastId);
        }
        const release = reserveStream(principal.id);
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
        sse.add(response);
        let closed = false;
        let blocked = false;
        let stallTimer: ReturnType<typeof setTimeout> | undefined;
        const backlog = client.logs(filter);
        let backlogIndex = 0;
        let opening: string | undefined = `event: vconsole.status\ndata: ${JSON.stringify(client.status())}\n\n`;
        const queue: { text: string; bytes: number }[] = [];
        let queuedBytes = 0;
        const event = (line: ConsoleLine) => `id: ${line.eventId}\nevent: vconsole.print\ndata: ${JSON.stringify(printEvent(line))}\n\n`;
        const slowConsumer = () => { metrics.slowConsumers++; response.destroy(); };
        const flush = () => {
          while (!closed && !blocked) {
            let text: string;
            if (opening !== undefined) { text = opening; opening = undefined; }
            else if (backlogIndex < backlog.length) text = event(backlog[backlogIndex++]);
            else {
              backlog.length = 0; backlogIndex = 0;
              const next = queue.shift();
              if (!next) return;
              text = next.text; queuedBytes -= next.bytes;
            }
            if (!response.write(text)) {
              blocked = true;
              stallTimer = setTimeout(slowConsumer, 5000);
            }
          }
        };
        const drained = () => { blocked = false; clearTimeout(stallTimer); flush(); };
        response.on("drain", drained);
        const write = (text: string) => {
          if (closed) return;
          const bytes = Buffer.byteLength(text);
          if (queuedBytes + bytes > 2 * 1024 * 1024) return slowConsumer();
          queue.push({ text, bytes }); queuedBytes += bytes; flush();
        };
        const listener = (line: ConsoleLine) => {
          if (matchesLog(line, filter)) write(event(line));
        };
        const heartbeat = setInterval(() => write(": heartbeat\n\n"), 15000);
        const expiry = setTimeout(() => response.end(), 300000);
        response.on("close", () => {
          closed = true;
          clearInterval(heartbeat); clearTimeout(expiry); clearTimeout(stallTimer);
          response.off("drain", drained);
          client.off("print", listener); sse.delete(response); release();
        });
        client.on("print", listener);
        flush();
      } else if (request.method === "POST" && url.pathname === "/v1/commands") {
        authorize(principal, "operator");
        limiter.take(`${principal.id}:commands`, 10, 20);
        const parsed = commandSchema.safeParse(await readJson(request));
        if (!parsed.success) throw new ApiError(400, "INVALID_REQUEST", "Expected command and optional timeoutMs (1..30000).");
        command = parsed.data.command;
        rule = commandPolicy(command, config.policy);
        const lines = await client.sendAndCapture(command, undefined, parsed.data.timeoutMs);
        respond(response, 200, { requestId, status: "completed", command, durationMs: Date.now() - started, lines: lines.map(printEvent) });
      } else if (request.method === "POST" && url.pathname === "/v1/vconsole/reconnect") {
        authorize(principal, "admin");
        limiter.take(`${principal.id}:admin`, 2, 2);
        client.disconnect();
        client.startReconnecting();
        await client.connect(5000);
        respond(response, 200, { requestId, vconsole: client.status() });
      } else if (request.method === "GET" && url.pathname === "/v1/audit") {
        authorize(principal, "admin");
        limiter.take(`${principal.id}:admin`, 2, 2);
        respond(response, 200, { requestId, events: audit.recent(filterFrom(url).limit) });
      } else if (request.method === "GET" && url.pathname === "/v1/metrics") {
        authorize(principal, "admin");
        respond(response, 200, { requestId, gateway: { ...metrics, activeStreams: sse.size + wss.clients.size, auditWriteErrors: audit.writeErrors }, vconsole: client.status() });
      } else throw new ApiError(404, "NOT_FOUND", "Unknown endpoint or method.");
    } catch (err) {
      const failure = apiError(err);
      outcome = failure.code;
      if ([401, 403, 422].includes(failure.status)) metrics.denied++;
      if (failure.status === 429) { metrics.rateLimited++; response.setHeader("Retry-After", "1"); }
      if (!response.headersSent) respond(response, failure.status, { requestId, error: { code: failure.code, message: failure.message, retryable: failure.retryable } });
      else response.destroy();
    } finally {
      audit.record({ requestId, principal: principalId, ip: request.socket.remoteAddress ?? "", action, outcome, durationMs: Date.now() - started, rule }, command);
    }
  }

  server.on("upgrade", (request, socket, head) => {
    const requestId = randomUUID();
    let principalId = "unauthenticated";
    let release: (() => void) | undefined;
    const onError = () => socket.destroy();
    socket.on("error", onError);
    try {
      const principal = authenticateRequest(request);
      principalId = principal.id;
      limiter.take(`${principal.id}:requests`, 20, 40);
      const url = new URL(request.url ?? "/", "https://gateway.invalid");
      if (url.pathname !== "/v1/ws/logs") throw new ApiError(404, "NOT_FOUND", "Unknown WebSocket endpoint.");
      const filter = filterFrom(url);
      release = reserveStream(principal.id);
      socket.once("close", release);
      wss.handleUpgrade(request, socket, head, (ws) => {
        audit.record({ requestId, principal: principalId, ip: request.socket.remoteAddress ?? "", action: "WS /v1/ws/logs", outcome: "completed", durationMs: 0 });
        socket.off("error", onError);
        wsPong.set(ws, true);
        const send = (data: unknown) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (ws.bufferedAmount > 256 * 1024) { metrics.slowConsumers++; ws.terminate(); return; }
          ws.send(JSON.stringify(data));
        };
        const onPrint = (line: ConsoleLine) => { if (matchesLog(line, filter)) send(printEvent(line)); };
        ws.on("error", () => ws.terminate());
        ws.on("pong", () => wsPong.set(ws, true));
        // The stream is deliberately read-only. Commands use the audited POST.
        ws.on("message", () => ws.close(1008, "Use POST /v1/commands to execute commands."));
        const expiry = setTimeout(() => ws.terminate(), 300000);
        ws.on("close", () => { clearTimeout(expiry); client.off("print", onPrint); wsPong.delete(ws); release?.(); });
        send({ type: "vconsole.status", ...client.status() });
        for (const line of client.logs(filter)) onPrint(line);
        client.on("print", onPrint);
      });
    } catch (err) {
      release?.();
      const failure = apiError(err);
      socket.end(`HTTP/1.1 ${failure.status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n${failure.status === 429 ? "Retry-After: 1\r\n" : ""}\r\n`);
      audit.record({ requestId, principal: principalId, ip: request.socket.remoteAddress ?? "", action: "WS /v1/ws/logs", outcome: failure.code, durationMs: 0 });
    }
  });
  const heartbeat = setInterval(() => {
    for (const [ws, alive] of wsPong) {
      if (!alive) ws.terminate();
      else { wsPong.set(ws, false); ws.ping(); }
    }
  }, 30000);
  heartbeat.unref();

  return {
    server, client, audit,
    async listen(): Promise<number> {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.bind, () => { server.off("error", reject); resolve(); });
      });
      client.startReconnecting();
      const port = (server.address() as import("node:net").AddressInfo).port;
      if (config.discovery.enabled) {
        const { advertise } = await import("./discovery.js");
        stopDiscovery = advertise(config.discovery.name, port);
      }
      return port;
    },
    async close(): Promise<void> {
      clearInterval(heartbeat);
      await stopDiscovery?.();
      client.disconnect();
      for (const response of sse) response.destroy();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
      await audit.flush();
    },
  };
}

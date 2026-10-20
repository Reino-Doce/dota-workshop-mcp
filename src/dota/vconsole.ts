import net from "node:net";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { AuditLog } from "../util/command-audit.js";
import {
  PROTOCOLS, Protocol, ProtocolSelection, VConsoleDecoder, VConsoleError,
  decodePrint, decodeChannels, encodeCommand, protocolSelection, validateCommand, markerCommand, matchesMarker,
} from "./vconsole-protocol.js";

export { VConsoleError } from "./vconsole-protocol.js";

export interface ConsoleLine { channel: number; channelName?: string; text: string; at: number; eventId: number; }
export interface LogFilter { limit?: number; channel?: number; pattern?: string; after?: number; }

export function matchesLog(line: ConsoleLine, filter: LogFilter): boolean {
  return (filter.channel === undefined || line.channel === filter.channel)
    && (filter.after === undefined || line.eventId > filter.after)
    && (!filter.pattern || line.text.toLowerCase().includes(filter.pattern.toLowerCase()));
}

export class VConsoleClient extends EventEmitter {
  private socket?: net.Socket;
  private decoder = new VConsoleDecoder();
  private connecting?: Promise<void>;
  private ready = false;
  private wire?: Protocol;
  private ring: ConsoleLine[] = [];
  private ringBytes = 0;
  private eventId = 0;
  private channels = new Map<number, string>();
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private generation = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectEnabled = false;
  private reconnectDelay = 500;
  private lastError?: { code: string; message: string };
  readonly metrics = { connections: 0, reconnects: 0, commands: 0, timeouts: 0, protocolErrors: 0, bytesReceived: 0, prints: 0 };
  readonly audit = new AuditLog();

  constructor(
    public readonly host = "127.0.0.1",
    public readonly port = 29000,
    public readonly protocol: ProtocolSelection = protocolSelection(),
    private readonly channelEndian: "auto" | "le" | "be" = "auto",
    private readonly beforeConnect?: () => Promise<void>,
  ) {
    super();
    if (!["127.0.0.1", "::1"].includes(host)) throw new Error("VConsole connects only to loopback. Use the HTTPS gateway for LAN access.");
    if (!validPort(port)) throw new Error("Invalid VConsole port.");
    this.setMaxListeners(200);
  }

  isConnected(): boolean { return this.ready; }

  status() {
    return {
      connected: this.ready, tcpConnected: !!this.socket && !this.socket.destroyed,
      host: this.host, port: this.port, protocol: this.protocol,
      wireVersion: this.wire ? `0x${PROTOCOLS[this.wire].toString(16).padStart(8, "0")}` : null,
      channelEndian: this.channelEndian === "auto" ? "be" : this.channelEndian,
      channels: Array.from(this.channels, ([id, name]) => ({ id, name })), queuedCommands: this.pending,
      bufferedLines: this.ring.length, bufferedBytes: this.ringBytes,
      firstEventId: this.ring[0]?.eventId ?? null, lastEventId: this.eventId,
      reconnecting: this.reconnectEnabled && !this.ready,
      lastError: this.lastError ?? null, metrics: { ...this.metrics },
    };
  }

  /** Readiness requires a marker round trip, not just an open TCP port. */
  connect(timeoutMs = 8000): Promise<void> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return Promise.reject(new VConsoleError("INVALID_REQUEST", "Connection timeout must be 1..120000 ms."));
    if (this.ready) return Promise.resolve();
    if (this.connecting) {
      const shared = this.connecting;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new VConsoleError("VCONSOLE_UNAVAILABLE", "Timed out waiting for the shared connection attempt.", true)), timeoutMs);
        shared.then(resolve, reject).finally(() => clearTimeout(timer));
      });
    }
    const attempt = this.open(timeoutMs, this.generation);
    this.connecting = attempt;
    void attempt.finally(() => {
      if (this.connecting === attempt) this.connecting = undefined;
    }).catch(() => {});
    return attempt;
  }

  private async open(timeoutMs: number, generation: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let preflightTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (this.beforeConnect) await Promise.race([
        this.beforeConnect(),
        new Promise<never>((_, reject) => {
          preflightTimer = setTimeout(() => reject(new VConsoleError("VCONSOLE_UNAVAILABLE", "Dota process identification exceeded the connection deadline.", true)), timeoutMs);
        }),
      ]);
    }
    catch (err) {
      const failure = new VConsoleError("VCONSOLE_UNAVAILABLE", asError(err).message, true);
      if (generation === this.generation) this.fail(failure);
      throw failure;
    }
    finally { clearTimeout(preflightTimer); }
    if (generation !== this.generation) throw new VConsoleError("VCONSOLE_UNAVAILABLE", "Connection cancelled.", true);
    if (Date.now() >= deadline) throw new VConsoleError("VCONSOLE_UNAVAILABLE", "Connection deadline expired.", true);
    const socket = new net.Socket();
    this.socket = socket;
    this.decoder.reset();
    this.wire = undefined;
    this.channels.clear();
    let failure: Error | undefined;
    const abort = (error: Error) => {
      if (this.socket !== socket) return;
      if (!failure) {
        failure = error;
        this.fail(error);
      }
      socket.destroy();
    };
    socket.on("data", (data: Buffer) => {
      if (this.socket !== socket) return;
      this.metrics.bytesReceived += data.length;
      try {
        for (const frame of this.decoder.push(data)) {
          if (!frame.protocol) continue;
          if (this.wire && this.wire !== frame.protocol) throw new VConsoleError("VCONSOLE_PROTOCOL_ERROR", "VConsole version changed within a session.");
          if (this.protocol !== "auto" && frame.protocol !== this.protocol) {
            throw new VConsoleError("VCONSOLE_PROTOCOL_ERROR", `Configured ${this.protocol}, received ${frame.protocol}. Use auto or the matching profile.`);
          }
          this.wire = frame.protocol;
          this.emit("protocol");
          for (const channel of decodeChannels(frame)) this.channels.set(channel.id, channel.name);
          const printed = decodePrint(frame, this.channelEndian === "auto" ? undefined : this.channelEndian);
          if (!printed || !printed.text) continue;
          const line: ConsoleLine = { ...printed, channelName: this.channels.get(printed.channel), at: Date.now(), eventId: ++this.eventId };
          if (/Message Version Mismatch/i.test(line.text) && this.ready) {
            throw new VConsoleError("VCONSOLE_PROTOCOL_ERROR", "Dota rejected the VConsole message version.");
          }
          this.ring.push(line);
          this.ringBytes += Buffer.byteLength(line.text);
          while (this.ring.length > 4000 || this.ringBytes > 4 * 1024 * 1024) {
            this.ringBytes -= Buffer.byteLength(this.ring.shift()!.text);
          }
          this.metrics.prints++;
          this.emit("print", line);
        }
      } catch (err) { abort(asError(err)); }
    });
    socket.on("error", abort);
    socket.on("close", () => {
      if (this.socket !== socket) return;
      try { this.decoder.end(); } catch (err) { this.fail(asError(err)); }
      this.socket = undefined;
      this.ready = false;
      this.decoder.reset();
      this.emit("disconnected");
      this.scheduleReconnect();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new VConsoleError("VCONSOLE_UNAVAILABLE", "VConsole connect timed out.", true)), Math.max(1, deadline - Date.now()));
        const onClose = () => finish(new VConsoleError("VCONSOLE_UNAVAILABLE", "VConsole connection closed.", true));
        const onError = (err: Error) => finish(err);
        const onConnect = () => finish();
        const finish = (err?: Error) => {
          clearTimeout(timer);
          socket.off("error", onError).off("connect", onConnect).off("close", onClose);
          err ? reject(err) : resolve();
        };
        socket.once("error", onError).once("connect", onConnect).once("close", onClose);
        socket.connect(this.port, this.host);
      });
      socket.setNoDelay(true);
      // AINF normally announces the wire version before any command. Give that
      // passive handshake a short bounded opportunity before legacy fallback.
      if (!this.wire && this.protocol === "auto") await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          this.off("protocol", finish).off("disconnected", finish).off("failure", finish);
          resolve();
        };
        const timer = setTimeout(finish, Math.max(1, Math.min(100, deadline - Date.now())));
        this.once("protocol", finish).once("disconnected", finish).once("failure", finish);
      });
      // Only harmless probes are retried. A user's command is NEVER replayed.
      const candidates: Protocol[] = this.protocol === "auto" ? ["d2", "d3", "d4"] : [this.protocol];
      for (let i = 0; i < candidates.length; i++) {
        if (socket.destroyed || generation !== this.generation) throw failure ?? new VConsoleError("VCONSOLE_UNAVAILABLE", "Connection cancelled.", true);
        const candidate = this.wire ?? candidates[i];
        const marker = `__MCP_PROBE_${randomUUID()}__`;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const hit = this.waitForLine((line) => matchesMarker(line.text, marker), Math.max(1, Math.floor(remaining / (candidates.length - i))));
        socket.write(encodeCommand(markerCommand(marker, candidate), candidate));
        if (await hit) {
          if (socket.destroyed || generation !== this.generation) throw new VConsoleError("VCONSOLE_UNAVAILABLE", "Connection cancelled.", true);
          this.wire = candidate;
          this.ready = true;
          this.lastError = undefined;
          this.metrics.connections++;
          this.reconnectDelay = 500;
          this.emit("connected");
          return;
        }
      }
      throw failure ?? new VConsoleError("VCONSOLE_UNAVAILABLE", "TCP connected but Dota did not answer a VConsole probe. Check the port/protocol, start a map and close other VConsole clients: the tested 2017 build serves one connection at a time, and its Asset Browser alone does not dispatch console commands.", true);
    } catch (err) {
      abort(asError(err));
      throw err instanceof VConsoleError ? err : new VConsoleError("VCONSOLE_UNAVAILABLE", asError(err).message, true);
    }
  }

  private fail(error: Error): void {
    const code = error instanceof VConsoleError ? error.code : "VCONSOLE_UNAVAILABLE";
    this.lastError = { code, message: error.message };
    if (code === "VCONSOLE_PROTOCOL_ERROR") this.metrics.protocolErrors++;
    this.ready = false;
    this.emit("failure", error);
  }

  async connectWithRetry(deadlineMs = 30000, intervalMs = 500): Promise<void> {
    const end = Date.now() + deadlineMs;
    let last: unknown;
    while (Date.now() < end) {
      try { await this.connect(Math.min(4000, end - Date.now())); return; }
      catch (err) { last = err; }
      const remaining = end - Date.now();
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }
    throw last ?? new VConsoleError("VCONSOLE_UNAVAILABLE", "Connect deadline expired.", true);
  }

  startReconnecting(): void {
    this.reconnectEnabled = true;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || this.ready || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.metrics.reconnects++;
      void this.connect(3000).catch(() => {}).finally(() => {
        this.reconnectDelay = Math.min(10000, this.reconnectDelay * 2);
        this.scheduleReconnect();
      });
    }, this.reconnectDelay * (0.8 + Math.random() * 0.4));
    this.reconnectTimer.unref();
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.generation++;
    this.ready = false;
    this.socket?.destroy();
    this.socket = undefined;
    this.connecting = undefined;
    this.decoder.reset();
    this.emit("disconnected");
  }

  async send(command: string): Promise<void> {
    await this.sendAndCapture(command);
  }

  /** Serialize both command dispatch and its possibly asynchronous response. */
  async sendAndWait(command: string, test: (line: ConsoleLine) => boolean, waitMs = 10000): Promise<ConsoleLine> {
    const lines = await this.sendAndCapture(command, undefined, waitMs, { until: test });
    return lines.find(test)!;
  }

  private writeCommand(command: string): void {
    if (!this.ready || !this.socket || !this.wire) throw new VConsoleError("VCONSOLE_UNAVAILABLE", "VConsole is not ready.", true);
    const frame = encodeCommand(command, this.wire);
    if (this.socket.writableLength > 65536) throw new VConsoleError("RATE_LIMITED", "VConsole write queue is full.", true);
    this.socket.write(frame);
  }

  recent(limit = 200): ConsoleLine[] { return this.logs({ limit }); }
  logs(filter: LogFilter = {}): ConsoleLine[] {
    const limit = Math.max(0, Math.min(4000, filter.limit ?? 200));
    return limit ? this.ring.filter((line) => matchesLog(line, filter)).slice(-limit) : [];
  }
  clearRing(): void { this.ring.length = 0; this.ringBytes = 0; }

  /** All capture callers share one queue; its deadline includes time queued. */
  async sendAndCapture(command: string, _sentinel?: string, waitMs = 2000, limits: { maxLines?: number; maxBytes?: number; until?: (line: ConsoleLine) => boolean } = {}): Promise<ConsoleLine[]> {
    validateCommand(command);
    if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 120000) throw new VConsoleError("INVALID_REQUEST", "Command timeout must be 1..120000 ms.");
    const maxLines = limits.maxLines ?? 5000;
    const maxBytes = limits.maxBytes ?? 2 * 1024 * 1024;
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 50000 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) {
      throw new VConsoleError("INVALID_REQUEST", "Invalid capture limits (at most 50000 lines and 8 MiB).");
    }
    if (this.pending >= 64) throw new VConsoleError("RATE_LIMITED", "VConsole command queue is full.", true);
    const deadline = Date.now() + waitMs;
    const generation = this.generation;
    const started = Date.now();
    const requestId = randomUUID();
    let expired = false;
    this.pending++;
    const operation = this.tail.then(async () => {
      if (expired || Date.now() >= deadline) throw new VConsoleError("COMMAND_TIMEOUT", "Command expired before dispatch.", true);
      if (generation !== this.generation) throw new VConsoleError("VCONSOLE_UNAVAILABLE", "Session changed before dispatch.", true);
      return this.capture(command, deadline - Date.now(), maxLines, maxBytes, limits.until);
    }).finally(() => { this.pending--; });
    this.tail = operation.catch(() => {});
    let timer: ReturnType<typeof setTimeout>;
    const deadlinePromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(new VConsoleError("COMMAND_TIMEOUT", "Command deadline expired. Execution may have occurred; it was not retried.", true));
      }, waitMs);
    });
    try {
      const lines = await Promise.race([operation, deadlinePromise]);
      this.audit.record({ requestId, principal: "local", ip: this.host, action: "capture", outcome: "completed", durationMs: Date.now() - started }, command);
      return lines;
    } catch (error) {
      const outcome = error instanceof VConsoleError ? error.code : "INTERNAL_ERROR";
      if (outcome === "COMMAND_TIMEOUT") this.metrics.timeouts++;
      this.audit.record({ requestId, principal: "local", ip: this.host, action: "capture", outcome, durationMs: Date.now() - started }, command);
      throw error;
    }
    finally { clearTimeout(timer!); }
  }

  private capture(command: string, waitMs: number, maxLines: number, maxBytes: number, until?: (line: ConsoleLine) => boolean): Promise<ConsoleLine[]> {
    const marker = `__MCP_END_${randomUUID()}__`;
    const lines: ConsoleLine[] = [];
    let bytes = 0;
    let markerSeen = false;
    let matched = false;
    return new Promise((resolve, reject) => {
      const finish = (err?: Error) => {
        clearTimeout(timer);
        this.off("print", onPrint).off("failure", onFailure).off("disconnected", onClose);
        err ? reject(err) : resolve(lines);
      };
      const onFailure = (err: Error) => finish(err);
      const onClose = () => finish(new VConsoleError("VCONSOLE_UNAVAILABLE", "Connection closed during command. Execution may have occurred.", true));
      const onPrint = (line: ConsoleLine) => {
        if (matchesMarker(line.text, marker)) {
          markerSeen = true;
          if (!until || matched) finish();
          return;
        }
        bytes += Buffer.byteLength(line.text);
        if (lines.length >= maxLines || bytes > maxBytes) {
          finish(new VConsoleError("RESPONSE_LIMIT", "Command output exceeded the capture limit."));
          this.socket?.destroy();
          return;
        }
        lines.push(line);
        if (until?.(line)) matched = true;
        if (matched && markerSeen) finish();
      };
      const timer = setTimeout(() => {
        finish(new VConsoleError("COMMAND_TIMEOUT", "Sentinel did not arrive. Execution may have occurred; command was not retried.", true));
        this.socket?.destroy();
      }, waitMs);
      this.on("print", onPrint).on("failure", onFailure).on("disconnected", onClose);
      try {
        this.writeCommand(command);
        this.metrics.commands++;
        this.writeCommand(markerCommand(marker, this.wire!));
      } catch (err) { finish(asError(err)); }
    });
  }

  async waitForLine(test: (line: ConsoleLine) => boolean, timeoutMs = 10000, scanRecent = false): Promise<ConsoleLine | undefined> {
    if (scanRecent) {
      const hit = [...this.ring].reverse().find(test);
      if (hit) return hit;
    }
    return new Promise((resolve) => {
      const finish = (line?: ConsoleLine) => {
        clearTimeout(timer);
        this.off("print", onPrint).off("disconnected", onClose).off("failure", onClose);
        resolve(line);
      };
      const onPrint = (line: ConsoleLine) => { if (test(line)) finish(line); };
      const onClose = () => finish();
      const timer = setTimeout(finish, timeoutMs);
      this.on("print", onPrint).on("disconnected", onClose).on("failure", onClose);
    });
  }
}

function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
function validPort(value: number): boolean { return Number.isInteger(value) && value >= 1 && value <= 65535; }
const clients = new Map<string, VConsoleClient>();

/** Production clients share process identity checks; tests can inject a TCP peer. */
export function createLocalVConsole(port: number, protocol: ProtocolSelection = protocolSelection(), endian: "auto" | "le" | "be" = "auto"): VConsoleClient {
  return new VConsoleClient("127.0.0.1", port, protocol, endian, async () => {
    if (process.platform === "win32") {
      const { findDotaProcess } = await import("./target.js");
      const target = await findDotaProcess(port);
      if (!target) throw new VConsoleError("VCONSOLE_UNAVAILABLE", "The selected Dota installation is not running.", true);
    }
  });
}

export function getVConsole(port = defaultVconPort()): VConsoleClient {
  if (!validPort(port)) throw new Error("Invalid VConsole port.");
  const protocol = protocolSelection();
  const endian = process.env.DOTA2_VCON_CHANNEL_ENDIAN ?? "auto";
  if (endian !== "le" && endian !== "be" && endian !== "auto") throw new Error("DOTA2_VCON_CHANNEL_ENDIAN must be auto, le or be.");
  const key = `${port}:${protocol}:${endian}`;
  let client = clients.get(key);
  if (!client) {
    if (clients.size >= 16) throw new VConsoleError("RATE_LIMITED", "Too many VConsole endpoints.");
    client = createLocalVConsole(port, protocol, endian);
    clients.set(key, client);
  }
  return client;
}

export function closeVConsoles(): void {
  for (const client of clients.values()) client.disconnect();
  clients.clear();
}

export function defaultVconPort(): number {
  const value = process.env.DOTA2_VCONPORT;
  if (value === undefined) return 29000;
  const port = Number(value);
  if (!validPort(port)) throw new Error("DOTA2_VCONPORT must be an integer from 1 to 65535.");
  return port;
}

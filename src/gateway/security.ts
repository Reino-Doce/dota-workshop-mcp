import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { TLSSocket } from "node:tls";
import { GatewayConfig, Principal } from "./config.js";
import { VConsoleError, validateCommand } from "../dota/vconsole-protocol.js";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryable = false) {
    super(message);
  }
}

export function authenticate(request: IncomingMessage, config: GatewayConfig): Principal {
  const socket = request.socket;
  if (!(socket instanceof TLSSocket)) throw new ApiError(401, "UNAUTHENTICATED", "TLS is required.");
  if (config.tls.requireClientCertificate && !socket.authorized) throw new ApiError(401, "UNAUTHENTICATED", "A valid client certificate is required.");
  const fingerprint = socket.authorized ? socket.getPeerCertificate().fingerprint256?.toLowerCase() : undefined;
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const digest = token ? createHash("sha256").update(token).digest() : undefined;
  const match = config.principals.find((p) => {
    if (p.fingerprint256 && p.fingerprint256.toLowerCase() !== fingerprint) return false;
    if (p.tokenSha256 && (!digest || !timingSafeEqual(digest, Buffer.from(p.tokenSha256, "hex")))) return false;
    return true;
  });
  if (!match) throw new ApiError(401, "UNAUTHENTICATED", "Missing or invalid credentials.");
  return match;
}

const roles = { viewer: 0, operator: 1, admin: 2 };
export function authorize(principal: Principal, required: keyof typeof roles): void {
  if (roles[principal.role] < roles[required]) throw new ApiError(403, "FORBIDDEN", `The ${required} role is required.`);
}

export function commandPolicy(command: string, config: GatewayConfig["policy"]): string {
  validateCommand(command);
  // Console separators can execute a second command even inside seemingly safe
  // input. LAN callers must submit exactly one command; no alias/exec bypasses.
  if (/[;\\]/.test(command)) throw new ApiError(422, "COMMAND_DENIED", "Command separators and escape sequences are not allowed.");
  const name = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\s|$)/.exec(command.trim())?.[1].toLowerCase();
  if (!name || !config.allowCommands.map((n) => n.toLowerCase()).includes(name)) {
    throw new ApiError(422, "COMMAND_DENIED", "Command is not on the gateway allow list.");
  }
  if (!config.allowDangerous && /^(quit|exit|exec|execifexists|alias|bind|bindtoggle|rcon|connect|disconnect|script|script_execute|mcp_eval)$/.test(name)) {
    throw new ApiError(422, "COMMAND_DENIED", "Indirect execution or process control requires an explicit dangerous-command policy.");
  }
  return `allow:${name}`;
}

/** One bounded bucket per configured principal/category. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  take(key: string, rate: number, burst: number, now = Date.now()): void {
    const bucket = this.buckets.get(key) ?? { tokens: burst, at: now };
    bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) * rate / 1000);
    bucket.at = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens < 1) throw new ApiError(429, "RATE_LIMITED", "Request quota exceeded.", true);
    bucket.tokens--;
  }
}

export function apiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof VConsoleError) {
    const statuses: Record<string, number> = { INVALID_REQUEST: 400, VCONSOLE_UNAVAILABLE: 409, VCONSOLE_PROTOCOL_ERROR: 502, COMMAND_TIMEOUT: 504, RATE_LIMITED: 429, RESPONSE_LIMIT: 502 };
    return new ApiError(statuses[error.code] ?? 500, error.code, error.message, error.retryable);
  }
  return new ApiError(500, "INTERNAL_ERROR", "The gateway could not complete the request.");
}

import { createHash } from "node:crypto";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEvent {
  requestId: string;
  principal: string;
  ip: string;
  action: string;
  outcome: string;
  durationMs: number;
  rule?: string;
  commandHash?: string;
  timestamp: string;
}

/** Metadata only: never persist console output, credentials or command arguments. */
export class AuditLog {
  private ring: AuditEvent[] = [];
  private writes: Promise<void> = Promise.resolve();
  private queued = 0;
  writeErrors = 0;
  constructor(private readonly file?: string) {}

  record(event: Omit<AuditEvent, "timestamp" | "commandHash">, command?: string): void {
    const entry: AuditEvent = {
      ...event, timestamp: new Date().toISOString(),
      ...(command ? { commandHash: createHash("sha256").update(command).digest("hex") } : {}),
    };
    this.ring.push(entry);
    if (this.ring.length > 2000) this.ring.shift();
    if (!this.file) return;
    if (this.queued >= 1000) { this.writeErrors++; return; }
    this.queued++;
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.file!), { recursive: true });
      const size = await stat(this.file!).then((s) => s.size).catch(() => 0);
      if (size >= 10 * 1024 * 1024) {
        await rm(`${this.file}.1`, { force: true });
        await rename(this.file!, `${this.file}.1`);
      }
      await appendFile(this.file!, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    }).catch(() => { this.writeErrors++; }).finally(() => { this.queued--; });
  }

  recent(limit = 200): AuditEvent[] { return this.ring.slice(-Math.max(1, Math.min(2000, limit))); }
  flush(): Promise<void> { return this.writes; }
}

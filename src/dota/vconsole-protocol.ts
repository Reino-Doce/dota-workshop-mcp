// VConsole is a framed TCP stream. Keep its codec independent of connections.
export const PROTOCOLS = { d2: 0x00d20000, d3: 0x00d30000, d4: 0x00d40000 } as const;
export type Protocol = keyof typeof PROTOCOLS;
export type ProtocolSelection = Protocol | "auto";

export class VConsoleError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) {
    super(message);
    this.name = "VConsoleError";
  }
}

export function protocolSelection(value = process.env.DOTA2_VCON_PROTOCOL ?? "auto"): ProtocolSelection {
  if (value === "auto" || value === "d2" || value === "d3" || value === "d4") return value;
  throw new VConsoleError("INVALID_REQUEST", "DOTA2_VCON_PROTOCOL must be auto, d2, d3 or d4.");
}

export function validateCommand(command: string): void {
  if (!command.trim() || Buffer.byteLength(command, "utf8") > 4096 || /[\0\r\n]/.test(command)) {
    throw new VConsoleError("INVALID_REQUEST", "Command must be a nonempty single line of at most 4096 UTF-8 bytes, without NUL.");
  }
  if (Buffer.from(command, "utf8").toString("utf8") !== command) {
    throw new VConsoleError("INVALID_REQUEST", "Command contains invalid Unicode.");
  }
}

export function encodeCommand(command: string, protocol: Protocol): Buffer {
  validateCommand(command);
  const payload = Buffer.from(`${command}\0`, "utf8");
  const frame = Buffer.alloc(12 + payload.length);
  frame.write("CMND", 0, "ascii");
  frame.writeUInt16BE(PROTOCOLS[protocol] >>> 16, 4);
  frame.writeUInt32BE(frame.length, 6);
  payload.copy(frame, 12);
  return frame;
}

/** The 2017 D3 engine has no echo command. Its unknown-command diagnostic is a
 * harmless ordered fence. Never use a command supplied by a caller as a fence. */
export function markerCommand(marker: string, protocol: Protocol): string {
  return protocol === "d3" ? marker : `echo ${marker}`;
}

export function matchesMarker(text: string, marker: string): boolean {
  return text.trim() === marker || text.trim() === `Unknown command: ${marker}`;
}

export interface VConsoleFrame {
  type: string;
  protocol?: Protocol;
  version: number;
  pipe: number;
  body: Buffer;
}

export class VConsoleDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  get pendingBytes(): number { return this.buffer.length; }
  reset(): void { this.buffer = Buffer.alloc(0); }

  push(data: Buffer): VConsoleFrame[] {
    if (this.buffer.length + data.length > 2 * 1024 * 1024) {
      throw new VConsoleError("VCONSOLE_PROTOCOL_ERROR", "VConsole receive buffer limit exceeded.");
    }
    this.buffer = Buffer.concat([this.buffer, data]);
    const frames: VConsoleFrame[] = [];
    let offset = 0;
    while (this.buffer.length - offset >= 12) {
      const type = this.buffer.toString("ascii", offset, offset + 4);
      // The legacy VConsole2 executable writes uint16 version + uint32 length.
      // For frames <64 KiB this looks like uint32 magic + uint16 length.
      const version = this.buffer.readUInt16BE(offset + 4);
      const magic = version << 16;
      const length = this.buffer.readUInt32BE(offset + 6);
      const interpreted = ["AINF", "PRNT", "CHAN", "CMND"].includes(type);
      const protocol = interpreted ? (Object.keys(PROTOCOLS) as Protocol[]).find((key) => PROTOCOLS[key] === magic) : undefined;
      // Versions belong to message types. CVRB and AUTO use schema version 2
      // in current builds; unknown payloads can be skipped using framing alone.
      if (!/^[A-Z0-9]{4}$/.test(type) || length < 12 || length > 1024 * 1024 || (interpreted && !protocol)) {
        throw new VConsoleError("VCONSOLE_PROTOCOL_ERROR", `Invalid VConsole header: type=${JSON.stringify(type)}, version=0x${magic.toString(16)}, length=${length}.`);
      }
      if (this.buffer.length - offset < length) break;
      frames.push({
        type, protocol, version, pipe: this.buffer.readUInt16BE(offset + 10),
        body: this.buffer.subarray(offset + 12, offset + length),
      });
      offset += length;
    }
    this.buffer = Buffer.from(this.buffer.subarray(offset));
    return frames;
  }

  end(): void {
    if (this.buffer.length) throw new VConsoleError("VCONSOLE_PROTOCOL_ERROR", "Connection ended in the middle of a VConsole frame.");
  }
}

export function decodePrint(frame: VConsoleFrame, channelEndian: "le" | "be" = "be"): { channel: number; text: string } | undefined {
  if (frame.type !== "PRNT") return undefined;
  if (frame.body.length < 29 || frame.body[frame.body.length - 1] !== 0) {
    throw new VConsoleError("VCONSOLE_PROTOCOL_ERROR", "Truncated or unterminated PRNT payload.");
  }
  const text = frame.body.subarray(28, -1).toString("utf8").replace(/\r?\n$/, "");
  return { channel: channelEndian === "be" ? frame.body.readUInt32BE(0) : frame.body.readUInt32LE(0), text };
}

export function decodeChannels(frame: VConsoleFrame): { id: number; name: string }[] {
  if (frame.type !== "CHAN") return [];
  if (frame.body.length < 2) throw new VConsoleError("VCONSOLE_PROTOCOL_ERROR", "Truncated CHAN count.");
  const count = frame.body.readUInt16BE(0);
  if (count > 4096 || frame.body.length < 2 + count * 58) throw new VConsoleError("VCONSOLE_PROTOCOL_ERROR", "Invalid CHAN table length.");
  return Array.from({ length: count }, (_, index) => {
    const offset = 2 + index * 58;
    const name = frame.body.subarray(offset + 24, offset + 56).toString("utf8").split("\0")[0];
    return { id: frame.body.readUInt32BE(offset), name };
  });
}

import net from "node:net";
import { once } from "node:events";
import type { Protocol } from "../../src/dota/vconsole-protocol.js";

// Independent wire encoder/receiver: intentionally does not reuse the codec.
export function frame(type: string, body: Buffer, version: Protocol = "d3"): Buffer {
  const result = Buffer.alloc(12 + body.length);
  result.write(type, 0);
  result.writeUInt16BE({ d2: 210, d3: 211, d4: 212 }[version], 4);
  result.writeUInt32BE(result.length, 6);
  body.copy(result, 12);
  return result;
}

export function print(text: string, version: Protocol = "d3", channel = 7): Buffer {
  const body = Buffer.alloc(28 + Buffer.byteLength(text) + 1);
  body.writeUInt32BE(channel, 0);
  body.write(text, 28);
  return frame("PRNT", body, version);
}

export async function fakeConsole(options: {
  protocol?: Protocol;
  onCommand?: (command: string, socket: net.Socket) => boolean | void;
  port?: number;
  initial?: Buffer;
} = {}) {
  const protocol = options.protocol ?? "d3";
  const sockets = new Set<net.Socket>();
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.write(options.initial ?? frame("AINF", Buffer.alloc(0), protocol));
    let pending = Buffer.alloc(0);
    socket.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= 12) {
        const length = pending.readUInt32BE(6);
        if (length < 12 || length > 8192) { socket.destroy(); return; }
        if (pending.length < length) return;
        const version = pending.readUInt16BE(4);
        const command = pending.subarray(12, length - 1).toString("utf8");
        pending = pending.subarray(length);
        if (version !== { d2: 210, d3: 211, d4: 212 }[protocol]) {
          socket.write(print("Message Version Mismatch", protocol));
          continue;
        }
        commands.push(command);
        if (options.onCommand?.(command, socket) === true) continue;
        socket.write(print(command.startsWith("echo ") ? command.slice(5) : command.startsWith("__MCP_") ? `Unknown command: ${command}` : `result:${command}`, protocol));
      }
    });
  });
  server.listen(options.port ?? 0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: (server.address() as net.AddressInfo).port, commands, sockets, server,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

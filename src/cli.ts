#!/usr/bin/env node
import https from "node:https";
import { readFile } from "node:fs/promises";

const endpoints: Record<string, string> = {
  health: "/v1/health", status: "/v1/vconsole/status", logs: "/v1/logs",
  follow: "/v1/logs/stream", audit: "/v1/audit", metrics: "/v1/metrics",
  reconnect: "/v1/vconsole/reconnect", exec: "/v1/commands",
};

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (!endpoints[action]) throw new Error("Usage: npm run vconsole -- health|status|logs|follow|audit|metrics|reconnect|exec [command]. Configure DOTA2_GATEWAY_URL, CA, CERT, KEY and/or TOKEN.");
  const url = new URL(endpoints[action], process.env.DOTA2_GATEWAY_URL ?? "https://localhost:8443");
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Gateway URL must use HTTPS without embedded credentials.");
  const load = (key: string) => process.env[key] ? readFile(process.env[key]!) : undefined;
  const [ca, cert, key] = await Promise.all([load("DOTA2_GATEWAY_CA"), load("DOTA2_GATEWAY_CERT"), load("DOTA2_GATEWAY_KEY")]);
  const body = action === "exec" ? JSON.stringify({ command: args.join(" ") }) : undefined;
  await new Promise<void>((resolve, reject) => {
    const request = https.request(url, {
      ca, cert, key, minVersion: "TLSv1.3", method: ["exec", "reconnect"].includes(action) ? "POST" : "GET",
      headers: {
        ...(process.env.DOTA2_GATEWAY_TOKEN ? { Authorization: `Bearer ${process.env.DOTA2_GATEWAY_TOKEN}` } : {}),
        ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
      },
    }, (response) => {
      if ((response.statusCode ?? 500) >= 400) process.exitCode = 1;
      response.pipe(process.stdout, { end: false });
      response.on("end", () => { process.stdout.write("\n"); resolve(); });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.setTimeout(35000, () => request.destroy(new Error("Gateway request timed out.")));
    request.end(body);
  });
}

main().catch((err) => { console.error(err instanceof Error ? err.message : "Gateway request failed."); process.exitCode = 1; });

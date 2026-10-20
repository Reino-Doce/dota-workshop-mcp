#!/usr/bin/env node
import { loadGatewayConfig } from "./config.js";
import { createGateway } from "./server.js";

async function main() {
  const file = process.argv[2] ?? process.env.DOTA2_GATEWAY_CONFIG;
  if (!file) throw new Error("Usage: npm run gateway -- <gateway.json>");
  const config = await loadGatewayConfig(file);
  const gateway = await createGateway(config);
  try {
    const port = await gateway.listen();
    console.error(`Dota VConsole gateway listening on https://${config.bind}:${port}`);
  } catch (err) {
    await gateway.close();
    throw err;
  }
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void gateway.close().catch(() => { process.exitCode = 1; });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : "Gateway startup failed."); process.exitCode = 1; });

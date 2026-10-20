import { Bonjour } from "bonjour-service";

/** Opt-in only; advertises the authenticated gateway, never the VConsole port. */
export function advertise(name: string, port: number): () => Promise<void> {
  const report = () => console.error("mDNS discovery is unavailable; HTTPS remains available.");
  const bonjour = new Bonjour({}, report);
  const service = bonjour.publish({ name, type: "dota-vconsole-mcp", protocol: "tcp", port, txt: { version: "1", tls: "required", api: "/v1" } });
  service.on("error", report);
  return () => new Promise<void>((resolve) => {
    bonjour.unpublishAll(() => bonjour.destroy(() => resolve()));
  });
}

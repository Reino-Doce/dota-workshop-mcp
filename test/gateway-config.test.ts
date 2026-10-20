import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewaySchema } from "../src/gateway/config.js";

const tokenSha256 = "ab".repeat(32);
const fingerprint256 = Array(32).fill("cd").join(":");
const tls = { key: "server.key", cert: "server.crt", requireClientCertificate: false };

test("certificate principals require a CA even when client certificates are optional", () => {
  for (const credentials of [{ fingerprint256 }, { fingerprint256, tokenSha256 }]) {
    const config = { tls, principals: [{ id: "user", role: "viewer", ...credentials }] };
    for (const ca of [undefined, ""]) {
      const result = gatewaySchema.safeParse({ ...config, tls: { ...tls, ca } });
      assert.equal(result.success, false);
      if (!result.success) assert.ok(result.error.issues.some((issue) => issue.path.join(".") === "tls.ca"));
    }
    assert.ok(gatewaySchema.safeParse({ ...config, tls: { ...tls, ca: "ca.crt" } }).success);
  }
  const bearer = { tls, principals: [{ id: "bearer", role: "viewer", tokenSha256 }] };
  assert.ok(gatewaySchema.safeParse(bearer).success, "bearer-only deployments do not require a CA");
  assert.equal(gatewaySchema.safeParse({ ...bearer, tls: { ...tls, requireClientCertificate: true } }).success, false);
});

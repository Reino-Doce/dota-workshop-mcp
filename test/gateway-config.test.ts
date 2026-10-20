import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewaySchema } from "../src/gateway/config.js";
import type { Principal } from "../src/gateway/config.js";

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

test("every accepted credential combination identifies at most one principal", () => {
  const otherToken = "ef".repeat(32);
  const otherFingerprint = Array(32).fill("ab").join(":");
  type Credentials = Pick<Principal, "tokenSha256" | "fingerprint256">;
  const parse = (credentials: Credentials[]) => gatewaySchema.safeParse({
    tls: { ...tls, ca: "ca.crt" },
    principals: credentials.map((entry, index) => ({
      id: `user-${index}`, role: index === 0 ? "viewer" : "admin", ...entry,
    })),
  });
  const ambiguous: Credentials[][] = [
    [{ tokenSha256 }, { tokenSha256: tokenSha256.toUpperCase() }],
    [{ fingerprint256 }, { fingerprint256: fingerprint256.toUpperCase() }],
    [{ tokenSha256 }, { tokenSha256, fingerprint256 }],
    [{ fingerprint256 }, { tokenSha256, fingerprint256 }],
    [{ tokenSha256, fingerprint256 }, { tokenSha256, fingerprint256 }],
    [{ tokenSha256 }, { fingerprint256 }],
  ];
  for (const pair of ambiguous) {
    for (const order of [pair, [...pair].reverse()]) {
      const result = parse(order);
      assert.equal(result.success, false, JSON.stringify(order));
      if (!result.success) assert.ok(result.error.issues.some((issue) => issue.message.includes("overlap")));
    }
  }
  const distinct: Credentials[][] = [
    [{ tokenSha256 }, { tokenSha256: otherToken }],
    [{ fingerprint256 }, { fingerprint256: otherFingerprint }],
    [{ tokenSha256, fingerprint256 }, { tokenSha256: otherToken, fingerprint256 }],
    [{ tokenSha256, fingerprint256 }, { tokenSha256, fingerprint256: otherFingerprint }],
    [{ tokenSha256 }, { tokenSha256: otherToken, fingerprint256 }],
    [{ fingerprint256 }, { tokenSha256, fingerprint256: otherFingerprint }],
  ];
  for (const pair of distinct) {
    assert.ok(parse(pair).success, JSON.stringify(pair));
    assert.ok(parse([...pair].reverse()).success);
  }
});

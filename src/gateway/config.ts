import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const principal = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(["viewer", "operator", "admin"]),
  fingerprint256: z.string().regex(/^(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2}$/).optional(),
  tokenSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
}).strict().refine((p) => p.fingerprint256 || p.tokenSha256, "A certificate fingerprint or token hash is required.");

export const gatewaySchema = z.object({
  bind: z.string().default("127.0.0.1"),
  port: z.number().int().min(0).max(65535).default(8443),
  vconPort: z.number().int().min(1).max(65535).default(29000),
  protocol: z.enum(["auto", "d2", "d3", "d4"]).default("auto"),
  channelEndian: z.enum(["auto", "le", "be"]).default("auto"),
  tls: z.object({
    key: z.string().min(1), cert: z.string().min(1), ca: z.string().min(1).optional(),
    requireClientCertificate: z.boolean().default(true),
  }).strict(),
  principals: z.array(principal).min(1).max(100),
  policy: z.object({
    allowCommands: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).default(["echo", "status", "version", "find", "help", "cvarlist"]),
    allowDangerous: z.boolean().default(false),
  }).strict().default({}),
  auditFile: z.string().optional(),
  discovery: z.object({ enabled: z.boolean().default(false), name: z.string().min(1).max(63).default("Dota Workshop") }).strict().default({}),
}).strict().superRefine((c, ctx) => {
  if ((c.tls.requireClientCertificate || c.principals.some((p) => p.fingerprint256)) && !c.tls.ca) {
    ctx.addIssue({ code: "custom", message: "Client certificate authentication requires tls.ca.", path: ["tls", "ca"] });
  }
  if (new Set(c.principals.map((p) => p.id)).size !== c.principals.length) {
    ctx.addIssue({ code: "custom", message: "Principal IDs must be unique.", path: ["principals"] });
  }
  for (let i = 0; i < c.principals.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = c.principals[i], b = c.principals[j];
      // A missing factor imposes no constraint, so both principals can match
      // one request unless a factor required by both has different values.
      const overlaps = (["tokenSha256", "fingerprint256"] as const).every((factor) =>
        !a[factor] || !b[factor] || a[factor].toLowerCase() === b[factor].toLowerCase(),
      );
      if (overlaps) {
        ctx.addIssue({
          code: "custom", message: `Credentials overlap with principal at index ${j}.`,
          path: ["principals", i],
        });
      }
    }
  }
});

export type GatewayConfig = z.infer<typeof gatewaySchema>;
export type Principal = GatewayConfig["principals"][number];

export async function loadGatewayConfig(file: string): Promise<GatewayConfig> {
  const config = gatewaySchema.parse(JSON.parse(await readFile(file, "utf8")));
  const base = dirname(resolve(file));
  for (const key of ["key", "cert", "ca"] as const) {
    if (config.tls[key]) config.tls[key] = resolve(base, config.tls[key]!);
  }
  if (config.auditFile) config.auditFile = resolve(base, config.auditFile);
  return config;
}

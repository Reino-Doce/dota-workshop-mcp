// Loader + search for the bundled Panorama JS API (from @moddota/panorama-types).

import { readFile } from "node:fs/promises";
import { ApiDatasetMetadata, ApiVersionSelection, currentApiMetadata, resolveApiFile, validateApiMetadata } from "./version.js";

export interface PanoramaMember {
  name: string;
  kind: "method" | "property";
  signature: string;
  description?: string;
  examples?: string[];
  inheritedFrom?: string;
  inheritanceSource?: string;
  source?: "engine-help" | "historical-reference";
  referenceSignatures?: string[];
}

export interface PanoramaInterface {
  name: string;
  description?: string;
  extends?: string[];
  members: PanoramaMember[];
  source?: "engine-help" | "historical-reference";
  engineName?: string;
  inheritanceSource?: string;
}

export interface PanoramaGlobal {
  name: string;
  type?: string;
  description?: string;
  declared?: boolean;
  source?: "engine-help" | "historical-reference";
}

export interface PanoramaEnum {
  name: string;
  source?: "engine-help" | "historical-reference";
  members: { name: string; value: number; description?: string }[];
}

export interface PanoramaData {
  interfaces: PanoramaInterface[];
  globals: PanoramaGlobal[];
  enums?: PanoramaEnum[];
  generatedAt?: string;
  metadata: ApiDatasetMetadata;
}

const cache = new Map<string, Promise<PanoramaData>>();

export async function loadPanorama(version?: ApiVersionSelection): Promise<PanoramaData> {
  const selected = await resolveApiFile("panorama", version);
  let data = cache.get(selected.file);
  if (!data) {
    data = readFile(selected.file, "utf8").then((text) => {
      const parsed = JSON.parse(text) as PanoramaData;
      if (!Array.isArray(parsed.interfaces) || !Array.isArray(parsed.globals)) throw new Error("Invalid Panorama API dataset.");
      parsed.metadata = validateApiMetadata(
        parsed.metadata ?? (selected.version === "current" ? currentApiMetadata("panorama", parsed.generatedAt) : undefined),
        selected.version, "panorama",
      );
      return parsed;
    });
    cache.set(selected.file, data);
    void data.catch(() => { cache.delete(selected.file); });
  }
  return data;
}

function score(needle: string, name: string, extra?: string): number {
  const n = needle.toLowerCase();
  const nm = name.toLowerCase();
  if (nm === n) return 100;
  if (nm.startsWith(n)) return 80;
  if (nm.includes(n)) return 60;
  if (extra && extra.toLowerCase().includes(n)) return 25;
  return 0;
}

function firstLine(s?: string): string | undefined {
  return s?.split("\n")[0]?.trim();
}

function baseTypeName(type?: string): string | undefined {
  if (!type) return undefined;
  // Strip generics / unions / whitespace: "CDOTA_PanoramaScript_GameEvents" etc.
  const m = type.match(/[A-Za-z_][A-Za-z0-9_]*/);
  return m ? m[0] : undefined;
}

export interface PanoramaHit {
  kind: "global" | "interface" | "member" | "enum";
  name: string;
  owner?: string;
  signature?: string;
  description?: string;
  score: number;
  source?: "engine-help" | "historical-reference";
}

export async function searchPanorama(query: string, limit = 25, version?: ApiVersionSelection): Promise<PanoramaHit[]> {
  const data = await loadPanorama(version);
  const hits: PanoramaHit[] = [];

  for (const g of data.globals) {
    const s = score(query, g.name, g.description);
    if (s > 0) hits.push({ kind: "global", name: g.name, signature: g.type, description: firstLine(g.description), score: s + 5, source: g.source });
  }
  // Dedupe member hits by owner+name so overloads (and re-found inherited members)
  // occupy one slot, keeping the highest score.
  const memberHits = new Map<string, PanoramaHit>();
  for (const i of data.interfaces) {
    const s = Math.max(score(query, i.name, i.description), i.engineName ? score(query, i.engineName) : 0);
    if (s > 0) hits.push({ kind: "interface", name: i.name, description: firstLine(i.description), score: s, source: i.source });
    for (const m of i.members) {
      const ms = score(query, m.name, m.signature + " " + (m.description ?? ""));
      if (ms <= 0) continue;
      const key = `${i.name}::${m.name}`;
      const existing = memberHits.get(key);
      if (existing) {
        if (ms > existing.score) existing.score = ms;
      } else {
        memberHits.set(key, { kind: "member", name: m.name, owner: i.name, signature: m.signature, description: firstLine(m.description), score: ms, source: m.source });
      }
    }
  }
  hits.push(...memberHits.values());
  for (const en of data.enums ?? []) {
    const s = Math.max(score(query, en.name), ...en.members.map((m) => score(query, m.name)));
    if (s > 0) hits.push({ kind: "enum", name: en.name, score: s, source: en.source });
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}

export async function getPanoramaInterface(name: string, version?: ApiVersionSelection): Promise<PanoramaInterface | undefined> {
  const data = await loadPanorama(version);
  const lower = name.toLowerCase();
  return data.interfaces.find((i) => i.name.toLowerCase() === lower || i.engineName?.toLowerCase() === lower);
}

/** Resolve any name: a global (-> its interface), an interface, or Owner.member / Owner:member. */
export async function getPanorama(name: string, version?: ApiVersionSelection): Promise<
  | { kind: "global"; global: PanoramaGlobal; iface?: PanoramaInterface }
  | { kind: "interface"; iface: PanoramaInterface }
  | { kind: "member"; owner: string; member: PanoramaMember }
  | { kind: "enum"; enum: PanoramaEnum }
  | { kind: "enum-member"; owner: string; member: PanoramaEnum["members"][number] }
  | undefined
> {
  const data = await loadPanorama(version);

  // Split on the LAST separator so 'Owner.member' resolves correctly even if a prefix has dots.
  const memberMatch = name.match(/^(.+)[.:]([^.:]+)$/);
  if (memberMatch) {
    const ownerName = memberMatch[1];
    const memberName = memberMatch[2];
    const en = data.enums?.find((e) => e.name.toLowerCase() === ownerName.toLowerCase());
    if (en) {
      const member = en.members.find((m) => m.name.toLowerCase() === memberName.toLowerCase());
      return member ? { kind: "enum-member", owner: en.name, member } : undefined;
    }
    const global = data.globals.find((g) => g.name.toLowerCase() === ownerName.toLowerCase());
    const ifaceName = global ? baseTypeName(global.type) : ownerName;
    const iface = data.interfaces.find((i) => i.name.toLowerCase() === (ifaceName ?? "").toLowerCase() ||
      i.engineName?.toLowerCase() === (ifaceName ?? "").toLowerCase());
    const member = iface?.members.find((m) => m.name.toLowerCase() === memberName.toLowerCase());
    if (iface && member) return { kind: "member", owner: iface.name, member };
    return undefined;
  }

  const en = data.enums?.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (en) return { kind: "enum", enum: en };

  const global = data.globals.find((g) => g.name.toLowerCase() === name.toLowerCase());
  if (global) {
    const ifaceName = baseTypeName(global.type);
    const iface = data.interfaces.find((i) => i.name.toLowerCase() === (ifaceName ?? "").toLowerCase());
    return { kind: "global", global, iface };
  }

  const iface = await getPanoramaInterface(name, data.metadata.version);
  if (iface) return { kind: "interface", iface };

  return undefined;
}

export async function panoramaStats(version?: ApiVersionSelection): Promise<{ interfaces: number; members: number; globals: number; enums: number; generatedAt?: string; metadata: ApiDatasetMetadata }> {
  const data = await loadPanorama(version);
  return {
    interfaces: data.interfaces.length,
    members: data.interfaces.reduce((n, i) => n + i.members.length, 0),
    globals: data.globals.length,
    enums: data.enums?.length ?? 0,
    generatedAt: data.generatedAt,
    metadata: data.metadata,
  };
}

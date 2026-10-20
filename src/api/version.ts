import { resolveDotaPaths } from "../dota/paths.js";
import { resolveDataPath } from "../util/datapath.js";

export type ApiVersion = "2017" | "current";
export type ApiVersionSelection = ApiVersion | "auto";
export type ApiLanguage = "vscript" | "panorama";

export interface ApiSource {
  name: string;
  url?: string;
  file?: string;
  commit?: string;
  lastChangedAt?: string;
  sha256?: string;
  command?: string;
}

export interface ApiBuildProvenance {
  schemaVersion: 1;
  gameTracking: {
    repository: string;
    commit: string;
    committedAt: string;
    commitMessage: string;
    steamInf: { file: "game/dota/steam.inf"; fields: Record<string, string> };
    builtFromCl: { file: "game/bin/built_from_cl.txt"; value: string };
    fileComparisons: {
      file: string;
      normalization: "crlf-to-lf";
      localSha256: string;
      referenceSha256: string;
    }[];
  };
  steamDepots: {
    source: "user-provided";
    verification: "not-verified-with-steam";
    manifests: { depotId: string; manifestId: string; timestampUtc: string }[];
  };
}

export interface ApiDatasetMetadata {
  version: ApiVersion;
  language: ApiLanguage;
  label: string;
  provenance: "engine-help" | "historical-reference" | "bundled-reference";
  build?: Record<string, string>;
  buildProvenance?: ApiBuildProvenance;
  executableSha256?: string;
  capturedAt?: string;
  sourceCommit?: string;
  sourceDate?: string;
  sources: ApiSource[];
  coverage: string[];
  limitations: string[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utcTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

/** Validate retained evidence offline, without querying Steam or the installation. */
export function validateBuildProvenance(value: unknown, capturedBuild: Record<string, string>): ApiBuildProvenance {
  const fail = (detail: string): never => { throw new Error(`Invalid build provenance: ${detail}.`); };
  if (!record(value) || value.schemaVersion !== 1 || !record(value.gameTracking) || !record(value.steamDepots)) {
    return fail("expected schema version 1 and GameTracking/depot evidence");
  }
  const tracking = value.gameTracking;
  if (tracking.repository !== "https://github.com/SteamTracking/GameTracking-Dota2" ||
      typeof tracking.commit !== "string" || !/^[a-f0-9]{40}$/.test(tracking.commit) ||
      !utcTimestamp(tracking.committedAt) || tracking.commitMessage !== capturedBuild.ClientVersion) {
    return fail("invalid GameTracking reference or commit build");
  }
  if (!record(tracking.steamInf) || tracking.steamInf.file !== "game/dota/steam.inf" ||
      !record(tracking.steamInf.fields)) {
    return fail("missing GameTracking steam.inf fields");
  }
  const fields = tracking.steamInf.fields;
  if (Object.keys(fields).length !== Object.keys(capturedBuild).length ||
      Object.entries(capturedBuild).some(([name, field]) => typeof field !== "string" || fields[name] !== field)) {
    return fail("captured build does not match GameTracking steam.inf");
  }
  if (!record(tracking.builtFromCl) || tracking.builtFromCl.file !== "game/bin/built_from_cl.txt" ||
      typeof tracking.builtFromCl.value !== "string" || !/^[1-9]\d*$/.test(tracking.builtFromCl.value)) {
    return fail("invalid built_from_cl reference");
  }
  if (!Array.isArray(tracking.fileComparisons) || tracking.fileComparisons.some((comparison) =>
    !record(comparison) || typeof comparison.file !== "string" || !comparison.file.startsWith("game/") ||
    comparison.normalization !== "crlf-to-lf" || typeof comparison.localSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(comparison.localSha256) || comparison.localSha256 !== comparison.referenceSha256)) {
    return fail("invalid recorded file comparison");
  }
  const depots = value.steamDepots;
  if (depots.source !== "user-provided" || depots.verification !== "not-verified-with-steam" ||
      !Array.isArray(depots.manifests) || !depots.manifests.length) {
    return fail("depot manifests must retain their user-provided, unverified provenance");
  }
  const seen = new Set<string>();
  for (const manifest of depots.manifests) {
    // Decimal strings preserve Steam identifiers beyond JavaScript's safe integer range.
    if (!record(manifest) || typeof manifest.depotId !== "string" ||
        !/^[1-9]\d{0,9}$/.test(manifest.depotId) || BigInt(manifest.depotId) > 4294967295n ||
        typeof manifest.manifestId !== "string" || !/^[1-9]\d{0,19}$/.test(manifest.manifestId) ||
        BigInt(manifest.manifestId) > 18446744073709551615n || !utcTimestamp(manifest.timestampUtc)) {
      return fail("depot and manifest IDs must be unsigned decimal strings with a UTC timestamp");
    }
    if (seen.has(manifest.depotId)) return fail(`duplicate depot ${manifest.depotId}`);
    seen.add(manifest.depotId);
  }
  return value as unknown as ApiBuildProvenance;
}

function selection(value: string): ApiVersionSelection {
  if (value !== "auto" && value !== "2017" && value !== "current") {
    throw new Error("API version must be auto, 2017 or current (DOTA2_API_VERSION or the version argument).");
  }
  return value;
}

/** API selection never changes the selected game installation or sends a game command. */
export async function resolveApiVersion(requested?: ApiVersionSelection): Promise<ApiVersion> {
  const selected = selection(requested ?? process.env.DOTA2_API_VERSION ?? "auto");
  if (selected !== "auto") return selected;
  const installation = await resolveDotaPaths();
  if (installation) {
    if (installation.versionFamily === "2017" || installation.versionFamily === "current") {
      return installation.versionFamily;
    }
    throw new Error(
      "The selected Dota build has no known API dataset. Set DOTA2_API_VERSION=2017 or current " +
      "to explicitly browse a reference; this does not confirm compatibility with that build.",
    );
  }
  // An explicit game-family preference must not become modern data just because
  // the installation is absent. API lookup also works on machines without Dota.
  if (process.env.DOTA2_VERSION === "2017") return "2017";
  return "current";
}

export async function resolveApiFile(language: ApiLanguage, requested?: ApiVersionSelection) {
  const version = await resolveApiVersion(requested);
  const name = language === "vscript" ? "dota-api.json" : "panorama-api.json";
  const file = await resolveDataPath(version === "current" ? name : `versions/2439/${name}`);
  return { version, file };
}

/** The original bundles did not retain a source revision. Do not invent one. */
export function currentApiMetadata(language: ApiLanguage, generatedAt?: string): ApiDatasetMetadata {
  return {
    version: "current",
    language,
    label: `Current Dota ${language === "vscript" ? "VScript" : "Panorama"} reference`,
    provenance: "bundled-reference",
    sourceDate: generatedAt,
    sources: language === "vscript"
      ? [{ name: "ModDota dota-data", url: "https://github.com/ModDota/dota-data/tree/master/files/vscripts" }]
      : [{ name: "ModDota panorama-types", url: "https://github.com/ModDota/TypeScriptDeclarations" }],
    coverage: language === "vscript" ? ["Bundled server and client VScript declarations and enums."] : ["Bundled Panorama declarations and inherited panel members."],
    limitations: [
      `Bundled reference${generatedAt ? ` generated ${generatedAt.slice(0, 10)}` : ""}; not a dump of the selected installed build.`,
      "The original bundle did not record its upstream commit or package version.",
    ],
  };
}

export function apiMetadataSummary(metadata: ApiDatasetMetadata): string {
  const build = metadata.build?.ClientVersion ? `; build ${metadata.build.ClientVersion}` : "";
  return `API dataset: ${metadata.version}${build} (${metadata.provenance}). ${metadata.limitations[0] ?? ""}`.trim();
}

export function validateApiMetadata(metadata: ApiDatasetMetadata | undefined, version: ApiVersion, language: ApiLanguage): ApiDatasetMetadata {
  if (!metadata || metadata.version !== version || metadata.language !== language ||
      !Array.isArray(metadata.sources) || !Array.isArray(metadata.coverage) || !Array.isArray(metadata.limitations)) {
    throw new Error(`Invalid or missing provenance for the ${version} ${language} API dataset.`);
  }
  if (metadata.buildProvenance) {
    if (!metadata.build) throw new Error(`Missing captured build for the ${version} ${language} provenance.`);
    validateBuildProvenance(metadata.buildProvenance, metadata.build);
  }
  return metadata;
}

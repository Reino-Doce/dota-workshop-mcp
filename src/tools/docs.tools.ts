import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchDocs, getDoc, listDocs, docCategories, searchTools, loadTools } from "../docs/docs.js";
import { searchPanorama, getPanorama, panoramaStats } from "../api/panorama.js";
import { ApiDatasetMetadata, apiMetadataSummary } from "../api/version.js";
import { resolveDataPath } from "../util/datapath.js";
import { readFile } from "node:fs/promises";
import { json, text, error, guard, ToolResult } from "../util/result.js";

const panoramaVersion = z.enum(["auto", "2017", "current"]).optional().describe(
  "API dataset only; auto follows the selected installation. Overrides DOTA2_API_VERSION without changing the game.",
);

function panoramaResult(metadata: ApiDatasetMetadata, data: Record<string, unknown>, summary: string): ToolResult {
  return json({ ...data, metadata }, `${summary}\n\n${apiMetadataSummary(metadata)}`);
}

function panoramaError(metadata: ApiDatasetMetadata, message: string): ToolResult {
  return { ...error(`${message}\n\n${apiMetadataSummary(metadata)}`), structuredContent: { metadata } };
}

export function registerDocsTools(server: McpServer) {
  server.registerTool(
    "dota_patterns",
    {
      title: "Custom-game design patterns",
      description:
        "Reusable Dota custom-game engineering patterns distilled from shipping games (tower-defense pathing & maze " +
        "validation, declarative waves, vscript HTTP backends, save codes, map anchors, per-unit AI, projectiles). " +
        "Filter by query or category (tower-defense, backend, mapping, architecture).",
      inputSchema: { query: z.string().optional(), category: z.string().optional() },
    },
    guard(async ({ query, category }): Promise<ToolResult> => {
      const data = JSON.parse(await readFile(await resolveDataPath("patterns.json"), "utf8"));
      let list = data.patterns as { name: string; category: string; summary: string; technique?: string; api?: string; source?: string }[];
      if (category) list = list.filter((p) => p.category.toLowerCase() === category.toLowerCase());
      if (query) {
        const q = query.toLowerCase();
        list = list.filter((p) => JSON.stringify(p).toLowerCase().includes(q));
      }
      if (!list.length) return error("No patterns match that filter.");
      const body = list
        .map((p) => `[${p.category}] ${p.name}\n  ${p.summary}\n  how: ${p.technique ?? "-"}${p.api ? `\n  api: ${p.api}` : ""}${p.source ? `\n  seen in: ${p.source}` : ""}`)
        .join("\n\n");
      return json({ count: list.length, patterns: list }, body);
    }),
  );

  // ---- ModDota guides -----------------------------------------------------
  server.registerTool(
    "docs_search",
    {
      title: "Search ModDota guides",
      description:
        "Search the bundled ModDota documentation (scripting, abilities, modifiers, units, panorama, assets, tools) " +
        "by keyword. Returns matching pages with snippets; read full text with docs_get.",
      inputSchema: {
        query: z.string(),
        category: z.string().optional().describe("Filter by category: abilities, scripting, units, panorama, assets, tools, general."),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    guard(async ({ query, category, limit }): Promise<ToolResult> => {
      const hits = await searchDocs(query, { category, limit });
      if (!hits.length) return error(`No docs match "${query}". Try docs_list to browse categories.`);
      const lines = hits.map((h) => `[${h.category}] ${h.id}  —  ${h.title}\n    ${h.snippet ?? ""}`);
      return json({ query, count: hits.length, results: hits }, lines.join("\n"));
    }),
  );

  server.registerTool(
    "docs_get",
    {
      title: "Read a ModDota guide",
      description: "Return the full markdown of a bundled ModDota guide by its id (from docs_search / docs_list).",
      inputSchema: { id: z.string().describe("Page id, e.g. 'abilities/ability-keyvalues' or 'getting-started'.") },
    },
    guard(async ({ id }): Promise<ToolResult> => {
      const doc = await getDoc(id);
      if (!doc) return error(`Doc "${id}" not found. Use docs_search or docs_list to find the id.`);
      const header = `# ${doc.meta.title}\n(category: ${doc.meta.category} · source: ${doc.meta.sourceUrl})\n\n`;
      // Put the (potentially large) body in the text channel only; keep structuredContent metadata-only
      // so the article isn't serialized twice.
      return json({ id: doc.meta.id, title: doc.meta.title, category: doc.meta.category, sourceUrl: doc.meta.sourceUrl }, header + doc.content);
    }),
  );

  server.registerTool(
    "docs_list",
    {
      title: "List ModDota guides",
      description: "List bundled doc categories (no args) or the pages within a category.",
      inputSchema: { category: z.string().optional().describe("Category to list pages for; omit to list categories.") },
    },
    guard(async ({ category }): Promise<ToolResult> => {
      if (!category) {
        const cats = await docCategories();
        const total = cats.reduce((n, c) => n + c.count, 0);
        return json({ categories: cats, total }, `Categories (${total} pages):\n` + cats.map((c) => `  ${c.category} (${c.count})`).join("\n"));
      }
      const pages = await listDocs(category);
      if (!pages.length) return error(`No pages in category "${category}".`);
      return json({ category, pages: pages.map((p) => ({ id: p.id, title: p.title })) }, pages.map((p) => `  ${p.id}  —  ${p.title}`).join("\n"));
    }),
  );

  // ---- Panorama JS API ----------------------------------------------------
  server.registerTool(
    "panorama_api_search",
    {
      title: "Search the Panorama JS API",
      description:
        "Search the Panorama (custom UI) JavaScript API — globals ($, GameEvents, Players, Game, CustomNetTables, …), " +
        "interfaces, methods/properties and captured enums. Results identify the version and source coverage.",
      inputSchema: { query: z.string(), limit: z.number().int().positive().max(100).optional(), version: panoramaVersion },
    },
    guard(async ({ query, limit, version }): Promise<ToolResult> => {
      const stats = await panoramaStats(version);
      const { metadata } = stats;
      const hits = await searchPanorama(query, limit, metadata.version);
      if (!hits.length) {
        return panoramaError(metadata, `No Panorama API matches for "${query}". (Indexed: ${stats.interfaces} interfaces, ${stats.globals} globals.)`);
      }
      const lines = hits.map((h) => {
        if (h.kind === "global") return `[global] ${h.name}: ${h.signature ?? "?"}`;
        if (h.kind === "member") return `[member] ${h.owner}.${h.name}  —  ${h.signature ?? ""}`;
        if (h.kind === "enum") return `[enum] ${h.name}`;
        return `[interface] ${h.name}${h.description ? "  —  " + h.description : ""}`;
      });
      return panoramaResult(metadata, { query, count: hits.length, results: hits }, lines.map((line, i) =>
        `${line}${hits[i].source ? ` [${hits[i].source}]` : ""}`,
      ).join("\n"));
    }),
  );

  server.registerTool(
    "panorama_api_get",
    {
      title: "Get Panorama API details",
      description:
        "Get full details for a Panorama global (e.g. '$', 'GameEvents', 'Players'), an interface, or a member " +
        "('GameEvents.Subscribe'). Globals resolve to their interface with all members.",
      inputSchema: { name: z.string().describe("e.g. '$', 'GameEvents', 'Players.GetLocalPlayer', 'CDOTA_PanoramaScript_GameEvents'."), version: panoramaVersion },
    },
    guard(async ({ name, version }): Promise<ToolResult> => {
      const { metadata } = await panoramaStats(version);
      const res = await getPanorama(name, metadata.version);
      if (!res) return panoramaError(metadata, `"${name}" not found in the Panorama API. Try panorama_api_search.`);

      if (res.kind === "enum") {
        return panoramaResult(metadata, { kind: "enum", enum: res.enum },
          `enum ${res.enum.name}\n${res.enum.members.map((m) => `  ${m.name} = ${m.value}`).join("\n")}`);
      }
      if (res.kind === "enum-member") {
        return panoramaResult(metadata, { kind: "enum-member", owner: res.owner, member: res.member },
          `${res.owner}.${res.member.name} = ${res.member.value}`);
      }

      if (res.kind === "member") {
        const m = res.member;
        const lines = [`${res.owner}.${m.name}`, m.signature];
        if (m.description) lines.push("", m.description);
        if (m.source) lines.push(`source: ${m.source}`);
        if (m.examples?.length) lines.push("", "examples:", ...m.examples.map((e) => "  " + e.replace(/\n/g, "\n  ")));
        return panoramaResult(metadata, { kind: "member", owner: res.owner, member: m }, lines.join("\n"));
      }
      const fmtMember = (m: { signature: string; inheritedFrom?: string; source?: string }) => `  ${m.signature}${m.inheritedFrom ? `   (from ${m.inheritedFrom})` : ""}${m.source ? ` [${m.source}]` : ""}`;
      if (res.kind === "interface") {
        const i = res.iface;
        const body = `interface ${i.name}${i.extends?.length ? " extends " + i.extends.join(", ") : ""}${i.description ? "\n" + i.description : ""}\n\nmembers (${i.members.length}):\n` + i.members.map(fmtMember).join("\n");
        return panoramaResult(metadata, { kind: "interface", interface: i }, body);
      }
      // global
      const g = res.global;
      const header = `${g.name}: ${g.type ?? "?"}${g.description ? "\n" + g.description : ""}`;
      const memberList = res.iface ? `\n\nmembers of ${res.iface.name} (${res.iface.members.length}):\n` + res.iface.members.map(fmtMember).join("\n") : "";
      return panoramaResult(metadata, { kind: "global", global: g, interface: res.iface }, header + memberList);
    }),
  );

  // ---- Tools catalog ------------------------------------------------------
  server.registerTool(
    "tools_catalog",
    {
      title: "Dota 2 modding tools catalog",
      description:
        "List the curated catalog of Dota 2 custom-game tools, libraries and references (official Valve tools, " +
        "ModDota libraries/templates, community tools). Filter by query or category.",
      inputSchema: {
        query: z.string().optional(),
        category: z.enum(["official", "library", "template", "community", "reference", "this"]).optional(),
      },
    },
    guard(async ({ query, category }): Promise<ToolResult> => {
      const tools = await searchTools(query, category);
      if (!tools.length) return error("No tools match that filter.");
      const lines = tools.map((t) => `[${t.category}] ${t.name}${t.package ? ` (${t.package})` : ""}\n    ${t.description}\n    ${t.url}`);
      return json({ count: tools.length, tools }, lines.join("\n\n"));
    }),
  );
}

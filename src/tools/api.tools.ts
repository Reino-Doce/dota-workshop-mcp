import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchApi, getClass, getFunction, getEnum, getMethod, apiStats } from "../api/search.js";
import { ApiDatasetMetadata, apiMetadataSummary } from "../api/version.js";
import { json, error, guard, ToolResult } from "../util/result.js";

const apiVersion = z.enum(["auto", "2017", "current"]).optional().describe(
  "API dataset only; auto follows the selected installation. Overrides DOTA2_API_VERSION without changing the game.",
);

function versionedResult(metadata: ApiDatasetMetadata, data: Record<string, unknown>, summary: string): ToolResult {
  return json({ ...data, metadata }, `${summary}\n\n${apiMetadataSummary(metadata)}`);
}

function versionedError(metadata: ApiDatasetMetadata, message: string): ToolResult {
  return { ...error(`${message}\n\n${apiMetadataSummary(metadata)}`), structuredContent: { metadata } };
}

export function registerApiTools(server: McpServer) {
  server.registerTool(
    "lua_api_search",
    {
      title: "Search the Dota VScript API",
      description:
        "Search the Dota 2 Lua (VScript) modding API by name or description across classes, global functions, " +
        "class methods, and enums/constants. Returns ranked matches with signatures.",
      inputSchema: {
        query: z.string().describe("Name fragment or keyword, e.g. 'CreateUnit', 'modifier', 'FindUnitsInRadius'."),
        kind: z.enum(["class", "function", "method", "enum", "all"]).optional(),
        available: z.enum(["server", "client"]).optional().describe("Filter functions/methods by availability."),
        limit: z.number().int().positive().max(100).optional(),
        version: apiVersion,
      },
    },
    guard(async ({ query, kind, available, limit, version }): Promise<ToolResult> => {
      const { metadata } = await apiStats(version);
      const hits = await searchApi(query, { kind, available, limit, version: metadata.version });
      if (hits.length === 0) {
        const stats = await apiStats(metadata.version);
        return versionedError(metadata,
          `No API matches for "${query}". (Indexed: ${stats.classes} classes, ${stats.functions} functions.)`,
        );
      }
      const lines = hits.map((h) => {
        const where = h.owner ? `${h.owner}:${h.name}` : h.name;
        return `[${h.kind}] ${h.signature ?? where}${h.description ? `  — ${h.description}` : ""}`;
      });
      return versionedResult(metadata, { query, count: hits.length, results: hits }, lines.join("\n"));
    }),
  );

  server.registerTool(
    "lua_api_get",
    {
      title: "Get API details",
      description:
        "Get full details for a class, global function, enum, or a class method. For a method use 'Class:Method' " +
        "or 'Class.Method'. For a class, methods are listed (optionally including inherited ones).",
      inputSchema: {
        name: z.string().describe("e.g. 'CDOTA_BaseNPC', 'CreateUnitByName', 'DOTA_UNIT_TARGET_TEAM', 'CDOTA_BaseNPC:AddAbility'."),
        includeInherited: z.boolean().optional().describe("For classes: include inherited methods (default false)."),
        version: apiVersion,
      },
    },
    guard(async ({ name, includeInherited, version }): Promise<ToolResult> => {
      const { metadata } = await apiStats(version);
      // Method form: Class:Method or Class.Method
      const methodMatch = name.match(/^(.+?)[.:](.+)$/);
      if (methodMatch) {
        const res = await getMethod(methodMatch[1], methodMatch[2], metadata.version);
        if (!res) return versionedError(metadata, `Method "${name}" not found.`);
        return versionedResult(metadata, { kind: "method", owner: res.owner, method: res.method }, formatFn(res.method, res.owner));
      }

      const fn = await getFunction(name, metadata.version);
      if (fn) return versionedResult(metadata, { kind: "function", function: fn }, formatFn(fn));

      const cls = await getClass(name, !!includeInherited, metadata.version);
      if (cls) {
        const header = `class ${cls.name}${cls.extends ? ` extends ${cls.extends}` : ""}${cls.clientName ? ` (client: ${cls.clientName})` : ""}`;
        const desc = cls.description ? `\n${cls.description}\n` : "\n";
        const methods = cls.methods.map((m) => `  ${m.signature}`).join("\n");
        return versionedResult(metadata,
          { kind: "class", class: cls },
          `${header}${desc}methods (${cls.methods.length}):\n${methods}`,
        );
      }

      const en = await getEnum(name, metadata.version);
      if (en) {
        const body =
          en.kind === "constant"
            ? `constant ${en.name} = ${en.value}`
            : `enum ${en.name}\n` + (en.members ?? []).map((m) => `  ${m.name} = ${m.value}${m.description ? `  // ${m.description}` : ""}`).join("\n");
        return versionedResult(metadata, { kind: en.kind, enum: en }, body);
      }

      return versionedError(metadata, `"${name}" not found in the VScript API. Try lua_api_search to discover the exact name.`);
    }),
  );

  server.registerTool(
    "lua_api_class_methods",
    {
      title: "List class methods",
      description: "List the methods of a VScript class, optionally including inherited methods and filtering by name fragment.",
      inputSchema: {
        className: z.string(),
        includeInherited: z.boolean().optional(),
        filter: z.string().optional().describe("Only methods whose name contains this fragment."),
        version: apiVersion,
      },
    },
    guard(async ({ className, includeInherited, filter, version }): Promise<ToolResult> => {
      const { metadata } = await apiStats(version);
      const cls = await getClass(className, includeInherited ?? true, metadata.version);
      if (!cls) return versionedError(metadata, `Class "${className}" not found.`);
      let methods = cls.methods;
      if (filter) methods = methods.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()));
      const inheritedFrom = (cls as any).inheritedFrom ?? {};
      const lines = methods.map((m) => `${m.signature}${inheritedFrom[m.name] ? `   (from ${inheritedFrom[m.name]})` : ""}`);
      return versionedResult(metadata,
        { class: cls.name, count: methods.length, methods },
        `${cls.name} — ${methods.length} methods:\n${lines.join("\n")}`,
      );
    }),
  );
}

function formatFn(m: { signature: string; description?: string; args: { name: string; type: string; description?: string }[]; available?: string }, owner?: string): string {
  const lines = [owner ? `${owner}:${m.signature}` : m.signature];
  if (m.available) lines.push(`available: ${m.available}`);
  if (m.description) lines.push("", m.description);
  if (m.args.length) {
    lines.push("", "params:");
    for (const a of m.args) lines.push(`  ${a.name}: ${a.type}${a.description ? ` — ${a.description}` : ""}`);
  }
  return lines.join("\n");
}

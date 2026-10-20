// Parsers for engine-authored help output. They parse text, never evaluate Lua/JS.
import type { ApiClass, ApiData, ApiEnum, ApiFunction } from "./loader.js";
import type { PanoramaData, PanoramaEnum, PanoramaInterface, PanoramaMember } from "./panorama.js";

type LuaBindings = Pick<ApiData, "classes" | "functions" | "enums">;
type PanoramaBindings = Pick<PanoramaData, "interfaces" | "globals" | "enums">;

/** Output of script_help2 / cl_script_help2, with one LF between PRNT messages. */
export function parseLuaHelp(text: string, available: "server" | "client"): LuaBindings {
  const classes = new Map<string, ApiClass>();
  const functions: ApiFunction[] = [];
  const enums: ApiEnum[] = [];
  const pattern = /^---\[\[\s*(\S+)\s{2}([\s\S]*?)\]\]\s*\r?\n-- @return ([^\r\n]+)\r?\n((?:-- @param [^\r\n]*\r?\n)*)function ([^\s(]+)\(\s*([^)]*)\)\s+end\s*$/gm;
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    if (match[1] !== match[5]) throw new Error(`Lua help name mismatch: ${match[1]}.`);
    const args = [...match[4].matchAll(/^-- @param (\S+) (.+)$/gm)].map((p) => ({ name: p[1], type: p[2].trim() }));
    const parameters = match[6].trim() ? match[6].split(",").map((p) => p.trim()) : [];
    if (parameters.length !== args.length || parameters.some((p, i) => p !== args[i].name)) {
      throw new Error(`Incomplete Lua parameter documentation: ${match[5]}.`);
    }
    const [owner, name] = match[5].includes(":") ? match[5].split(":") : [undefined, match[5]];
    const returns = match[3].trim();
    const fn: ApiFunction = {
      name, args, returns, available,
      signature: `${name}(${args.map((a) => `${a.name}: ${a.type}`).join(", ")}): ${returns}`,
      ...(match[2].trim() ? { description: match[2].trim() } : {}),
    };
    if (owner) {
      let cls = classes.get(owner);
      if (!cls) { cls = { name: owner, methods: [] }; classes.set(owner, cls); }
      cls.methods.push(fn);
    } else {
      functions.push(fn);
    }
    count++;
  }
  const declarations = [...text.matchAll(/^function /gm)].length;
  if (!count || count !== declarations || count !== [...text.matchAll(/^---\[\[/gm)].length) {
    throw new Error(`Incomplete Lua help: parsed ${count} of ${declarations} function declarations.`);
  }
  const sections = text.split(/^--- Enum ([^\r\n]+)\r?\n/gm);
  for (let i = 1; i < sections.length; i += 2) {
    const body = sections[i + 1].split(/^---\[\[/m)[0].trim();
    const members = body.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
      const value = line.match(/^([A-Za-z_][\w]*) = (-?\d+)(?: -- (.*))?$/);
      if (!value || !Number.isSafeInteger(Number(value[2]))) throw new Error(`Invalid enum entry in ${sections[i]}.`);
      return { name: value[1], value: Number(value[2]), ...(value[3] ? { description: value[3] } : {}) };
    });
    if (!members.length) throw new Error(`Empty enum in Lua help: ${sections[i]}.`);
    enums.push({ name: sections[i], kind: "enum", available, members });
  }
  return { classes: [...classes.values()], functions, enums };
}

function mergeFunctions(target: ApiFunction[], additional: ApiFunction[]): void {
  for (const fn of additional) {
    const match = target.find((other) => other.name === fn.name && other.signature === fn.signature);
    if (match) {
      if (match.available !== fn.available) match.available = "both";
    } else target.push({ ...fn });
  }
}

/** Preserve client-only classes and different server/client signatures. */
export function mergeLuaHelp(server: LuaBindings, client: LuaBindings): LuaBindings {
  const out: LuaBindings = structuredClone(server);
  mergeFunctions(out.functions, client.functions);
  for (const cls of client.classes) {
    const match = out.classes.find((other) => other.name === cls.name);
    if (match) mergeFunctions(match.methods, cls.methods);
    else out.classes.push(structuredClone(cls));
  }
  for (const en of client.enums) {
    const match = out.enums.find((other) => other.name === en.name &&
      JSON.stringify(other.members?.map((m) => [m.name, m.value])) === JSON.stringify(en.members?.map((m) => [m.name, m.value])));
    if (match) match.available = "both";
    else out.enums.push(structuredClone(en));
  }
  return out;
}

function decodeHtml(text: string): string {
  return text.replace(/<\/?code>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
}

/** MediaWiki tables printed by cl_panorama_script_help_2. */
export function parsePanoramaHelp(text: string): PanoramaBindings {
  const out: PanoramaBindings = { interfaces: [], globals: [], enums: [] };
  const sections = text.split(/^=== ([^\r\n]+) ===\r?\n/gm);
  if (sections.length < 3 || sections[0].trim()) throw new Error("Unrecognized Panorama help format.");
  for (let i = 1; i < sections.length; i += 2) {
    const name = sections[i];
    const body = sections[i + 1];
    if (!body.trimEnd().endsWith("|}")) throw new Error(`Incomplete Panorama help table: ${name}.`);
    const rows = body.split(/^\|-\s*$/m).slice(1).map((row) => {
      const cells = row.split(/\r?\n/).filter((line) => line.startsWith("| ") || line === "|").map((line) => line.slice(2));
      if (cells.length !== 3) throw new Error(`Invalid Panorama help row in ${name}.`);
      return cells.map(decodeHtml);
    });
    if (!rows.length) throw new Error(`Empty Panorama help table: ${name}.`);
    if (/^! Enumerator$/m.test(body)) {
      const en: PanoramaEnum = { name, source: "engine-help", members: rows.map(([key, value, description]) => {
        if (!key.startsWith(`${name}.`) || !/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
          throw new Error(`Invalid Panorama enum: ${name}.`);
        }
        return { name: key.slice(name.length + 1), value: Number(value), ...(description ? { description } : {}) };
      }) };
      out.enums!.push(en);
      continue;
    }
    if (!/^! Function$/m.test(body)) throw new Error(`Unrecognized Panorama table type: ${name}.`);
    const iface: PanoramaInterface = {
      name: name === "$" ? "DollarStatic" : name,
      source: "engine-help",
      members: rows.map(([member, signature, description]): PanoramaMember => ({
        name: member, kind: "method", signature, source: "engine-help",
        ...(description ? { description } : {}),
      })),
    };
    out.interfaces.push(iface);
    const aliases = new Set(rows.flatMap(([, signature]) => {
      const match = signature.match(/^"([^"]+)"\./);
      return match ? [match[1]] : [];
    }));
    if (name === "$") aliases.add("$");
    for (const alias of aliases) out.globals.push({ name: alias, type: iface.name, declared: true, source: "engine-help" });
  }
  return out;
}

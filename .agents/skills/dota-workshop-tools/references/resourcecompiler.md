# ResourceCompiler

## MCP endpoints

| Endpoint | Usage |
|---|---|
| `addon_compile_content` | Supply `projectRoot` or `addon` to compile the addon's content tree; `force:true` requests a full rebuild. |
| `map_compile` | Supply `projectRoot` and map `name` to compile one VMAP into its game VPK. |

Both accept `dryRun:true`: inspect the selected compiler and input/output paths
before execution. Script builds use `addon_build` instead.

## Compiler fallback and build matching

ResourceCompiler is usually invoked by editors/builds. Do not assume there is a
separate window. For CLI automation, first obtain the **actual** invocation from
the log, process, or help for that version, then pin the executable/options in the
session record. Do not copy modern flags or invent a generic “convert all” command.
If a binary has no explicit help, do not run it blindly on production data.
Record the verified compiler invocation, staged paths, file lists and receipts
with the current run. Prefer the MCP compile dry run when available.

Keep each build's compiled outputs separate. Build-2439 imports must compile with
that build's compiler; success with a newer compiler is not a substitute. Retain
sources for independent compilation and validation on a current target.

For maps, use [Hammer's build workflow](hammer.md#build). Reopen resources in
their matching editor and perform [runtime checks](dota2/runtime.md) after
compilation; the compiler result alone does not prove appearance or gameplay.

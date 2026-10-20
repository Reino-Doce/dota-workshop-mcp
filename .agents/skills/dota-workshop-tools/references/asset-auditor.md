# Read-only asset snapshots

## MCP endpoints

The SHA-256 snapshot/diff auditor is a local CLI. These MCP endpoints provide
related project checks:

| Endpoint | Usage |
|---|---|
| `addon_audit` | Supply `projectRoot` and optional `severity` to check scripts, events, precaching, UI manifests and localization. |
| `assets_list` | Supply `projectRoot` and optional `type` for a bounded addon asset inventory. |

Neither endpoint produces the file hashes or before/after comparison below.

## Snapshot and diff fallback

The copied `scripts/audit_assets.py` requires Python 3.10+ and only the standard
library. Resolve its location relative to this skill, not the addon's directory.
Choose an existing audit-output directory outside all scanned roots.

```text
python <skill>/scripts/audit_assets.py snapshot --root content=<addon-content> --root game=<addon-game> --out <audit>/before.json
python <skill>/scripts/audit_assets.py snapshot --root content=<addon-content> --root game=<addon-game> --out <audit>/after.json
python <skill>/scripts/audit_assets.py diff --before <audit>/before.json --after <audit>/after.json --out <audit>/diff.json --fail-on-change
```

Quote each argument containing spaces. Inspect `--help` for the exact options.
Use the same roots and extension filter for both snapshots. The historical
`dota2017-assets-v1`/`dota2017-assets-diff-v1` schema identifiers are retained for
compatibility; the auditor handles files from any build and does not identify
their Dota version.

Snapshots record SHA-256, size, file identity and hardlink count. Internal links
and reparse points are skipped and reported; explicit root/output paths through
links are rejected before resolution. Audit a link's real target as an explicit
root when intended. Regular hardlinks are read without modifying them.

Reports cannot overwrite an existing output or be written inside a scanned root.
Exit codes:

- `0`: complete scan/diff within its stated scope.
- `1`: argument, format or access error.
- `2`: partial report, including unread files or skipped links.
- `3`: complete diff with content changes when `--fail-on-change` is enabled.

Partial status takes precedence over changed status. Metadata-only changes do
not trigger exit 3. Filters exclude files from the evidence; they cannot prove
that excluded files were unchanged.

The auditor does not extract VPKs, resolve dependencies, attribute changes to
processes, freeze a live filesystem or validate a conversion. Path/race checks
are best-effort checks for quiescent workspaces, not a hostile-filesystem sandbox.
Use compiler logs and actual preview/runtime evidence for the remaining gates.

The bundled tests run with:

```text
python -m unittest discover -s <skill>/tests -v
```

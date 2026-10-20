# Dota 2 build 2439 API sources

The engine help captures were produced by Valve's Dota 2 build 2439
(SourceRevision 4163623, October 3, 2017). The source text and descriptions
originate from Valve. `source/capture.json` identifies the executable, commands,
completion checks and SHA-256 of each capture. Capturing a binding is evidence
that it is documented by that build, not that every function was exercised.

`source/build-provenance.json` links the captured build to
[SteamTracking/GameTracking-Dota2 commit b0c2741e6f27ec8dbf7c64b5dd16b09b744e8b43](https://github.com/SteamTracking/GameTracking-Dota2/commit/b0c2741e6f27ec8dbf7c64b5dd16b09b744e8b43),
dated October 3, 2017 at 21:33:23 UTC with commit message `2439`. All fields in
its `game/dota/steam.inf` match the captured build metadata. Its
`game/bin/built_from_cl.txt` contains `4163522`, a separate value from
`SourceRevision`. The installed `npc_heroes.txt` and `npc_abilities.txt` also
match that commit after normalizing CRLF to LF; the manifest records both
SHA-256 values and the normalization. These comparisons cover the named files,
not the complete installation or game binaries.

The same manifest records the twelve depot/manifest pairs and UTC timestamps
supplied by the user as the installation's construction. All IDs remain decimal
strings, including values beyond JavaScript's safe integer range. Their source
is `user-provided` and their verification is `not-verified-with-steam`; no depot
was downloaded and no Steam manifest was verified. Both generated API datasets
return this information under `metadata.buildProvenance`. Offline regeneration
checks every captured build field against the retained GameTracking metadata
before publishing either dataset.

Historical class inheritance and Panorama TypeScript declarations originate
from the ModDota community's [API repository](https://github.com/ModDota/API),
pinned to commit `410db4c72fb50215be87517f3f74761a9973812a` (October 1, 2017).
The Lua class reference was last changed June 21, 2017; the two Panorama sources
were last changed September 24 and September 17, 2017. That repository snapshot
does not contain a license file. These source attributions are retained; this
project's source-code license does not relicense upstream documentation.

No current-version declarations are used to fill gaps in the build-2439 dataset.
Historical-only Panorama entries and historical inheritance are explicitly
identified in the generated data. The engine's Panorama dump depends on the
active UI context, so its absence of a member is not proof that the member is
unavailable elsewhere.

Regenerate the bundled datasets offline:

```text
node --import tsx scripts/build-api-snapshots.mjs
```

The optional `--download-reference` flag restores only the three historical
source files at the fixed commit and verifies their SHA-256 values. It never
fetches a moving branch or a current package.

To capture another running build, use a new directory outside the installation:

```text
node --import tsx scripts/build-api-capture.mjs --root "<installation>" --port <port> --out "<new-directory>"
```

This command requires a running map and verifies that the VConsole endpoint
belongs to the selected installation. It issues only the three help commands,
plus protocol markers, and saves complete, parsed captures. It does not replace
the bundled dataset automatically.

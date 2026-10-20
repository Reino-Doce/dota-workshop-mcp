# Native import, identity, and fidelity

This file describes the proposed operating strategy for the selected installation.
A capability moves from documented/candidate to proven only after a local
operation with evidence. It does not assume access to the complete internal
converter Valve used for Reborn.

## 1. Three independent dimensions

Record these separately:

```text
snapshot_source1 = version that supplied BSP, MDL, VMT, VTF, PCF, and scripts
importer_build   = identified Workshop Tools build and compiler hashes
runtime_target   = separately selected build used for validation
```

An unexpected asset can come from the selected engine's base content. Inspect
the resolved path and dependencies before attributing it to another installation.

## 2. Organization without collisions

Keep the installation and configuration that already imports the VMF working. Do
not reconfigure everything merely to standardize folders. For an isolated proof,
use a layout such as:

```text
ROOT/
  game/
    dota/                       # S2 engine/base; do not put S1 assets here
    dota_s1_legacy/              # stage data extracted from ONE era
      gameinfo.txt
      models/                   # MDL and sidecars; original paths
      materials/                # VMT/VTF; original paths
      particles/
      sound/
      scripts/
    dota_addons/<addon>/  # compiled outputs
  content/
    dota_s1_legacy/maps/         # input VMF, if used by the local importer
    dota_addons/<addon>/
      maps/
      models/
      materials/
      particles/
```

This is a staging layout to test, not a universal requirement for every build.
If files are already mounted another way and the VMF imports, record the actual
layout and change only the demonstrated problem.

VPK extraction and BSP→VMF are earlier preparation steps. The Hammer used here
receives the VMF. Preserve the complete chunk set associated with each VPK index.
A correct BSP paired with materials from another snapshot is not a faithful source.

## 3. Version-specific import configuration

Read the [build-2439 Source1Import procedure](2439.md) before changing importer configuration. It covers native
configuration for the internal `dota2.exe` converter, removed after build 2440.
Preserve the working configuration, independently back it up and verify path resolution;
restore it after the operation.
A configuration block or DLL string does not establish an exposed conversion API.

## 4. Discover native conversion by asset class

Reuse a previously verified VMF→VMAP route only when its build and configuration
match the session. Otherwise validate one small input first. For **MDL, VMT/VTF, and PCF**, perform a bounded discovery:

1. Open the associated tool and record its menus, file filters, and local help.
2. Check import actions in Asset Browser and the tool, without confusing “open
   existing resource” with conversion.
3. If a locally documented console/CLI exists, record its syntax and executable;
   only then run a controlled input. Autocomplete without help does not prove the
   meaning or order of arguments.
4. For each route found, record inputs, outputs, log, duration, build, hashes, and
   side effects. Do not guess flags.
5. If no route is found, classify it as `not_exposed_found`, not “the code was
   removed.” If a route fails, record the specific input and first error.

A minimal test map can reference one S1 asset to check whether Hammer's importer
triggers transitive conversion. Use a copy of a small valid VMF; do not generate
unvalidated VMF syntax. Compare before/after snapshots: if no new asset appears,
a model that showed up may simply be a reused S2 asset. To disprove that, use a
reference with no S2 equivalent **only if** changing the reference/package keeps
its internal S1 dependencies valid. Renaming a binary MDL without updating its
relationships is not a clean test.

The simpler alternative is to inspect provenance and hashes of the generated
resource, then test it under a unique path **after** conversion.

## 5. Fixing trees and towers: layered diagnosis

### Layer A — the wrong file was resolved

Symptom: the browser/editor points to base content, or no converted output exists
in the addon. Fix import, mounting, and the reference; do not adjust the shader to
“look like” the old file. Similar names and extensions do not guarantee the source.

### Layer B — dependencies were only partly converted

Symptom: the old mesh is correct, but its material is modern/missing. Open the
dependencies, convert the S1 texture/material, and use Model Editor remapping.
Repeat for relevant skins, LODs, animations, and child particles. Do not only
rename files externally.

### Layer C — the entity/runtime chooses another resource

Symptom: preview and isolated prop are correct, but the tower/tree is wrong in
game. Inspect the class, parameters, unit definition, skin, and scripts available
in the addon. Record the selected resource at spawn and during state changes. Do
not claim that every tree/tower is defined identically across eras.

In visual tests, an isolated prop helps separate the file from its behavior. In
the final map, preserve unit semantics, destruction, navigation, and respawn. Do
not replace everything with static props to approve the batch.

### Layer D — renderer and environment

Prove A–C first. Only then compare shader, alpha, mask, lighting, fog, and exposure
under equivalent conditions. The goal is historical appearance, not “PBR
modernization.” Identical texture pixels do not guarantee identical rendering
between engines. Keep an explicit list of accepted visual deviations.

## 6. A namespace is not deduplication

Proposed convention for coexistence:

```text
models/legacy/<era>/...
materials/legacy/<era>/...
particles/legacy/<era>/...
maps/legacy_<era>_working.vmap
```

The namespace selects the logical variant. CAS/hardlinks save bytes. These are
separate problems. If two eras use the same global logical path with different
content, hardlinks do not determine which variant Dota should load.

Before remapping, preserve a baseline for each era. Then update the reference
graph: VMAP, VMDL, materials, textures, particles, children, entity definitions,
and scripts that select resources dynamically. Recompile the set. Never perform
a global replacement in `.vmdl_c`, `.vmat_c`, or binary VPKs.

## 7. Conversion-cache boundary

Proposed key:

```text
SHA256(
  importer/compiler versions and hashes
  + relevant configuration and options
  + target runtime/branch
  + logical path and namespace policy
  + input hashes and resolved dependency hashes
)
```

The main input hash alone detects identical bytes; it does not necessarily imply
equivalent conversion results. Different VMTs can reference distinct VTFs with the
same name across snapshots; identical MDLs can resolve to different materials.
A conversion may embed names/paths.

Use SHA-256 in new manifests. Legacy MD5 can help triage and need not be removed
from existing indexes. Share only stabilized outputs. Hardlinks refer to the same
file; writes and attributes can affect every path. Do not assume “read-only” on
one name isolates the others. [D17]

## 8. Batch acceptance

Preserve evidence for a ground material, prop, leaf/alpha, building, animation,
and effect where applicable. Verify at least one editor reopen and one fresh map
load. A successful compile and a good-looking screenshot are not enough to claim
historical asset identity.

To test the current client, keep its own compiled tree and the sources generated
by the identified importer. A later migration may need adjustments/recompilation; do not turn the
historical proof into a promise of future compatibility.

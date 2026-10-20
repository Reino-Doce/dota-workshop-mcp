#!/usr/bin/env python3
"""Read-only asset-tree snapshots and SHA-256 diffs. Python 3.10+, stdlib only.

Only the explicitly requested report is written. No conversion, desktop control,
link creation, VPK extraction, or mutation of assets is performed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = "dota2017-assets-v1"
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


def is_link_or_reparse(st: os.stat_result) -> bool:
    return stat.S_ISLNK(st.st_mode) or bool(
        getattr(st, "st_file_attributes", 0) & REPARSE_POINT
    )


def reject_reparse_chain(path: Path) -> Path:
    """Reject explicit links before resolve() could hide them.

    This is a best-effort check for quiescent local workspaces, NOT a sandbox
    against concurrent path replacement. No-follow handle traversal would be
    needed for a hostile filesystem on every supported operating system.
    """
    expanded = path.expanduser()
    absolute = expanded if expanded.is_absolute() else Path.cwd() / expanded
    for part in (*reversed(absolute.parents), absolute):
        try:
            st = part.lstat()
        except FileNotFoundError:
            continue
        if is_link_or_reparse(st):
            raise ValueError(f"Link/reparse path is not allowed: {part}")
    return absolute


def identity(st: os.stat_result) -> tuple[int, int, int, int, int]:
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns


def hash_file(path: Path) -> dict[str, Any]:
    before = path.lstat()
    if is_link_or_reparse(before) or not stat.S_ISREG(before.st_mode):
        raise ValueError("Not a regular file, or is a link/reparse point")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        # Some runtimes return creation time from lstat but change time from
        # fstat on the same file. Compare identity/size/mtime across APIs, then
        # retain ctime in each API's own before/after consistency check.
        if identity(before)[:4] != identity(opened)[:4]:
            raise RuntimeError("File changed before reading")
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
        if identity(opened) != identity(os.fstat(stream.fileno())):
            raise RuntimeError("File changed while reading")
    after = path.lstat()
    if is_link_or_reparse(after) or identity(before) != identity(after):
        raise RuntimeError("Path or file changed while reading")
    return {
        "sha256": digest.hexdigest(),
        "size": after.st_size,
        "mtime_ns": after.st_mtime_ns,
        "device": after.st_dev,
        "file_id": after.st_ino,
        "nlink": after.st_nlink,
    }


def parse_roots(values: list[str]) -> dict[str, Path]:
    roots: dict[str, Path] = {}
    for value in values:
        label, sep, raw = value.partition("=")
        if not sep or not re.fullmatch(r"[a-zA-Z0-9_-]+", label) or not raw:
            raise ValueError("Each --root must be LABEL=PATH; label: letters/digits/_/-")
        if label.casefold() in {name.casefold() for name in roots}:
            raise ValueError(f"Duplicate root label: {label}")
        root = reject_reparse_chain(Path(raw)).resolve(strict=True)
        if not root.is_dir():
            raise ValueError(f"Not a directory: {root}")
        roots[label] = root
    return roots


def normalize_extensions(raw: str) -> list[str]:
    result = set()
    for value in raw.split(","):
        value = value.strip().lower()
        if value:
            result.add(value if value.startswith(".") else "." + value)
    return sorted(result)


def check_output(out: Path, roots: dict[str, Path]) -> Path:
    out = reject_reparse_chain(out).resolve()
    if out.exists():
        raise FileExistsError(f"Report already exists; choose a new path: {out}")
    for root in roots.values():
        if out == root or root in out.parents:
            raise ValueError(f"Report must be outside scanned roots: {root}")
    return out


def snapshot(roots: dict[str, Path], extensions: list[str]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schema": SCHEMA,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "roots": {name: str(path) for name, path in roots.items()},
        "extensions": extensions,
        "entries": {},
        "skipped": [],
        "errors": [],
        "complete": True,
    }
    for label, root in roots.items():
        seen_names: dict[str, str] = {}
        stack = [root]
        while stack:
            folder = stack.pop()
            try:
                if is_link_or_reparse(folder.lstat()):
                    result["skipped"].append({"path": str(folder), "reason": "directory_replaced_by_link"})
                    continue
                children = sorted(folder.iterdir(), key=lambda p: (p.name.casefold(), p.name))
            except OSError as exc:
                result["errors"].append({"path": str(folder), "error": str(exc)})
                continue
            for path in children:
                key = label + ":" + path.relative_to(root).as_posix()
                relative = path.relative_to(root).as_posix()
                if "\\" in relative or ":" in relative:
                    result["errors"].append({"path": key, "error": "Nonportable Windows path"})
                    continue
                folded = key.casefold()
                if folded in seen_names and seen_names[folded] != key:
                    result["errors"].append({
                        "path": key, "error": "Windows case-insensitive path collision",
                        "other_path": seen_names[folded],
                    })
                seen_names[folded] = key
                try:
                    st = path.lstat()
                    if is_link_or_reparse(st):
                        result["skipped"].append({"path": key, "reason": "link_or_reparse"})
                    elif stat.S_ISDIR(st.st_mode):
                        stack.append(path)
                    elif stat.S_ISREG(st.st_mode):
                        if not extensions or path.suffix.lower() in extensions:
                            result["entries"][key] = hash_file(path)
                    else:
                        result["skipped"].append({"path": key, "reason": "not_regular"})
                except (OSError, ValueError, RuntimeError) as exc:
                    result["errors"].append({"path": key, "error": str(exc)})
    result["entries"] = dict(sorted(result["entries"].items()))
    result["complete"] = not result["errors"] and not result["skipped"]
    result["file_count"] = len(result["entries"])
    result["logical_bytes"] = sum(item["size"] for item in result["entries"].values())
    result["coverage_note"] = (
        "Completeness applies only to selected extensions and scanned roots; "
        "this is not a dependency or runtime-provenance audit. Logical bytes "
        "count every path, including hardlinks, and are not allocated disk bytes."
    )
    return result


def unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def validate_snapshot(data: Any) -> None:
    if not isinstance(data, dict) or data.get("schema") != SCHEMA:
        raise ValueError("Invalid snapshot schema")
    roots = data.get("roots")
    if not isinstance(roots, dict) or not roots or any(
        not isinstance(k, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", k)
        or not isinstance(v, str) or not v for k, v in roots.items()
    ):
        raise ValueError("Invalid snapshot roots")
    if len({k.casefold() for k in roots}) != len(roots):
        raise ValueError("Duplicate case-insensitive root labels")
    filters = data.get("extensions")
    if not isinstance(filters, list) or any(not isinstance(x, str) for x in filters):
        raise ValueError("Invalid extension filter")
    if filters != normalize_extensions(",".join(filters)):
        raise ValueError("Noncanonical extension filter")
    if type(data.get("complete")) is not bool:
        raise ValueError("Snapshot complete must be a boolean")
    for field in ("errors", "skipped"):
        if not isinstance(data.get(field), list):
            raise ValueError(f"Invalid {field} list")
    if data["complete"] and (data["errors"] or data["skipped"]):
        raise ValueError("Snapshot claims complete despite errors/skips")
    entries = data.get("entries")
    if not isinstance(entries, dict):
        raise ValueError("Invalid entries")
    for key, item in entries.items():
        if not isinstance(key, str) or ":" not in key:
            raise ValueError("Invalid entry key")
        label, rel = key.split(":", 1)
        if label not in roots or not rel or rel.startswith("/") or "\\" in rel:
            raise ValueError(f"Invalid entry path: {key}")
        if any(part in ("", ".", "..") for part in rel.split("/")) or ":" in rel:
            raise ValueError(f"Unsafe entry path: {key}")
        if not isinstance(item, dict):
            raise ValueError(f"Invalid entry: {key}")
        digest, size = item.get("sha256"), item.get("size")
        if not isinstance(digest, str) or HASH_PATTERN.fullmatch(digest) is None:
            raise ValueError(f"Invalid SHA-256: {key}")
        if type(size) is not int or size < 0:
            raise ValueError(f"Invalid size: {key}")
    if type(data.get("file_count")) is not int or data["file_count"] != len(entries):
        raise ValueError("Invalid file_count")
    total = sum(item["size"] for item in entries.values())
    if type(data.get("logical_bytes")) is not int or data["logical_bytes"] != total:
        raise ValueError("Invalid logical_bytes")


def read_snapshot(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8-sig") as stream:
        data = json.load(stream, object_pairs_hook=unique_json_object)
    validate_snapshot(data)
    return data


def compare(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    validate_snapshot(before)
    validate_snapshot(after)
    if set(before["roots"]) != set(after["roots"]):
        raise ValueError("Both snapshots must use the same root labels")
    if before["extensions"] != after["extensions"]:
        raise ValueError("Both snapshots must use the same extension filter")
    old, new = before["entries"], after["entries"]
    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    changed = []
    metadata_only = []
    for key in sorted(set(old) & set(new)):
        if (old[key]["sha256"], old[key]["size"]) != (new[key]["sha256"], new[key]["size"]):
            changed.append(key)
        elif old[key] != new[key]:
            metadata_only.append(key)
    return {
        "schema": "dota2017-assets-diff-v1",
        "before_roots": before["roots"],
        "after_roots": after["roots"],
        "complete": bool(before["complete"] and after["complete"]),
        "added": added,
        "removed": removed,
        "content_changed": changed,
        "metadata_only": metadata_only,
        "counts": {"added": len(added), "removed": len(removed),
                   "content_changed": len(changed), "metadata_only": len(metadata_only)},
        "source_issues": {
            "before": {k: before[k] for k in ("errors", "skipped")},
            "after": {k: after[k] for k in ("errors", "skipped")},
        },
        "note": "Incomplete scans produce tentative deltas, not confirmed absence. "
                "Changes are not proof of conversion or historical fidelity.",
    }


def write_new(path: Path, data: dict[str, Any]) -> None:
    # Serialize before creating the report to avoid partial output on type errors.
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    path = reject_reparse_chain(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive create: never truncate an existing report.
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    snap = sub.add_parser("snapshot", help="Hash explicitly scoped trees, without following links")
    snap.add_argument("--root", action="append", required=True, help="LABEL=PATH (repeatable)")
    snap.add_argument("--extensions", default="", help="Optional comma-separated suffixes")
    snap.add_argument("--out", type=Path, required=True)
    diff = sub.add_parser("diff", help="Compare snapshots with matching labels and filters")
    diff.add_argument("--before", type=Path, required=True)
    diff.add_argument("--after", type=Path, required=True)
    diff.add_argument("--out", type=Path, required=True)
    diff.add_argument("--fail-on-change", action="store_true",
                      help="Return 3 for added/removed/content-changed files; metadata-only stays 0")
    args = parser.parse_args()
    try:
        if args.command == "snapshot":
            roots = parse_roots(args.root)
            out = check_output(args.out, roots)
            data = snapshot(roots, normalize_extensions(args.extensions))
        else:
            before = read_snapshot(args.before)
            after = read_snapshot(args.after)
            roots = {f"b-{k}": Path(v) for k, v in before["roots"].items()}
            roots.update({f"a-{k}": Path(v) for k, v in after["roots"].items()})
            out = check_output(args.out, roots)
            data = compare(before, after)
        write_new(out, data)
        print(json.dumps({"report": str(out), "complete": data["complete"],
                          "counts": data.get("counts", {"files": data.get("file_count")})},
                         ensure_ascii=False))
        if not data["complete"]:
            return 2
        if args.command == "diff" and args.fail_on_change and any(
            data[key] for key in ("added", "removed", "content_changed")
        ):
            return 3
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

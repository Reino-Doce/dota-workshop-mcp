"""Tests use temporary directories only; no game installation is required."""
import hashlib
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

FILE = Path(__file__).resolve().parents[1] / "scripts" / "audit_assets.py"
spec = importlib.util.spec_from_file_location("audit_assets", FILE)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / "assets"
        self.root.mkdir()
        self.roots = {"content": self.root}

    def tearDown(self):
        self.temp.cleanup()

    def test_hash_and_unicode_name(self):
        data = b"\x00source2\xff"
        (self.root / "árvore.vmdl").write_bytes(data)
        snap = audit.snapshot(self.roots, [])
        self.assertTrue(snap["complete"])
        self.assertEqual(snap["entries"]["content:árvore.vmdl"]["sha256"],
                         hashlib.sha256(data).hexdigest())

    def test_diff_added_changed_removed(self):
        a = self.root / "a.vmat"
        b = self.root / "b.vmat"
        a.write_text("old")
        b.write_text("remove")
        old = audit.snapshot(self.roots, [])
        a.write_text("new content")
        b.unlink()
        (self.root / "c.vmat").write_text("new")
        new = audit.snapshot(self.roots, [])
        diff = audit.compare(old, new)
        self.assertEqual(diff["added"], ["content:c.vmat"])
        self.assertEqual(diff["removed"], ["content:b.vmat"])
        self.assertEqual(diff["content_changed"], ["content:a.vmat"])

    def test_hardlink(self):
        a = self.root / "one"
        b = self.root / "two"
        a.write_bytes(b"same")
        try:
            os.link(a, b)
        except OSError as exc:
            self.skipTest(str(exc))
        snap = audit.snapshot(self.roots, [])
        one, two = snap["entries"]["content:one"], snap["entries"]["content:two"]
        self.assertEqual(one["sha256"], two["sha256"])
        self.assertEqual(one["file_id"], two["file_id"])
        self.assertGreaterEqual(one["nlink"], 2)

    def test_symlink_is_skipped(self):
        outside = self.base / "outside"
        outside.mkdir()
        (outside / "secret").write_text("do not traverse")
        try:
            (self.root / "link").symlink_to(outside, target_is_directory=True)
        except OSError as exc:
            self.skipTest(str(exc))
        snap = audit.snapshot(self.roots, [])
        self.assertFalse(snap["complete"])
        self.assertEqual(snap["entries"], {})
        self.assertEqual(snap["skipped"][0]["path"], "content:link")

    def test_no_output_inside_assets(self):
        with self.assertRaises(ValueError):
            audit.check_output(self.root / "report.json", self.roots)

    def test_never_overwrite_report(self):
        report = self.base / "report.json"
        audit.write_new(report, {"old": True})
        with self.assertRaises(FileExistsError):
            audit.write_new(report, {"old": False})
        self.assertIn('"old": true', report.read_text())

    def test_extensions(self):
        (self.root / "a.VMAT").write_text("a")
        (self.root / "b.txt").write_text("b")
        filters = audit.normalize_extensions("vmat,.vmdl,VMAT")
        self.assertEqual(filters, [".vmat", ".vmdl"])
        snap = audit.snapshot(self.roots, filters)
        self.assertEqual(list(snap["entries"]), ["content:a.VMAT"])
        self.assertTrue(snap["complete"])

    def test_scope_mismatch_rejected(self):
        a = audit.snapshot(self.roots, [])
        b = audit.snapshot(self.roots, [".vmdl"])
        with self.assertRaises(ValueError):
            audit.compare(a, b)

    def test_duplicate_label_rejected(self):
        with self.assertRaises(ValueError):
            audit.parse_roots([f"x={self.root}", f"x={self.root}"])

    def test_missing_root_rejected(self):
        with self.assertRaises(OSError):
            audit.parse_roots([f"x={self.base / 'missing'}"])


if __name__ == "__main__":
    unittest.main()

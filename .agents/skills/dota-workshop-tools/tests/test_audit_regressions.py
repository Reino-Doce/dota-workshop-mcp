"""Regression tests for report integrity and Windows-oriented path handling."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1] / 'scripts' / 'audit_assets.py'
spec = importlib.util.spec_from_file_location('audit_regressions', FILE)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class RegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / 'assets'
        self.root.mkdir()
        (self.root / 'tree.vmat').write_bytes(b'old')
        self.roots = {'content': self.root}

    def tearDown(self):
        self.temp.cleanup()

    def test_path_and_handle_ctime_can_differ(self):
        path = self.root / 'tree.vmat'
        actual = path.stat()
        handle = SimpleNamespace(**{
            name: getattr(actual, name)
            for name in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        })
        handle.st_ctime_ns += 1
        with patch.object(audit.os, 'fstat', return_value=handle):
            self.assertEqual(audit.hash_file(path)['size'], 3)

    def test_handle_change_during_read_is_still_rejected(self):
        path = self.root / 'tree.vmat'
        actual = path.stat()
        opened = SimpleNamespace(**{
            name: getattr(actual, name)
            for name in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        })
        changed = SimpleNamespace(**vars(opened))
        changed.st_ctime_ns += 1
        with patch.object(audit.os, 'fstat', side_effect=[opened, changed]):
            with self.assertRaisesRegex(RuntimeError, 'File changed while reading'):
                audit.hash_file(path)

    def snap(self):
        return audit.snapshot(self.roots, [])

    def link(self, target, path, directory=False):
        try:
            path.symlink_to(target, target_is_directory=directory)
        except OSError as exc:
            self.skipTest(f'Symlink privilege/support unavailable: {exc}')

    def test_root_symlink_rejected_before_resolve(self):
        path = self.base / 'alias'
        self.link(self.root, path, True)
        with self.assertRaises(ValueError):
            audit.parse_roots([f'x={path}'])

    def test_ancestor_symlink_rejected(self):
        sub = self.root / 'sub'; sub.mkdir()
        alias = self.base / 'alias'; self.link(self.root, alias, True)
        with self.assertRaises(ValueError):
            audit.parse_roots([f'x={alias / "sub"}'])

    def test_link_before_parent_component_rejected(self):
        alias = self.base / 'alias'; self.link(self.root, alias, True)
        with self.assertRaises(ValueError):
            audit.parse_roots([f'x={alias / ".." / "assets"}'])

    def test_case_variant_root_labels_rejected(self):
        with self.assertRaises(ValueError):
            audit.parse_roots([f'x={self.root}', f'X={self.root}'])

    def test_root_file_rejected(self):
        with self.assertRaises(ValueError):
            audit.parse_roots([f'x={self.root / "tree.vmat"}'])

    def test_output_symlink_rejected(self):
        alias = self.base / 'report.json'
        self.link(self.base / 'not-created.json', alias)
        with self.assertRaises(ValueError):
            audit.check_output(alias, self.roots)
        self.assertFalse((self.base / 'not-created.json').exists())

    def test_output_ancestor_symlink_rejected(self):
        dest = self.base / 'reports'; dest.mkdir()
        alias = self.base / 'alias'; self.link(dest, alias, True)
        with self.assertRaises(ValueError):
            audit.check_output(alias / 'report.json', self.roots)

    def test_duplicate_json_keys_rejected(self):
        file = self.base / 'bad.json'
        file.write_text('{"schema":"a","schema":"b"}')
        with self.assertRaises(ValueError):
            audit.read_snapshot(file)

    def test_non_object_report_rejected(self):
        file = self.base / 'bad.json'; file.write_text('[]')
        with self.assertRaises(ValueError):
            audit.read_snapshot(file)

    def test_utf8_bom_report_accepted(self):
        file = self.base / 'bom.json'
        file.write_text(json.dumps(self.snap()), encoding='utf-8-sig')
        self.assertTrue(audit.read_snapshot(file)['complete'])

    def test_non_boolean_complete_rejected(self):
        bad = self.snap(); bad['complete'] = 'false'
        with self.assertRaises(ValueError):
            audit.compare(bad, self.snap())

    def test_false_completeness_rejected(self):
        bad = self.snap(); bad['errors'] = [{'error': 'missing'}]
        with self.assertRaises(ValueError):
            audit.validate_snapshot(bad)

    def test_invalid_hash_rejected(self):
        bad = self.snap(); bad['entries']['content:tree.vmat']['sha256'] = 'not-a-hash'
        with self.assertRaises(ValueError):
            audit.validate_snapshot(bad)

    def test_negative_size_rejected(self):
        bad = self.snap(); bad['entries']['content:tree.vmat']['size'] = -1
        with self.assertRaises(ValueError):
            audit.validate_snapshot(bad)

    def test_bad_counts_rejected(self):
        for field in ['file_count', 'logical_bytes']:
            with self.subTest(field=field):
                bad = self.snap(); bad[field] += 1
                with self.assertRaises(ValueError):
                    audit.validate_snapshot(bad)

    def test_metadata_only_not_content_change(self):
        before = self.snap(); after = copy.deepcopy(before)
        after['entries']['content:tree.vmat']['mtime_ns'] += 1
        diff = audit.compare(before, after)
        self.assertEqual(diff['content_changed'], [])
        self.assertEqual(diff['metadata_only'], ['content:tree.vmat'])

    def test_incomplete_diff_carries_source_issues(self):
        before = self.snap(); after = copy.deepcopy(before)
        after['complete'] = False; after['skipped'] = [{'path': 'content:alias'}]
        result = audit.compare(before, after)
        self.assertFalse(result['complete'])
        self.assertEqual(result['source_issues']['after']['skipped'], after['skipped'])

    def test_case_collisions_fail_coverage(self):
        second = self.root / 'TREE.vmat'
        if second.exists():
            self.skipTest('Case-insensitive filesystem cannot construct this fixture')
        second.write_bytes(b'different')
        result = self.snap()
        self.assertFalse(result['complete'])
        self.assertTrue(any('collision' in e['error'] for e in result['errors']))

    def test_serialization_error_does_not_create_report(self):
        report = self.base / 'report.json'
        with self.assertRaises(TypeError):
            audit.write_new(report, {'bad': object()})
        self.assertFalse(report.exists())

    def test_diff_root_labels_must_match(self):
        a = self.snap(); b = audit.snapshot({'game': self.root}, [])
        with self.assertRaises(ValueError):
            audit.compare(a, b)

    def test_cli_change_gate_and_original_immutability(self):
        before_path = self.base / 'before.json'; after_path = self.base / 'after.json'
        def run(*args):
            return subprocess.run([sys.executable, str(FILE), *map(str, args)],
                                  capture_output=True, text=True, timeout=10)
        first = run('snapshot', '--root', f'content={self.root}', '--out', before_path)
        self.assertEqual(first.returncode, 0, first.stderr)
        (self.root / 'tree.vmat').write_bytes(b'new')
        second = run('snapshot', '--root', f'content={self.root}', '--out', after_path)
        self.assertEqual(second.returncode, 0, second.stderr)
        diff = run('diff', '--before', before_path, '--after', after_path,
                   '--out', self.base / 'diff.json', '--fail-on-change')
        self.assertEqual(diff.returncode, 3, diff.stderr)
        self.assertEqual((self.root / 'tree.vmat').read_bytes(), b'new')
        retry = run('snapshot', '--root', f'content={self.root}', '--out', before_path)
        self.assertEqual(retry.returncode, 1)
        self.assertEqual(audit.read_snapshot(before_path)['entries']['content:tree.vmat']['size'], 3)

    def test_cli_incomplete_takes_precedence_over_change(self):
        old = self.snap(); new = copy.deepcopy(old)
        new['complete'] = False; new['errors'] = [{'error': 'partial'}]
        new['entries'] = {}; new['file_count'] = 0; new['logical_bytes'] = 0
        a = self.base / 'a.json'; b = self.base / 'b.json'
        audit.write_new(a, old); audit.write_new(b, new)
        result = subprocess.run([sys.executable, str(FILE), 'diff', '--before', str(a),
            '--after', str(b), '--out', str(self.base/'out.json'), '--fail-on-change'],
            capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2, result.stderr)


if __name__ == '__main__':
    unittest.main()

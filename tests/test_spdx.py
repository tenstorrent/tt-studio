# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for SPDX header tooling."""
import tempfile
import unittest
from pathlib import Path

try:
    from tt_setup import spdx as M
except ImportError:  # pre-refactor
    import run as M


class TestHeaderType(unittest.TestCase):
    def test_known_types(self):
        self.assertEqual(M.get_spdx_header_type(Path("a.py")), "hash")
        self.assertEqual(M.get_spdx_header_type(Path("a.sh")), "hash")
        self.assertEqual(M.get_spdx_header_type(Path("Dockerfile")), "hash")
        self.assertEqual(M.get_spdx_header_type(Path("a.tsx")), "double_slash")
        self.assertEqual(M.get_spdx_header_type(Path("a.css")), "css")
        self.assertEqual(M.get_spdx_header_type(Path("a.html")), "html")

    def test_unknown_type(self):
        self.assertIsNone(M.get_spdx_header_type(Path("a.md")))


class TestHeaders(unittest.TestCase):
    def test_templates_present(self):
        headers = M.get_spdx_headers()
        for key in ("hash", "double_slash", "css", "html"):
            self.assertIn(key, headers)
            self.assertIn("SPDX-License-Identifier: Apache-2.0", headers[key])


class TestShouldSkipDirectory(unittest.TestCase):
    def test_skips_known_dirs(self):
        for name in ("node_modules", ".git", "__pycache__", "frontend"):
            self.assertTrue(M.should_skip_spdx_directory(Path(name)))

    def test_does_not_skip_normal_dir(self):
        self.assertFalse(M.should_skip_spdx_directory(Path("app")))


class TestAddHeaderToFile(unittest.TestCase):
    def test_adds_header_once(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "x.py"
            f.write_text("print('hi')\n")
            headers = M.get_spdx_headers()
            self.assertTrue(M.add_spdx_header_to_file(f, headers))
            content = f.read_text()
            self.assertIn("SPDX-License-Identifier", content)
            self.assertFalse(M.add_spdx_header_to_file(f, headers))  # no-op second time

    def test_skips_unknown_extension(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "x.md"
            f.write_text("# title\n")
            self.assertFalse(M.add_spdx_header_to_file(f, M.get_spdx_headers()))


if __name__ == "__main__":
    unittest.main()

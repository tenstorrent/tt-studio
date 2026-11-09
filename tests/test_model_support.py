# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for fetching the model support spec (tt_setup/model_support.py)."""

import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from dotenv import dotenv_values

from tt_setup import model_support as M

SPEC = {"schema_version": 1, "release_version": "0.22.0", "models": []}


class TestModelSupport(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.cache = os.path.join(self._dir.name, "model_support.json")
        self.source = os.path.join(self._dir.name, "source.json")
        patcher = patch.object(M, "MODEL_SUPPORT_CACHE", self.cache)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._dir.cleanup)

    def _write_source(self, data):
        with open(self.source, "w") as f:
            f.write(data if isinstance(data, str) else json.dumps(data))

    def _fetch(self):
        with patch.object(M, "model_support_url", return_value=self.source):
            return M.fetch_model_support()

    def _refresh(self):
        body = self._fetch()
        return bool(body) and M.save_model_support(body)

    def test_first_fetch_writes_the_cache(self):
        self._write_source(SPEC)
        self.assertTrue(self._refresh())
        self.assertEqual(M.load_model_support(), SPEC)

    def test_fetch_does_not_cache(self):
        self._write_source(SPEC)
        self.assertEqual(json.loads(self._fetch()), SPEC)
        self.assertFalse(os.path.exists(self.cache))

    def test_fetched_spec_sets_the_default_version(self):
        self._write_source(SPEC)
        self._refresh()
        self._write_source({**SPEC, "release_version": "0.23.0"})
        self.assertEqual(M.default_artifact_version(self._fetch()), "v0.23.0")
        self.assertEqual(M.default_artifact_version(), "v0.22.0")

    def test_unchanged_spec_reports_no_change(self):
        self._write_source(SPEC)
        self._refresh()
        self.assertFalse(self._refresh())

    def test_changed_spec_reports_a_change(self):
        self._write_source(SPEC)
        self._refresh()
        self._write_source({**SPEC, "release_version": "0.23.0"})
        self.assertTrue(self._refresh())
        self.assertEqual(M.default_artifact_version(), "v0.23.0")

    def test_fetch_failure_keeps_the_cache(self):
        self._write_source(SPEC)
        self._refresh()
        os.remove(self.source)
        self.assertFalse(self._refresh())
        self.assertEqual(M.load_model_support(), SPEC)

    def test_invalid_spec_is_not_cached(self):
        self._write_source({"models": []})
        self.assertFalse(self._refresh())
        self.assertIsNone(M.load_model_support())

    def test_malformed_json_is_not_cached(self):
        self._write_source("{not json")
        self.assertFalse(self._refresh())
        self.assertFalse(os.path.exists(self.cache))

    def test_no_cache_falls_back_to_the_catalog_release(self):
        catalog = os.path.join(self._dir.name, "catalog.json")
        with patch.object(M, "CATALOG_PATH", catalog):
            self.assertIsNone(M.default_artifact_version())
            with open(catalog, "w") as f:
                json.dump({"source": {"model_support_release": "0.21.0"}}, f)
            self.assertEqual(M.default_artifact_version(), "v0.21.0")

    def test_env_overrides_env_default(self):
        with patch.object(M, "get_env_var", return_value="file:///tmp/spec.json"):
            self.assertEqual(M.model_support_url(), "file:///tmp/spec.json")

    def test_url_falls_back_to_env_default(self):
        env_default = os.path.join(self._dir.name, ".env.default")
        with open(env_default, "w") as f:
            f.write("TT_MODEL_SUPPORT_URL=https://example.com/spec.json\n")
        with (
            patch.object(M, "get_env_var", return_value=""),
            patch.object(M, "ENV_FILE_DEFAULT", env_default),
        ):
            self.assertEqual(M.model_support_url(), "https://example.com/spec.json")

    def test_no_url_keeps_the_cache_untouched(self):
        with patch.object(M, "model_support_url", return_value=""):
            self.assertIsNone(M.fetch_model_support())
        self.assertFalse(os.path.exists(self.cache))

    def test_env_default_ships_a_url(self):
        url = dotenv_values(M.ENV_FILE_DEFAULT).get("TT_MODEL_SUPPORT_URL") or ""
        self.assertTrue(url.startswith("https://"))


class TestEnrichCommunityCatalog(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.python = os.path.join(self._dir.name, "python")
        self.out = os.path.join(self._dir.name, "community_catalog_enriched.json")
        for name, value in (
            ("COMMUNITY_CATALOG_CACHE", os.path.join(self._dir.name, "missing.json")),
            ("COMMUNITY_CATALOG_ENRICHED", self.out),
        ):
            patcher = patch.object(M, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _run(self, returncode=0, stderr=""):
        done = MagicMock(returncode=returncode, stderr=stderr)
        with patch("tt_setup.model_manager.model_manager_python", return_value=self.python), \
                patch.object(M.subprocess, "run", return_value=done) as run:
            return M.enrich_community_catalog(), run

    def test_without_the_artifact_it_does_nothing(self):
        ok, run = self._run()
        self.assertFalse(ok)
        run.assert_not_called()

    def test_enriches_the_bundled_catalog_when_nothing_was_fetched(self):
        open(self.python, "w").close()
        ok, run = self._run()
        self.assertTrue(ok)
        cmd = run.call_args.args[0]
        self.assertEqual(cmd[cmd.index("--catalog") + 1], M.COMMUNITY_CATALOG_BUNDLED)
        self.assertEqual(cmd[cmd.index("--out") + 1], self.out)
        self.assertEqual(cmd[cmd.index("--previous") + 1], M.COMMUNITY_CATALOG_BUNDLED)

    def test_runner_failure_is_not_fatal(self):
        open(self.python, "w").close()
        ok, _ = self._run(returncode=1, stderr="boom\n")
        self.assertFalse(ok)


class TestListSource(unittest.TestCase):
    def test_each_list_reports_its_own_source(self):
        with patch.dict(M.LIST_SOURCE, {M.MODEL_SUPPORT_CACHE: "live"}, clear=True):
            self.assertIn("live", M.describe_list_source())
            self.assertIn("bundled community catalog", M.describe_community_source())


class TestRefreshCommunityCatalog(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.cache = os.path.join(self._dir.name, "community_catalog.json")
        self.bundled = os.path.join(self._dir.name, "community_catalog_bundled.json")
        self.source = os.path.join(self._dir.name, "source.json")

        # Seed bundled baseline with 50 bundles
        with open(self.bundled, "w") as f:
            json.dump({"schema_version": 1, "bundles": [{"repo": f"bundled/{i}"} for i in range(50)]}, f)

        patchers = [
            patch.object(M, "COMMUNITY_CATALOG_CACHE", self.cache),
            patch.object(M, "COMMUNITY_CATALOG_BUNDLED", self.bundled),
            patch.object(M, "community_catalog_url", return_value=self.source),
        ]
        for p in patchers:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self._dir.cleanup)

    def _write_source(self, data):
        with open(self.source, "w") as f:
            f.write(data if isinstance(data, str) else json.dumps(data))

    def _seed_cache(self, count):
        with open(self.cache, "w") as f:
            json.dump({"schema_version": 1, "bundles": [{"repo": f"cached/{i}"} for i in range(count)]}, f)

    def _read_cache(self):
        with open(self.cache) as f:
            return json.load(f)

    def test_empty_catalog_is_rejected_and_keeps_cache(self):
        self._seed_cache(20)
        self._write_source({"schema_version": 1, "bundles": []})
        self.assertFalse(M.refresh_community_catalog())
        cached = self._read_cache()
        self.assertEqual(len(cached["bundles"]), 20)
        self.assertEqual(M.LIST_SOURCE.get(self.cache), "cached")

    def test_sharply_smaller_catalog_is_rejected_and_keeps_cache(self):
        self._seed_cache(50)
        # 2 bundles is well below 20% of 50 (min expected 10)
        self._write_source({"schema_version": 1, "bundles": [{"repo": "m/0"}, {"repo": "m/1"}]})
        self.assertFalse(M.refresh_community_catalog())
        cached = self._read_cache()
        self.assertEqual(len(cached["bundles"]), 50)
        self.assertEqual(M.LIST_SOURCE.get(self.cache), "cached")

    def test_valid_catalog_at_or_above_threshold_is_accepted(self):
        self._seed_cache(50)
        # 15 bundles is >= 20% of 50
        self._write_source({"schema_version": 1, "bundles": [{"repo": f"new/{i}"} for i in range(15)]})
        self.assertTrue(M.refresh_community_catalog())
        cached = self._read_cache()
        self.assertEqual(len(cached["bundles"]), 15)
        self.assertEqual(M.LIST_SOURCE.get(self.cache), "live")

    def test_empty_cache_is_invalid_for_load(self):
        with open(self.cache, "w") as f:
            json.dump({"schema_version": 1, "bundles": []}, f)
        self.assertIsNone(M._load(self.cache, M._is_valid_community_catalog))


if __name__ == "__main__":
    unittest.main()

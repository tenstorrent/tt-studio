# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the PyPI shim (packaging/pypi): update decision table, release
lookup tolerance, and shim-flag splitting. The shim isn't installed by the
root package, so import it straight from its source tree."""
import io
import json
import os
import sys
import unittest
from unittest.mock import patch

_SHIM_SRC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "packaging", "pypi", "src",
)
sys.path.insert(0, _SHIM_SRC)

from tt_studio import shim  # noqa: E402


class TestPlanAction(unittest.TestCase):
    def _plan(self, exists=True, managed=True, on_branch=False,
              current="v2.9.0", target="v2.10.0", no_update=False):
        return shim.plan_action(exists, managed, on_branch, current, target, no_update)

    def test_first_run_clones(self):
        self.assertEqual(self._plan(exists=False), "clone")

    def test_first_run_clones_even_offline(self):
        # main() turns this into a hard error when no tag is known; the plan
        # itself still says clone.
        self.assertEqual(self._plan(exists=False, current=None, target=None), "clone")

    def test_behind_updates(self):
        self.assertEqual(self._plan(), "update")

    def test_up_to_date_runs(self):
        self.assertEqual(self._plan(current="v2.10.0"), "run")

    def test_offline_runs_installed_version(self):
        self.assertEqual(self._plan(target=None), "run")

    def test_no_update_flag_runs(self):
        self.assertEqual(self._plan(no_update=True), "run")

    def test_unmanaged_checkout_is_never_mutated(self):
        self.assertEqual(self._plan(managed=False), "run")

    def test_branch_checkout_pauses_auto_update(self):
        self.assertEqual(self._plan(on_branch=True, current=None), "run")

    def test_pinned_older_than_latest_updates_to_pin(self):
        # Caller passes the pin as target: current newer/other than pin → update.
        self.assertEqual(self._plan(current="v2.10.0", target="v2.8.0"), "update")


class TestFetchLatestReleaseTag(unittest.TestCase):
    def _resp(self, payload: bytes):
        class _Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return _Resp(payload)

    def test_success(self):
        body = json.dumps({"tag_name": "v2.10.0"}).encode()
        with patch.object(shim.urllib.request, "urlopen", return_value=self._resp(body)):
            self.assertEqual(shim.fetch_latest_release_tag(), "v2.10.0")

    def test_network_error_returns_none(self):
        with patch.object(shim.urllib.request, "urlopen", side_effect=OSError("down")):
            self.assertIsNone(shim.fetch_latest_release_tag())

    def test_rate_limit_403_returns_none(self):
        err = shim.urllib.error.HTTPError("u", 403, "rate limited", {}, None)
        with patch.object(shim.urllib.request, "urlopen", side_effect=err):
            self.assertIsNone(shim.fetch_latest_release_tag())

    def test_malformed_json_returns_none(self):
        with patch.object(shim.urllib.request, "urlopen", return_value=self._resp(b"not json")):
            self.assertIsNone(shim.fetch_latest_release_tag())

    def test_missing_tag_name_returns_none(self):
        with patch.object(shim.urllib.request, "urlopen", return_value=self._resp(b"{}")):
            self.assertIsNone(shim.fetch_latest_release_tag())


class TestSplitShimArgs(unittest.TestCase):
    def test_passthrough_preserved_in_order(self):
        opts, rest = shim.split_shim_args(["--dev", "--no-update", "--logs"])
        self.assertTrue(opts["no_update"])
        self.assertEqual(rest, ["--dev", "--logs"])

    def test_pin_consumes_value(self):
        opts, rest = shim.split_shim_args(["--pin", "v2.9.0", "--stop"])
        self.assertEqual(opts["pin"], "v2.9.0")
        self.assertEqual(rest, ["--stop"])

    def test_pin_equals_form(self):
        opts, rest = shim.split_shim_args(["--pin=v2.9.0"])
        self.assertEqual(opts["pin"], "v2.9.0")
        self.assertEqual(rest, [])

    def test_pin_without_value_errors(self):
        with self.assertRaises(SystemExit):
            shim.split_shim_args(["--pin"])

    def test_shim_version_flag(self):
        opts, rest = shim.split_shim_args(["--shim-version"])
        self.assertTrue(opts["shim_version"])
        self.assertEqual(rest, [])

    def test_no_shim_flags_forwards_everything(self):
        opts, rest = shim.split_shim_args(["--switch", "v2.9.0"])
        self.assertEqual(opts, {"no_update": False, "pin": None, "shim_version": False})
        self.assertEqual(rest, ["--switch", "v2.9.0"])


class TestPinFile(unittest.TestCase):
    def test_write_read_and_clear(self):
        import tempfile

        with tempfile.TemporaryDirectory() as home:
            self.assertIsNone(shim.read_pin(home))
            shim.write_pin(home, "v2.9.0")
            self.assertEqual(shim.read_pin(home), "v2.9.0")
            shim.write_pin(home, None)
            self.assertIsNone(shim.read_pin(home))
            shim.write_pin(home, None)  # idempotent when absent


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for pip-install mode: root resolution, bundle staging, version mapping,
and the launcher's pip-mode fallbacks for git-dependent features."""

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

from tt_setup import install_mode as M


def _write(path, text=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def _read(path):
    with open(path) as f:
        return f.read()


class _TempCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = tmp.name
        self.bundle = os.path.join(self.tmp, "bundle")
        self.root = os.path.join(self.tmp, "home", ".tt-studio")

    def make_bundle(self, files):
        for rel, text in files.items():
            _write(os.path.join(self.bundle, rel), text)


class TestModeDetection(unittest.TestCase):
    def test_source_checkout_is_not_a_pip_install(self):
        # The repo never contains tt_setup/_bundle; only the wheel does.
        self.assertFalse(M.is_pip_install())
        self.assertEqual(M.resolve_root(), os.getcwd())
        self.assertEqual(M.launch_cmd(), "python run.py")

    def test_bundle_dir_means_pip_install(self):
        with tempfile.TemporaryDirectory() as d, patch.object(
            M, "BUNDLE_DIR", d
        ), patch.dict(os.environ, {"TT_STUDIO_HOME": "/srv/tts"}):
            self.assertTrue(M.is_pip_install())
            self.assertEqual(M.resolve_root(), "/srv/tts")
            self.assertEqual(M.launch_cmd(), "tt-studio")


class TestDataRoot(unittest.TestCase):
    def test_default_is_dot_tt_studio_in_home(self):
        with patch.dict(os.environ, {"TT_STUDIO_HOME": ""}):
            self.assertEqual(
                M.data_root(), os.path.join(os.path.expanduser("~"), ".tt-studio")
            )

    def test_tt_studio_home_override_is_expanded(self):
        with patch.dict(os.environ, {"TT_STUDIO_HOME": "~/elsewhere"}):
            self.assertEqual(
                M.data_root(), os.path.join(os.path.expanduser("~"), "elsewhere")
            )


class TestVersionMapping(unittest.TestCase):
    def test_release_versions_map_to_tags(self):
        self.assertEqual(M.release_tag("2.12.0"), "v2.12.0")
        # Pre-releases map back to the hyphenated git tag the images use.
        self.assertEqual(M.release_tag("2.12.0rc1"), "v2.12.0-rc1")

    def test_dev_and_local_builds_have_no_release_tag(self):
        for v in ("2.12.1.dev3+g0f1947b", "0.0.0+dev.test.build", "2.12.0+local", ""):
            self.assertEqual(M.release_tag(v), "", v)

    def test_image_tag(self):
        self.assertEqual(M.image_tag("2.12.0"), "v2.12.0")
        self.assertEqual(M.image_tag("2.12.0rc1"), "v2.12.0-rc1")
        # Never-published but valid Docker tag: '+' isn't allowed in tags.
        self.assertEqual(M.image_tag("2.12.1.dev3+g0f1947b"), "v2.12.1.dev3-g0f1947b")


class TestStageBundle(_TempCase):
    BUNDLE_V1 = {
        "app/docker-compose.yml": "compose v1",
        "app/backend/old_module.py": "old",
        "app/backend/gone/only.py": "gone",
        ".env.default": "A=1",
    }

    def test_fresh_install_copies_bundle_and_writes_marker(self):
        self.make_bundle(self.BUNDLE_V1)
        previous, changed = M.stage_bundle(self.root, self.bundle, "2.11.0")
        self.assertEqual((previous, changed), (None, True))
        self.assertEqual(
            _read(os.path.join(self.root, "app", "docker-compose.yml")), "compose v1"
        )
        marker = M.read_marker(self.root)
        self.assertEqual(marker["version"], "2.11.0")
        self.assertIn(".env.default", marker["files"])

    def test_same_version_is_a_no_op(self):
        self.make_bundle(self.BUNDLE_V1)
        M.stage_bundle(self.root, self.bundle, "2.11.0")
        _write(os.path.join(self.root, "app", "docker-compose.yml"), "edited")
        self.assertEqual(
            M.stage_bundle(self.root, self.bundle, "2.11.0"), ("2.11.0", False)
        )
        self.assertEqual(
            _read(os.path.join(self.root, "app", "docker-compose.yml")), "edited"
        )

    def test_upgrade_replaces_code_drops_stale_files_and_keeps_user_state(self):
        self.make_bundle(self.BUNDLE_V1)
        M.stage_bundle(self.root, self.bundle, "2.11.0")
        user_state = {
            ".env": "HF_TOKEN=secret",
            "logs/startup.log": "log",
            "app/backend/db.sqlite3": "db",
            "inference-api/.venv/bin/python": "venv",
        }
        for rel, text in user_state.items():
            _write(os.path.join(self.root, rel), text)

        new_bundle = os.path.join(self.tmp, "bundle2")
        for rel, text in {
            "app/docker-compose.yml": "compose v2",
            ".env.default": "A=2",
        }.items():
            _write(os.path.join(new_bundle, rel), text)
        self.assertEqual(
            M.stage_bundle(self.root, new_bundle, "2.12.0"), ("2.11.0", True)
        )

        self.assertEqual(
            _read(os.path.join(self.root, "app", "docker-compose.yml")), "compose v2"
        )
        self.assertFalse(
            os.path.exists(os.path.join(self.root, "app", "backend", "old_module.py"))
        )
        self.assertFalse(
            os.path.exists(os.path.join(self.root, "app", "backend", "gone"))
        )
        for rel, text in user_state.items():
            self.assertEqual(_read(os.path.join(self.root, rel)), text, rel)
        self.assertEqual(M.read_marker(self.root)["version"], "2.12.0")

    def test_restages_when_app_files_were_deleted(self):
        self.make_bundle(self.BUNDLE_V1)
        M.stage_bundle(self.root, self.bundle, "2.11.0")
        os.remove(os.path.join(self.root, "app", "docker-compose.yml"))
        self.assertEqual(
            M.stage_bundle(self.root, self.bundle, "2.11.0"), ("2.11.0", True)
        )
        self.assertTrue(
            os.path.exists(os.path.join(self.root, "app", "docker-compose.yml"))
        )

    def test_pycache_in_the_bundle_is_not_staged(self):
        self.make_bundle(
            {**self.BUNDLE_V1, "app/backend/__pycache__/x.cpython-312.pyc": "bytes"}
        )
        M.stage_bundle(self.root, self.bundle, "2.11.0")
        self.assertFalse(
            os.path.exists(os.path.join(self.root, "app", "backend", "__pycache__"))
        )

    def test_stale_paths_outside_root_are_ignored(self):
        self.make_bundle(self.BUNDLE_V1)
        M.stage_bundle(self.root, self.bundle, "2.11.0")
        outside = os.path.join(self.tmp, "keep.txt")
        _write(outside, "mine")
        marker = M.read_marker(self.root)
        marker["files"].append(os.path.join("..", "..", "keep.txt"))
        with open(os.path.join(self.root, M.MARKER_NAME), "w") as f:
            json.dump(marker, f)
        M.stage_bundle(self.root, self.bundle, "2.12.0")
        self.assertTrue(os.path.exists(outside))

    def test_bundle_without_app_files_is_an_error(self):
        self.make_bundle({".env.default": "A=1"})
        with self.assertRaises(M.InstallError):
            M.stage_bundle(self.root, self.bundle, "2.11.0")


class TestRootOwnership(_TempCase):
    def setUp(self):
        super().setUp()
        self.make_bundle(TestStageBundle.BUNDLE_V1)

    def test_empty_existing_folder_is_accepted(self):
        os.makedirs(self.root)
        self.assertEqual(M.stage_bundle(self.root, self.bundle, "2.11.0"), (None, True))

    def test_interrupted_first_install_is_resumed(self):
        with patch.object(M.shutil, "copy2", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                M.stage_bundle(self.root, self.bundle, "2.11.0")
        self.assertEqual(M.stage_bundle(self.root, self.bundle, "2.11.0"), (None, True))
        self.assertEqual(M.read_marker(self.root)["version"], "2.11.0")

    def test_folder_with_foreign_files_is_refused(self):
        _write(os.path.join(self.root, "notes.txt"), "mine")
        with self.assertRaises(M.InstallError) as ctx:
            M.stage_bundle(self.root, self.bundle, "2.11.0")
        self.assertIn("TT_STUDIO_HOME", str(ctx.exception))
        self.assertFalse(os.path.exists(os.path.join(self.root, "app")))

    def test_git_checkout_is_refused(self):
        os.makedirs(os.path.join(self.root, ".git"))
        with self.assertRaises(M.InstallError) as ctx:
            M.stage_bundle(self.root, self.bundle, "2.11.0")
        self.assertIn("git checkout", str(ctx.exception))

    def test_a_file_in_place_of_the_root_is_refused(self):
        _write(self.root, "not a folder")
        with self.assertRaises(M.InstallError):
            M.stage_bundle(self.root, self.bundle, "2.11.0")


class TestMain(_TempCase):
    def setUp(self):
        super().setUp()
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        self.make_bundle(TestStageBundle.BUNDLE_V1)

    def _main(self):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(M, "BUNDLE_DIR", self.bundle), patch.object(
            M, "package_version", return_value="2.12.0"
        ), patch.dict(os.environ, {"TT_STUDIO_HOME": self.root}), patch(
            "tt_setup.cli.main"
        ) as cli_main, redirect_stdout(out), redirect_stderr(err):
            try:
                M.main()
                code = 0
            except SystemExit as e:
                code = e.code
        return code, out.getvalue(), err.getvalue(), cli_main

    def test_stages_then_runs_the_launcher_from_the_root(self):
        code, out, _, cli_main = self._main()
        self.assertEqual(code, 0)
        self.assertIn("installed 2.12.0", out)
        cli_main.assert_called_once()
        self.assertEqual(os.path.realpath(os.getcwd()), os.path.realpath(self.root))

    def test_second_launch_is_quiet(self):
        self._main()
        code, out, _, _ = self._main()
        self.assertEqual((code, out), (0, ""))

    def test_refused_root_exits_with_the_reason(self):
        _write(os.path.join(self.root, "notes.txt"), "mine")
        code, _, err, cli_main = self._main()
        self.assertEqual(code, 1)
        self.assertIn("didn't create", err)
        cli_main.assert_not_called()


class TestPypiUpdateCheck(unittest.TestCase):
    def test_update_available(self):
        from tt_setup.startup_checks import pypi_update_available

        self.assertTrue(pypi_update_available("2.12.0", "2.13.0"))
        self.assertTrue(pypi_update_available("2.12.0", "2.12.1"))
        self.assertFalse(pypi_update_available("2.12.0", "2.12.0"))
        self.assertFalse(pypi_update_available("2.13.0", "2.12.0"))
        # A dev build of the next release is not behind the current one.
        self.assertFalse(pypi_update_available("2.12.1.dev3+g0f1947b", "2.12.0"))
        self.assertFalse(pypi_update_available("", "2.12.0"))
        self.assertFalse(pypi_update_available("2.12.0", "garbage"))

    def test_pip_mode_checks_pypi_and_never_blocks_or_runs_git(self):
        from tt_setup import startup_checks as S

        with patch.object(M, "is_pip_install", return_value=True), patch.object(
            M, "package_version", return_value="2.12.0"
        ), patch.object(S, "_fetch_pypi_latest", return_value="2.13.0"), patch.object(
            S.subprocess, "run", side_effect=AssertionError("git called")
        ), patch.object(S, "console"):
            result = S.check_startup_freshness("/nowhere", lambda *a, **k: "")
        self.assertTrue(result["tt_studio_behind"])
        self.assertFalse(result["tt_studio_blocks_startup"])


class TestPipModeFallbacks(unittest.TestCase):
    def setUp(self):
        p = patch.object(M, "is_pip_install", return_value=True)
        p.start()
        self.addCleanup(p.stop)

    def test_app_tree_is_never_dirty(self):
        from tt_setup import image_source

        with patch.object(
            image_source.subprocess, "run", side_effect=AssertionError("git called")
        ):
            self.assertFalse(image_source.is_worktree_dirty())

    def test_version_env_uses_the_package_version(self):
        from tt_setup.env_config import _version

        written = {}
        with patch.object(M, "package_version", return_value="2.12.0"), patch.object(
            _version, "write_env_var", side_effect=written.__setitem__
        ), patch.object(_version, "console"):
            _version.set_app_version_env()
        self.assertEqual(
            written,
            {
                "VITE_APP_VERSION": "v2.12.0",
                "VITE_APP_GIT_BRANCH": "",
                "TT_STUDIO_IMAGE_TAG": "v2.12.0",
            },
        )

    def test_dev_wheel_gets_an_unpublished_image_tag(self):
        from tt_setup.env_config import _version

        written = {}
        with patch.object(
            M, "package_version", return_value="2.12.1.dev3+g0f1947b"
        ), patch.object(
            _version, "write_env_var", side_effect=written.__setitem__
        ), patch.object(_version, "console"):
            _version.set_app_version_env()
        self.assertEqual(written["VITE_APP_VERSION"], "")
        self.assertEqual(written["VITE_APP_GIT_BRANCH"], "2.12.1.dev3+g0f1947b")
        self.assertEqual(written["TT_STUDIO_IMAGE_TAG"], "v2.12.1.dev3-g0f1947b")

    def test_checkout_only_flags_are_refused(self):
        from tt_setup.cli import _run as R
        from tt_setup.cli._args import _build_args

        for overrides, flag in (
            ({"dev": True}, "--dev"),
            ({"switch": "v2.9.0"}, "--switch"),
            ({"make_rc_branch": "minor"}, "--make-rc-branch"),
            ({"check_headers": True}, "--check-headers"),
        ):
            args = _build_args(**overrides)
            self.assertEqual(R._checkout_only_flag(args), flag)
            with patch.object(R, "console") as con, self.assertRaises(
                SystemExit
            ) as ctx:
                R._run(args)
            self.assertEqual(ctx.exception.code, 1)
            con.print.assert_called_once()

    def test_everyday_flags_are_not_checkout_only(self):
        from tt_setup.cli import _run as R
        from tt_setup.cli._args import _build_args

        self.assertIsNone(R._checkout_only_flag(_build_args(cleanup=True, info=True)))

    def test_uninstall_removes_only_a_marked_install_folder(self):
        from tt_setup.cli import _run as R

        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        with tempfile.TemporaryDirectory() as d:
            marked, foreign = os.path.join(d, "marked"), os.path.join(d, "foreign")
            _write(os.path.join(marked, M.MARKER_NAME), "{}")
            _write(os.path.join(marked, "app", "docker-compose.yml"))
            _write(os.path.join(foreign, "notes.txt"))
            for root in (marked, foreign):
                with patch.object(R, "TT_STUDIO_ROOT", root), patch.object(
                    R, "console"
                ):
                    R._finish_pip_uninstall()
            self.assertFalse(os.path.exists(marked))
            self.assertTrue(os.path.exists(os.path.join(foreign, "notes.txt")))

    def test_install_shortcut_is_a_no_op(self):
        from tt_setup import shortcut

        with patch.object(
            shortcut, "_write_shortcut_block", side_effect=AssertionError("rc touched")
        ), patch.object(shortcut, "console"):
            self.assertTrue(shortcut.install_shortcut())
            self.assertIsNone(shortcut.maybe_offer_shortcut(None))
            self.assertIsNone(shortcut.maybe_repair_shortcut())


class TestVersionFlag(unittest.TestCase):
    def test_version_flag_prints_and_exits(self):
        from tt_setup.cli._args import app
        from typer.testing import CliRunner

        with patch.object(M, "studio_version", return_value="2.12.0"):
            result = CliRunner().invoke(app, ["--version"])
        self.assertEqual(result.exit_code, 0)
        self.assertEqual(result.output.strip(), "tt-studio 2.12.0")


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the Typer CLI: parsing, help, and dispatch (logic mocked)."""
import json
import os
import tempfile
import types
import re
import unittest
from unittest.mock import patch

import typer
from typer.testing import CliRunner

from tt_setup import cli as M
# Dispatch (cleanup_resources / fix_docker_issues) now lives in the _run submodule;
# patches must target it so _run's calls are intercepted.
try:
    from tt_setup.cli import _run as _cli_run
except ImportError:
    _cli_run = M
# The `run` subcommand + `_validate_model_name` + the `_run` handoff live in _args;
# patch there so the run-command tests don't touch the real orchestration/catalog.
try:
    from tt_setup.cli import _args as _cli_args
except ImportError:
    _cli_args = M

runner = CliRunner()


class TestCli(unittest.TestCase):
    def test_help_lists_flags(self):
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        output_without_ansi = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
        for flag in ("--dev", "--stop", "--purge-all", "--help-env", "--no-sudo",
                     "--logs", "--info", "--auto-deploy", "--headless"):
            self.assertIn(flag, output_without_ansi)

    def test_info_flag_dispatches_to_ready_panel(self):
        with patch.object(_cli_run, "show_ready_panel") as ready:
            result = runner.invoke(M.app, ["--info"])
        self.assertEqual(result.exit_code, 0)
        ready.assert_called_once()

    def test_qb2_defaults_false_and_honors_true(self):
        # IS_QB2 is opt-in: unset defaults to false so the strict QB2 check only
        # runs when a QB2 machine (or the tt_qb2_launch release branch) opts in.
        with patch.object(_cli_run, "get_env_var", side_effect=lambda name, default="": default):
            self.assertFalse(_cli_run._qb2_configured())
        with patch.object(_cli_run, "get_env_var", side_effect=lambda name, default="": "true"):
            self.assertTrue(_cli_run._qb2_configured())
        with patch.object(_cli_run, "get_env_var", side_effect=lambda name, default="": "false"):
            self.assertFalse(_cli_run._qb2_configured())

    def test_help_hides_deprecated_aliases(self):
        # --cleanup/--cleanup-all and --fix-docker still work but must not clutter --help.
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        self.assertNotIn("--cleanup", result.output)
        self.assertNotIn("--fix-docker", result.output)

    def test_unknown_flag_errors(self):
        result = runner.invoke(M.app, ["--definitely-not-a-flag"])
        self.assertEqual(result.exit_code, 2)

    def test_help_env_prints_and_exits_zero(self):
        # --help-env prints the env help and returns (no heavy setup runs).
        result = runner.invoke(M.app, ["--help-env"])
        self.assertEqual(result.exit_code, 0)
        self.assertIn("Environment Variables Help", result.output)

    def test_stop_flag_dispatches_to_cleanup_resources(self):
        with patch.object(_cli_run, "cleanup_resources") as cleanup:
            result = runner.invoke(M.app, ["--stop"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        # --stop is the plain teardown: cleanup=True, no full purge.
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup)
        self.assertFalse(ns.cleanup_all)

    def test_purge_all_flag_dispatches_to_cleanup_resources(self):
        with patch.object(_cli_run, "cleanup_resources") as cleanup:
            result = runner.invoke(M.app, ["--purge-all"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        # --purge-all is the full reset; it also implies the stop trigger.
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup_all)
        self.assertTrue(ns.cleanup)

    def test_deprecated_cleanup_alias_still_works_and_warns(self):
        with patch.object(_cli_run, "cleanup_resources") as cleanup:
            result = runner.invoke(M.app, ["--cleanup"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup)
        self.assertFalse(ns.cleanup_all)
        self.assertIn("deprecated", result.output)
        self.assertIn("--stop", result.output)

    def test_deprecated_cleanup_all_alias_still_works_and_warns(self):
        with patch.object(_cli_run, "cleanup_resources") as cleanup:
            result = runner.invoke(M.app, ["--cleanup-all"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup_all)
        self.assertIn("deprecated", result.output)
        self.assertIn("--purge-all", result.output)

    def test_fix_docker_flag_dispatches(self):
        with patch.object(_cli_run, "fix_docker_issues", return_value=True) as fix:
            result = runner.invoke(M.app, ["--fix-docker"])
        fix.assert_called_once()
        self.assertEqual(result.exit_code, 0)

    def test_help_removes_completion_options(self):
        # add_completion=False drops the Typer-injected completion noise.
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        self.assertNotIn("--install-completion", result.output)
        self.assertNotIn("--show-completion", result.output)

    def test_help_groups_flags_into_panels(self):
        # Flags are cascaded into titled rich_help_panel sections, not one box.
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        for panel in (
            "Setup & Configuration",
            "Model Deployment",
            "Lifecycle",
            "Reset (--purge-all)",
            "Advanced",
            "Developer Tools",
            "Troubleshooting & Info",
        ):
            self.assertIn(panel, result.output)
        # Service-control flags live under Advanced now, not their own panel.
        self.assertNotIn("Service Control", result.output)

    def test_run_help_shows_model_arg_and_options(self):
        result = runner.invoke(M.app, ["run", "--help"])
        self.assertEqual(result.exit_code, 0)
        # Strip ANSI: Rich interleaves color codes between characters when it
        # forces color (e.g. in CI), splitting "--headless" across escapes.
        output_without_ansi = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
        self.assertIn("MODEL_NAME", output_without_ansi)
        self.assertIn("--headless", output_without_ansi)

    def test_run_dispatches_browser_by_default(self):
        with patch.object(_cli_args, "_validate_model_name"), \
             patch.object(_cli_args, "_run") as run:
            result = runner.invoke(M.app, ["run", "Qwen3-32B"])
        self.assertEqual(result.exit_code, 0)
        # The callback guard must stop the default setup from also running.
        run.assert_called_once()
        ns = run.call_args[0][0]
        self.assertEqual(ns.auto_deploy, "Qwen3-32B")
        self.assertFalse(ns.headless)        # UI-driven (web UI) by default
        self.assertIsNone(ns.device_id)      # unset -> backend allocates by model

    def test_run_headless_and_device_id(self):
        with patch.object(_cli_args, "_validate_model_name"), \
             patch.object(_cli_args, "_run") as run:
            result = runner.invoke(
                M.app, ["run", "Qwen3-32B", "--headless", "--device-id", "2"])
        self.assertEqual(result.exit_code, 0)
        ns = run.call_args[0][0]
        self.assertTrue(ns.headless)
        self.assertEqual(ns.device_id, 2)

    def test_model_alias_sets_auto_deploy(self):
        # `--model` is a friendly alias for `--auto-deploy` on the default path.
        for flag in ("--auto-deploy", "--model"):
            with patch.object(_cli_args, "_validate_model_name"), \
                 patch.object(_cli_args, "_run") as run:
                result = runner.invoke(M.app, [flag, "Qwen3-32B"])
            self.assertEqual(result.exit_code, 0, flag)
            self.assertEqual(run.call_args[0][0].auto_deploy, "Qwen3-32B", flag)

    def test_run_prompts_for_model_when_omitted(self):
        # No MODEL_NAME -> interactive picker supplies it, then deploy proceeds.
        with patch.object(_cli_args, "_prompt_for_model", return_value="Qwen3-32B") as pick, \
             patch.object(_cli_args, "_validate_model_name"), \
             patch.object(_cli_args, "_run") as run:
            result = runner.invoke(M.app, ["run"])
        self.assertEqual(result.exit_code, 0)
        pick.assert_called_once()
        self.assertEqual(run.call_args[0][0].auto_deploy, "Qwen3-32B")

    def test_bare_invocation_still_runs_default_setup(self):
        # The subcommand guard must not break the no-subcommand default path.
        with patch.object(_cli_args, "_run") as run:
            result = runner.invoke(M.app, [])
        self.assertEqual(result.exit_code, 0)
        run.assert_called_once()
        self.assertIsNone(run.call_args[0][0].auto_deploy)

    def test_main_is_callable_entrypoint(self):
        self.assertTrue(callable(M.main))


class TestBuildArgs(unittest.TestCase):
    """_build_args is the single source of truth for the args namespace shared by
    the default callback and the `run` subcommand."""

    def test_defaults(self):
        ns = _cli_args._build_args()
        self.assertIsNone(ns.auto_deploy)
        self.assertIsNone(ns.device_id)
        self.assertFalse(ns.headless)
        self.assertFalse(ns.cleanup)
        self.assertFalse(ns.cleanup_all)
        self.assertEqual(ns.browser_timeout, 60)

    def test_overrides_apply_and_leave_others_default(self):
        ns = _cli_args._build_args(auto_deploy="Model-X", device_id=3, headless=True)
        self.assertEqual(ns.auto_deploy, "Model-X")
        self.assertEqual(ns.device_id, 3)
        self.assertTrue(ns.headless)
        self.assertFalse(ns.dev)  # untouched field keeps its default

    def test_field_set_matches_entry_namespace(self):
        # The `run` command and `_entry` must agree on the field set, else _run
        # hits an AttributeError. _build_args is that contract — assert it carries
        # every field _run reads.
        ns = _cli_args._build_args()
        for field in ("dev", "cleanup", "cleanup_all", "auto_deploy", "device_id",
                      "headless", "no_browser", "skip_fastapi", "wait_for_services"):
            self.assertTrue(hasattr(ns, field), f"missing field: {field}")


class TestPromptForModel(unittest.TestCase):
    CATALOG = [
        {"name": "Qwen3-32B", "group": "LLM", "boards": ["P300x2", "T3K"]},
        {"name": "Llama-3.1-8B-Instruct", "group": "LLM", "boards": ["N150"]},
        {"name": "FLUX.1-dev", "group": "IMAGE", "boards": ["P300x2"]},
        {"name": "whisper-large-v3", "group": "AUDIO", "boards": ["N150"]},
    ]

    def test_filters_to_detected_board_and_numbers_across_groups(self):
        # P300x2 shows only Qwen3-32B (LLM) and FLUX.1-dev (IMAGE); numbering runs
        # continuously in group order (LLM before IMAGE), so #2 is FLUX.1-dev.
        with patch.object(_cli_args, "_catalog_models", return_value=self.CATALOG), \
             patch.object(_cli_args, "_detect_board", return_value="P300x2"), \
             patch.object(_cli_args.typer, "prompt", return_value="2"):
            self.assertEqual(_cli_args._prompt_for_model(), "FLUX.1-dev")

    def test_no_board_shows_all_and_accepts_name(self):
        with patch.object(_cli_args, "_catalog_models", return_value=self.CATALOG), \
             patch.object(_cli_args, "_detect_board", return_value=""), \
             patch.object(_cli_args.typer, "prompt", return_value="whisper-large-v3"):
            self.assertEqual(_cli_args._prompt_for_model(), "whisper-large-v3")

    def test_board_with_no_matches_falls_back_to_all(self):
        # An unknown/incompatible board must not hide everything — show the full list.
        with patch.object(_cli_args, "_catalog_models", return_value=self.CATALOG), \
             patch.object(_cli_args, "_detect_board", return_value="E150"), \
             patch.object(_cli_args.typer, "prompt", return_value="1"):
            # All 4 shown, grouped LLM(2)->IMAGE(1)->AUDIO(1); #1 is a real name.
            self.assertIn(_cli_args._prompt_for_model(), [m["name"] for m in self.CATALOG])


class TestValidateModelName(unittest.TestCase):
    def _catalog_names(self):
        catalog = os.path.join(
            _cli_args.TT_STUDIO_ROOT, "app", "backend", "shared_config",
            "models_from_inference_server.json")
        if not os.path.exists(catalog):
            return None
        with open(catalog) as f:
            return [m.get("model_name") for m in json.load(f).get("models", []) if m.get("model_name")]

    def test_accepts_a_real_catalog_model(self):
        names = self._catalog_names()
        if not names:
            self.skipTest("catalog not synced")
        _cli_args._validate_model_name(names[0])  # must not raise

    def test_rejects_unknown_model(self):
        names = self._catalog_names()
        if not names:
            self.skipTest("catalog not synced")
        with self.assertRaises(typer.Exit):
            _cli_args._validate_model_name("NotARealModel_zzz_9999")

    def test_skips_silently_when_catalog_absent(self):
        # Best-effort: on first run (artifact not fetched) validation is skipped so
        # the live resolve_model_id check can handle it post-startup.
        with tempfile.TemporaryDirectory() as d, \
             patch.object(_cli_args, "TT_STUDIO_ROOT", d):
            _cli_args._validate_model_name("anything-goes")  # must not raise


class TestAutoDeployQuery(unittest.TestCase):
    def test_without_device_id(self):
        q = _cli_run._auto_deploy_query("Qwen3-32B", None)
        self.assertIn("auto-deploy=Qwen3-32B", q)
        self.assertNotIn("device-id", q)

    def test_with_device_id(self):
        q = _cli_run._auto_deploy_query("Qwen3-32B", 2)
        self.assertIn("auto-deploy=Qwen3-32B", q)
        self.assertIn("device-id=2", q)


class _FakeSmokeTestError(Exception):
    pass


def _fake_driver(bodies, resolve_fn=None):
    """A stand-in for ci/deploy_healthcheck.py that records deploy payloads."""
    class FakeClient:
        def __init__(self, base, proxy):
            pass

        def post(self, key, body, timeout=60):
            bodies.append(body)
            return 200, {"status": "success", "job_id": "job-1"}

    def default_resolve(client, name, explicit):
        return "model_ABC"

    return types.SimpleNamespace(
        SmokeTestError=_FakeSmokeTestError,
        Client=FakeClient,
        resolve_model_id=resolve_fn or default_resolve,
        poll_progress=lambda client, job, timeout, interval: None,
    )


class TestHeadlessDeploy(unittest.TestCase):
    def test_omits_device_id_when_unset(self):
        # The headline behavior: no --device-id -> backend allocates by model.
        bodies = []
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B", device_id=None)
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [{"model_id": "model_ABC"}])

    def test_includes_device_id_when_set(self):
        bodies = []
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B", device_id=3)
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [{"model_id": "model_ABC", "device_id": 3}])

    def test_device_id_zero_is_explicit(self):
        # 0 is a real slot, distinct from "unset" — it must reach the payload.
        bodies = []
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B", device_id=0)
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [{"model_id": "model_ABC", "device_id": 0}])

    def test_missing_driver_is_a_noop(self):
        args = _cli_args._build_args(auto_deploy="X")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=None):
            _cli_run._headless_deploy(args)  # must not raise

    def test_unresolved_model_does_not_deploy(self):
        bodies = []

        def boom(client, name, explicit):
            raise _FakeSmokeTestError("no catalog model matches 'X'")

        dh = _fake_driver(bodies, resolve_fn=boom)
        args = _cli_args._build_args(auto_deploy="X")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [])  # a real miss never posts a deploy

    def test_retries_on_backend_warmup_then_succeeds(self):
        bodies = []
        calls = {"n": 0}

        def flaky(client, name, explicit):
            calls["n"] += 1
            if calls["n"] == 1:
                raise _FakeSmokeTestError("cannot reach http://localhost:8000/catalog/")
            return "model_ABC"

        dh = _fake_driver(bodies, resolve_fn=flaky)
        args = _cli_args._build_args(auto_deploy="X")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             patch.object(_cli_run.time, "sleep"):
            _cli_run._headless_deploy(args)
        self.assertEqual(calls["n"], 2)          # retried once past the warmup error
        self.assertEqual(len(bodies), 1)         # then deployed


if __name__ == "__main__":
    unittest.main()

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
    from tt_setup.cli import _deploy as _cli_deploy
    from tt_setup.cli import _stop_model as _cli_stop
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
    def tearDown(self):
        # --no-clear / --verbose set module-global rendering state; reset it so a
        # flag test doesn't leak the globals into later tests.
        from tt_setup import console
        console.set_no_clear(False)
        console.set_verbose(False)

    def test_help_lists_flags(self):
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        output_without_ansi = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
        for flag in ("--dev", "--stop", "--purge-all", "--purge-model", "--help-env",
                     "--no-sudo", "--logs", "--info", "--uninstall", "--switch",
                     "--build-images", "--no-clear", "--auto-deploy", "--browser"):
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

    def test_reconfigure_inference_server_flag_and_alias(self):
        # Both the long flag and the --reconfig-inf alias set the same arg.
        # _run is patched so startup doesn't actually run.
        from tt_setup.cli import _args
        for flag in ("--reconfigure-inference-server", "--reconfig-inf"):
            with patch.object(_args, "_run") as run:
                result = runner.invoke(M.app, [flag])
            self.assertEqual(result.exit_code, 0)
            run.assert_called_once()
            args = run.call_args.args[0]
            self.assertTrue(args.reconfigure_inference_server, flag)

    def test_help_shows_reconfig_inf_alias(self):
        result = runner.invoke(M.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        # Strip ANSI: Rich interleaves color codes between characters when it
        # forces color (e.g. in CI), so match against the de-colored output.
        output_without_ansi = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
        self.assertIn("--reconfig-inf", output_without_ansi)

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
        self.assertIn("--browser", output_without_ansi)
        # Terminal deploy is the default; --headless is a hidden no-op alias.
        self.assertNotIn("--headless", output_without_ansi)

    def test_run_dispatches_terminal_deploy_by_default(self):
        with patch.object(_cli_args, "_validate_model_name"), \
             patch.object(_cli_args, "_run") as run:
            result = runner.invoke(M.app, ["run", "Qwen3-32B"])
        self.assertEqual(result.exit_code, 0)
        # The callback guard must stop the default setup from also running.
        run.assert_called_once()
        ns = run.call_args[0][0]
        self.assertEqual(ns.auto_deploy, "Qwen3-32B")
        self.assertFalse(ns.browser)         # terminal-driven deploy by default
        self.assertIsNone(ns.device_id)      # unset -> backend allocates by model

    def test_run_browser_flag_selects_web_ui_deploy(self):
        with patch.object(_cli_args, "_validate_model_name"), \
             patch.object(_cli_args, "_run") as run:
            result = runner.invoke(M.app, ["run", "Qwen3-32B", "--browser"])
        self.assertEqual(result.exit_code, 0)
        ns = run.call_args[0][0]
        self.assertTrue(ns.browser)

    def test_run_headless_alias_and_device_id(self):
        # --headless is deprecated (hidden) but must still parse for old scripts.
        with patch.object(_cli_args, "_validate_model_name"), \
             patch.object(_cli_args, "_run") as run:
            result = runner.invoke(
                M.app, ["run", "Qwen3-32B", "--headless", "--device-id", "2"])
        self.assertEqual(result.exit_code, 0)
        ns = run.call_args[0][0]
        self.assertTrue(ns.headless)
        self.assertFalse(ns.browser)
        self.assertEqual(ns.device_id, "2")   # kept as a string for multi-chip parity

    def test_run_multi_chip_device_id(self):
        # Multi-chip models take a comma-separated list, e.g. --device-id 0,1.
        with patch.object(_cli_args, "_validate_model_name"), \
             patch.object(_cli_args, "_run") as run:
            result = runner.invoke(
                M.app, ["run", "Llama3.1-8B", "--device-id", "0,1"])
        self.assertEqual(result.exit_code, 0)
        ns = run.call_args[0][0]
        self.assertEqual(ns.device_id, "0,1")

    def test_run_rejects_non_integer_device_id(self):
        with patch.object(_cli_args, "_validate_model_name"), \
             patch.object(_cli_args, "_run") as run:
            result = runner.invoke(
                M.app, ["run", "Qwen3-32B", "--device-id", "abc"])
        self.assertNotEqual(result.exit_code, 0)
        run.assert_not_called()

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

    def test_uninstall_runs_purge_then_removes_shortcut(self):
        with patch.object(_cli_run, "cleanup_resources", return_value=True) as cleanup, \
             patch.object(_cli_run, "uninstall_shortcut") as remove:
            result = runner.invoke(M.app, ["--uninstall"])
        self.assertEqual(result.exit_code, 0)
        cleanup.assert_called_once()
        remove.assert_called_once()
        # --uninstall implies the full purge (and therefore the stop trigger).
        ns = cleanup.call_args[0][0]
        self.assertTrue(ns.cleanup_all)
        self.assertTrue(ns.cleanup)

    def test_uninstall_keeps_shortcut_when_purge_aborted(self):
        # Declining the purge confirmation aborts the whole uninstall.
        with patch.object(_cli_run, "cleanup_resources", return_value=False), \
             patch.object(_cli_run, "uninstall_shortcut") as remove:
            result = runner.invoke(M.app, ["--uninstall"])
        self.assertEqual(result.exit_code, 0)
        remove.assert_not_called()

    def test_switch_dispatches_with_ref(self):
        with patch.object(_cli_run, "switch_checkout", return_value=0) as switch:
            result = runner.invoke(M.app, ["--switch", "v2.9.0-rc1"])
        self.assertEqual(result.exit_code, 0)
        switch.assert_called_once_with("v2.9.0-rc1")

    def test_switch_requires_value(self):
        result = runner.invoke(M.app, ["--switch"])
        self.assertEqual(result.exit_code, 2)

    def test_switch_nonzero_exit_propagates(self):
        with patch.object(_cli_run, "switch_checkout", return_value=1):
            result = runner.invoke(M.app, ["--switch", "dev"])
        self.assertEqual(result.exit_code, 1)

    def test_purge_model_dispatches_with_names(self):
        with patch.object(_cli_run, "purge_models", return_value=0) as purge, \
             patch.object(_cli_run, "cleanup_resources") as cleanup:
            result = runner.invoke(
                M.app, ["--purge-model", "foo", "--purge-model", "bar"])
        self.assertEqual(result.exit_code, 0)
        purge.assert_called_once()
        cleanup.assert_not_called()
        ns = purge.call_args[0][0]
        self.assertEqual(ns.purge_model, ["foo", "bar"])
        # Purging one model is not a stack teardown.
        self.assertFalse(ns.cleanup)
        self.assertFalse(ns.cleanup_all)

    def test_purge_model_nonzero_exit_propagates(self):
        with patch.object(_cli_run, "purge_models", return_value=1):
            result = runner.invoke(M.app, ["--purge-model", "no-such-model"])
        self.assertEqual(result.exit_code, 1)

    def test_purge_model_picker_sentinel_reaches_dispatch(self):
        # main() (not click) supplies the sentinel for a bare --purge-model;
        # here we inject it the way _normalize_purge_model_argv would.
        from tt_setup.constants import _PURGE_MODEL_PICKER
        with patch.object(_cli_run, "purge_models", return_value=0) as purge:
            result = runner.invoke(M.app, ["--purge-model", _PURGE_MODEL_PICKER])
        self.assertEqual(result.exit_code, 0)
        ns = purge.call_args[0][0]
        self.assertEqual(ns.purge_model, [_PURGE_MODEL_PICKER])

    def test_normalize_purge_model_argv(self):
        from tt_setup.cli._args import _normalize_purge_model_argv
        from tt_setup.constants import _PURGE_MODEL_PICKER as P
        cases = [
            # Bare at end → sentinel appended.
            (["--purge-model"], ["--purge-model", P]),
            # Bare before another flag → sentinel inserted, flag preserved.
            (["--purge-model", "-y"], ["--purge-model", P, "-y"]),
            (["--dev", "--purge-model", "--yes"], ["--dev", "--purge-model", P, "--yes"]),
            # With a value (either form) → untouched.
            (["--purge-model", "foo"], ["--purge-model", "foo"]),
            (["--purge-model=foo"], ["--purge-model=foo"]),
            # --stop-model gets the same optional-value treatment.
            (["--stop-model"], ["--stop-model", P]),
            (["--stop-model", "-v"], ["--stop-model", P, "-v"]),
            (["--stop-model", "Qwen3-32B"], ["--stop-model", "Qwen3-32B"]),
            # Not present → untouched.
            (["--stop"], ["--stop"]),
            ([], []),
        ]
        for argv, expected in cases:
            self.assertEqual(_normalize_purge_model_argv(argv), expected, argv)

    def test_no_clear_flag_sets_globals_and_implies_verbose(self):
        # --no-clear preserves the terminal's contents AND streams full detail, so
        # it flips both the no_clear and verbose rendering globals. _run is patched
        # so startup doesn't actually run.
        from tt_setup.cli import _args
        from tt_setup import console
        with patch.object(_args, "_run") as run:
            result = runner.invoke(M.app, ["--no-clear"])
        self.assertEqual(result.exit_code, 0)
        run.assert_called_once()
        self.assertTrue(console.no_clear())
        self.assertTrue(console.is_verbose())

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
        self.assertFalse(ns.browser)
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
                      "headless", "browser", "no_browser", "skip_fastapi", "wait_for_services"):
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
        q = _cli_run._auto_deploy_query("Qwen3-32B", "2")
        self.assertIn("auto-deploy=Qwen3-32B", q)
        self.assertIn("device-id=2", q)

    def test_with_multi_chip_device_id(self):
        # A comma-separated list is threaded verbatim (url-encoded) into the query.
        q = _cli_run._auto_deploy_query("Llama3.1-8B", "0,1")
        self.assertIn("device-id=0%2C1", q)


class _FakeSmokeTestError(Exception):
    pass


_DEPLOYED_ENTRY = {
    "model_impl": {"model_id": "model_ABC", "model_type": "chat",
                   "service_route": "/v1/chat/completions", "health_route": "/health",
                   "hf_model_id": "org/Model"},
    "port_bindings": {"7000/tcp": [{"HostIp": "0.0.0.0", "HostPort": "7001"}]},
    "device_ids": [0],
}


def _fake_driver(bodies, resolve_fn=None, progress_seq=None, deployed=None, health=200):
    """A stand-in for ci/deploy_healthcheck.py that records deploy payloads and
    answers the GETs a terminal deploy makes (progress, deployed, health)."""
    seq = list(progress_seq or [{"status": "completed", "stage": "complete", "progress": 100}])
    deployed_payload = {"dep-1": _DEPLOYED_ENTRY} if deployed is None else deployed

    class FakeClient:
        def __init__(self, base, proxy):
            pass

        def post(self, key, body, timeout=60):
            bodies.append(body)
            return 200, {"status": "success", "job_id": "job-1"}

        def get(self, key, timeout=30, query=None, **fmt):
            if key == "progress":
                return 200, (seq.pop(0) if len(seq) > 1 else seq[0])
            if key == "deployed":
                return 200, deployed_payload
            if key == "health":
                return health, {"message": "ok"}
            return 404, {}

    def default_resolve(client, name, explicit):
        return "model_ABC"

    return types.SimpleNamespace(
        SmokeTestError=_FakeSmokeTestError,
        Client=FakeClient,
        resolve_model_id=resolve_fn or default_resolve,
        poll_progress=lambda client, job, timeout, interval: None,
        fetch_deploy_logs=lambda client, job_id, tail=40: "(no logs)",
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
        args = _cli_args._build_args(auto_deploy="Qwen3-32B", device_id="3")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [{"model_id": "model_ABC", "device_id": "3"}])

    def test_includes_multi_chip_device_id(self):
        # Multi-chip list is passed straight through to the deploy payload.
        bodies = []
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="Llama3.1-8B", device_id="0,1")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [{"model_id": "model_ABC", "device_id": "0,1"}])

    def test_device_id_zero_is_explicit(self):
        # 0 is a real slot, distinct from "unset" — it must reach the payload.
        bodies = []
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B", device_id="0")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [{"model_id": "model_ABC", "device_id": "0"}])

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


def _fake_chip_driver(slots, raise_get=False):
    """A stand-in deploy driver whose Client.get returns a chip-status payload."""
    class FakeClient:
        def __init__(self, base, proxy):
            pass

        def get(self, key, timeout=30, query=None, **fmt):
            if raise_get:
                raise _FakeSmokeTestError("cannot reach http://localhost:8000/chip-status/")
            return 200, {"board_type": "P300x2", "total_slots": 4, "slots": slots}

    return types.SimpleNamespace(
        SmokeTestError=_FakeSmokeTestError,
        Client=FakeClient,
    )


class TestPreflightDeviceAvailability(unittest.TestCase):
    def _run_preflight(self, dh, **args_kw):
        args = _cli_args._build_args(**args_kw)
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._preflight_device_availability(args)

    def test_noop_without_device_id(self):
        # No explicit slots -> nothing to pre-check; must not touch the driver.
        with patch.object(_cli_run, "_load_deploy_driver") as loader:
            _cli_run._preflight_device_availability(
                _cli_args._build_args(auto_deploy="Qwen3-32B", device_id=None))
        loader.assert_not_called()

    def test_rejects_when_requested_chip_busy(self):
        slots = [
            {"slot_id": 0, "status": "occupied", "model_name": "Qwen3-32B"},
            {"slot_id": 1, "status": "available"},
        ]
        with self.assertRaises(SystemExit) as cm:
            self._run_preflight(_fake_chip_driver(slots),
                                auto_deploy="Llama3.1-8B", device_id="0,1")
        self.assertEqual(cm.exception.code, 1)

    def test_allows_when_requested_chips_free(self):
        slots = [
            {"slot_id": 0, "status": "available"},
            {"slot_id": 1, "status": "available"},
        ]
        # Must return normally (no SystemExit) when the slots are free.
        self._run_preflight(_fake_chip_driver(slots),
                            auto_deploy="Llama3.1-8B", device_id="0,1")

    def test_skips_when_backend_unreachable(self):
        # Fresh boot: backend isn't up yet -> skip silently, let deploy-time guard run.
        self._run_preflight(_fake_chip_driver([], raise_get=True),
                            auto_deploy="Llama3.1-8B", device_id="0,1")


if __name__ == "__main__":
    unittest.main()


class TestDeployModeHelpers(unittest.TestCase):
    """Pure decisions behind `run <model>`: where the deploy happens and whether a
    browser opens."""

    def test_no_model_means_no_deploy_and_normal_browser(self):
        args = _cli_args._build_args()
        self.assertIsNone(_cli_deploy.deploy_mode(args))
        self.assertTrue(_cli_deploy.should_open_browser(args))
        self.assertFalse(_cli_deploy.should_open_browser(_cli_args._build_args(no_browser=True)))

    def test_model_defaults_to_terminal_and_never_opens_browser(self):
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        self.assertEqual(_cli_deploy.deploy_mode(args), "terminal")
        self.assertFalse(_cli_deploy.should_open_browser(args))

    def test_browser_flag_opens_ui_unless_no_browser(self):
        args = _cli_args._build_args(auto_deploy="Qwen3-32B", browser=True)
        self.assertEqual(_cli_deploy.deploy_mode(args), "browser")
        self.assertTrue(_cli_deploy.should_open_browser(args))
        quiet = _cli_args._build_args(auto_deploy="Qwen3-32B", browser=True, no_browser=True)
        self.assertFalse(_cli_deploy.should_open_browser(quiet))

    def test_headless_alias_is_still_terminal(self):
        args = _cli_args._build_args(auto_deploy="Qwen3-32B", headless=True)
        self.assertEqual(_cli_deploy.deploy_mode(args), "terminal")


class TestDeployRendering(unittest.TestCase):
    def test_stage_labels(self):
        self.assertEqual(_cli_deploy.stage_label({"stage": "pulling_image"}), "Pulling Docker image")
        self.assertEqual(_cli_deploy.stage_label({"stage": "model_preparation"}), "Preparing model")
        self.assertEqual(
            _cli_deploy.stage_label({"stage": "model_preparation", "downloaded_bytes": 10}),
            "Downloading model weights")
        self.assertEqual(_cli_deploy.stage_label({"stage": "some_new_stage"}), "Some new stage")

    def test_download_detail_only_for_download_stages_with_bytes(self):
        self.assertIsNone(_cli_deploy.download_detail({"stage": "container_setup", "downloaded_bytes": 5}))
        self.assertIsNone(_cli_deploy.download_detail({"stage": "pulling_image"}))
        d = _cli_deploy.download_detail({"stage": "pulling_image", "downloaded_bytes": 1_200_000_000,
                                         "total_bytes": 23_300_000_000, "speed_bps": 85_000_000})
        self.assertEqual(d, "1.2 GB / 23.3 GB · 85 MB/s")

    def test_format_bytes(self):
        self.assertEqual(_cli_deploy.format_bytes(0), "0 B")
        self.assertEqual(_cli_deploy.format_bytes(999), "999 B")
        self.assertEqual(_cli_deploy.format_bytes(1500), "1.5 KB")
        self.assertEqual(_cli_deploy.format_bytes(85_000_000), "85 MB")
        self.assertEqual(_cli_deploy.format_bytes(250_000_000), "250 MB")
        self.assertEqual(_cli_deploy.format_bytes(None), "—")

    def test_download_fraction(self):
        self.assertIsNone(_cli_deploy.download_fraction({"downloaded_bytes": 1}))
        self.assertAlmostEqual(_cli_deploy.download_fraction({"downloaded_bytes": 50, "total_bytes": 200}), 0.25)
        self.assertEqual(_cli_deploy.download_fraction({"downloaded_bytes": 500, "total_bytes": 200}), 1.0)

    def test_endpoint_for_uses_host_port_and_service_route(self):
        ep = _cli_deploy.endpoint_for(_DEPLOYED_ENTRY, host="localhost")
        self.assertEqual(ep["port"], "7001")
        self.assertEqual(ep["url"], "http://localhost:7001/v1/chat/completions")
        self.assertEqual(ep["health"], "http://localhost:7001/health")
        self.assertEqual(ep["model_type"], "chat")

    def test_endpoint_for_without_port_bindings(self):
        ep = _cli_deploy.endpoint_for({"model_impl": {"service_route": "/v1"}})
        self.assertIsNone(ep["url"])
        self.assertIsNone(ep["port"])

    def test_curl_example_only_for_chat(self):
        self.assertIsNone(_cli_deploy.curl_example("http://x/v1/audio/speech", "tts"))
        ex = _cli_deploy.curl_example("http://localhost:7001/v1/chat/completions", "chat", "org/Model")
        self.assertIn("http://localhost:7001/v1/chat/completions", ex)
        self.assertIn('"model":"org/Model"', ex)


class TestWatchProgress(unittest.TestCase):
    """The polling loop drives the fake client through a scripted deploy. stdout
    is not a TTY under the test runner, so the plain change-only path renders."""

    def _run(self, seq, health=200):
        bodies = []
        dh = _fake_driver(bodies, progress_seq=seq, health=health)
        client = dh.Client("http://x", proxy=False)
        with patch.object(_cli_deploy.time, "sleep"):
            return _cli_deploy.watch_progress(dh, client, "job-1", timeout=60, interval=0)

    def test_runs_to_completion_and_returns_final_payload(self):
        seq = [
            {"status": "running", "stage": "pulling_image", "progress": 5,
             "downloaded_bytes": 100, "total_bytes": 1000},
            {"status": "running", "stage": "model_preparation", "progress": 40,
             "downloaded_bytes": 10, "total_bytes": 20},
            {"status": "running", "stage": "container_setup", "progress": 70},
            {"status": "completed", "stage": "complete", "progress": 100},
        ]
        final = self._run(seq)
        self.assertEqual(final["status"], "completed")

    def test_failure_raises_with_reason(self):
        seq = [
            {"status": "running", "stage": "starting", "progress": 0},
            {"status": "failed", "stage": "error", "progress": 0, "message": "HF_TOKEN validation failed"},
        ]
        with self.assertRaises(_FakeSmokeTestError) as ctx:
            self._run(seq)
        self.assertIn("HF_TOKEN validation failed", str(ctx.exception))


def _printed_text(con):
    """Everything a patched console printed, with Rich renderables (panels)
    flattened to plain text so assertions can look inside them."""
    import io
    from rich.console import Console
    from tt_setup.console._theme import TT_THEME
    out = []
    for call in con.print.call_args_list:
        for arg in call.args:
            if isinstance(arg, str):
                out.append(arg)
            else:
                buf = io.StringIO()
                Console(file=buf, width=200, force_terminal=False, color_system=None, theme=TT_THEME).print(arg)
                out.append(buf.getvalue())
    return "\n".join(out)


class TestRunHeadlessDeployEndToEnd(unittest.TestCase):
    def test_success_reports_endpoint_and_returns_healthy(self):
        bodies = []
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        with patch.object(_cli_deploy.time, "sleep"), \
             patch.object(_cli_deploy, "console") as con:
            ok = _cli_deploy.run_headless_deploy(dh, args, frontend=("localhost", 3000))
        self.assertTrue(ok)
        self.assertEqual(bodies, [{"model_id": "model_ABC"}])
        # The ready panel carried the host-reachable endpoint.
        printed = _printed_text(con)
        self.assertIn("http://localhost:7001/v1/chat/completions", printed)

    def test_refused_deploy_surfaces_backend_message(self):
        bodies = []
        dh = _fake_driver(bodies)

        class RefusingClient(dh.Client):
            def post(self, key, body, timeout=60):
                return 400, {"error_code": "hf_access_denied",
                             "message": "Your Hugging Face token does not have access to org/Model.",
                             "hf_url": "https://huggingface.co/org/Model"}
        dh.Client = RefusingClient
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        with patch.object(_cli_deploy, "console") as con:
            ok = _cli_deploy.run_headless_deploy(dh, args)
        self.assertFalse(ok)
        printed = _printed_text(con)
        self.assertIn("does not have access", printed)
        self.assertIn("https://huggingface.co/org/Model", printed)

    def test_not_healthy_yet_still_reports_starting(self):
        bodies = []
        dh = _fake_driver(bodies, health=202)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        # Health never reaches 200; make the wait give up immediately.
        with patch.object(_cli_deploy, "wait_for_health", return_value=False), \
             patch.object(_cli_deploy, "console") as con:
            ok = _cli_deploy.run_headless_deploy(dh, args)
        self.assertFalse(ok)
        printed = _printed_text(con)
        self.assertIn("is starting", printed)


class TestStopModelDispatch(unittest.TestCase):
    def test_stop_model_dispatches_with_names_and_skips_teardown(self):
        with patch.object(_cli_stop, "stop_models", return_value=0) as stop, \
             patch.object(_cli_run, "cleanup_resources") as cleanup, \
             patch.object(_cli_run, "purge_models") as purge:
            result = runner.invoke(M.app, ["--stop-model", "foo", "--stop-model", "bar"])
        self.assertEqual(result.exit_code, 0)
        stop.assert_called_once()
        cleanup.assert_not_called()
        purge.assert_not_called()
        ns = stop.call_args[0][0]
        self.assertEqual(ns.stop_model, ["foo", "bar"])

    def test_stop_model_nonzero_exit_propagates(self):
        with patch.object(_cli_stop, "stop_models", return_value=1):
            result = runner.invoke(M.app, ["--stop-model", "nope"])
        self.assertEqual(result.exit_code, 1)

    def test_help_lists_stop_model(self):
        result = runner.invoke(M.app, ["--help"])
        self.assertIn("--stop-model", re.sub(r"\x1b\[[0-9;]*m", "", result.output))


_DEPLOYED_PAYLOAD = {
    "c1": {"name": "speecht5_tts", "device_ids": [0],
           "model_impl": {"model_name": "speecht5_tts", "model_type": "tts"}},
    "c2": {"name": "tt-model-qwen3-32b", "device_ids": [1, 2],
           "model_impl": {"model_name": "Qwen3-32B", "model_type": "chat"}},
    "c3": {"name": "tt-model-qwen3-8b", "device_id": 3,
           "model_impl": {"model_name": "Qwen3-8B", "model_type": "chat"}},
}


class TestStopModelHelpers(unittest.TestCase):
    def test_summarize_orders_by_chip_and_fills_device_ids(self):
        rows = _cli_stop.summarize_deployed(_DEPLOYED_PAYLOAD)
        self.assertEqual([r["id"] for r in rows], ["c1", "c2", "c3"])
        self.assertEqual(rows[2]["device_ids"], [3])   # legacy single device_id
        self.assertEqual(rows[1]["model_name"], "Qwen3-32B")

    def test_match_exact_then_unique_substring(self):
        rows = _cli_stop.summarize_deployed(_DEPLOYED_PAYLOAD)
        self.assertEqual(_cli_stop.match_deployed(rows, "qwen3-32b")[0]["id"], "c2")   # catalog name, any case
        self.assertEqual(_cli_stop.match_deployed(rows, "tt-model-qwen3-8b")[0]["id"], "c3")  # container name
        self.assertEqual(_cli_stop.match_deployed(rows, "speech")[0]["id"], "c1")      # unique substring
        row, why = _cli_stop.match_deployed(rows, "qwen")
        self.assertIsNone(row)
        self.assertIn("ambiguous", why)
        row, why = _cli_stop.match_deployed(rows, "llama")
        self.assertIsNone(row)
        self.assertIn("not deployed", why)

    def test_parse_sse_yields_json_frames_only(self):
        lines = [b"retry: 1000\n", b"\n", b'data: {"type": "step", "message": "Stopping"}\n', b"\n",
                 b"data: not-json\n", b'data: {"type": "complete", "status": "success"}\n']
        events = list(_cli_stop.parse_sse(lines))
        self.assertEqual(events[0]["type"], "step")
        self.assertEqual(events[1], {"type": "log", "message": "not-json"})
        self.assertEqual(events[2]["status"], "success")

    def test_parse_selection(self):
        self.assertEqual(_cli_stop.parse_selection("1 3", 3), [1, 3])
        self.assertEqual(_cli_stop.parse_selection("3,1,1", 3), [1, 3])
        self.assertEqual(_cli_stop.parse_selection("all", 2), [1, 2])
        self.assertEqual(_cli_stop.parse_selection("4", 3), [])
        self.assertEqual(_cli_stop.parse_selection("x", 3), [])


class TestStopModels(unittest.TestCase):
    def _stream_ok(self, base, container_id):
        yield {"type": "step", "message": f"Stopping {container_id}…"}
        yield {"type": "log", "message": "docker rm"}
        yield {"type": "step", "message": "Resetting device(s) 1, 2…"}
        yield {"type": "complete", "status": "success", "message": "Model deleted and device(s) reset"}

    def test_named_model_is_stopped_and_reset(self):
        stopped = []

        def stream(base, cid):
            stopped.append(cid)
            return self._stream_ok(base, cid)
        args = _cli_args._build_args(stop_model=["Qwen3-32B"])
        with patch.object(_cli_stop, "console"):
            rc = _cli_stop.stop_models(args, base="http://x", fetch=lambda b: _DEPLOYED_PAYLOAD, stream=stream)
        self.assertEqual(rc, 0)
        self.assertEqual(stopped, ["c2"])

    def test_unknown_name_stops_nothing(self):
        stopped = []
        args = _cli_args._build_args(stop_model=["Llama-3.1-8B"])
        with patch.object(_cli_stop, "console") as con:
            rc = _cli_stop.stop_models(args, base="http://x", fetch=lambda b: _DEPLOYED_PAYLOAD,
                                       stream=lambda b, c: stopped.append(c) or iter(()))
        self.assertEqual(rc, 1)
        self.assertEqual(stopped, [])
        self.assertIn("not deployed", _printed_text(con))

    def test_backend_failure_reports_error(self):
        def stream(base, cid):
            yield {"type": "step", "message": "Stopping"}
            yield {"type": "complete", "status": "error", "message": "Stop failed: boom"}
        args = _cli_args._build_args(stop_model=["speecht5_tts"])
        with patch.object(_cli_stop, "console") as con:
            rc = _cli_stop.stop_models(args, base="http://x", fetch=lambda b: _DEPLOYED_PAYLOAD, stream=stream)
        self.assertEqual(rc, 1)
        self.assertIn("boom", _printed_text(con))

    def test_nothing_deployed_is_a_clean_noop(self):
        args = _cli_args._build_args(stop_model=["anything"])
        with patch.object(_cli_stop, "console"):
            rc = _cli_stop.stop_models(args, base="http://x", fetch=lambda b: {}, stream=None)
        self.assertEqual(rc, 0)

    def test_unreachable_backend(self):
        def fetch(base):
            raise _cli_stop.StopModelError("cannot reach the TT Studio backend at http://x: refused")
        args = _cli_args._build_args(stop_model=["x"])
        with patch.object(_cli_stop, "console") as con:
            rc = _cli_stop.stop_models(args, base="http://x", fetch=fetch, stream=None)
        self.assertEqual(rc, 1)
        self.assertIn("python run.py", _printed_text(con))

    def test_picker_without_tty_fails_with_hint(self):
        from tt_setup.constants import _PURGE_MODEL_PICKER
        args = _cli_args._build_args(stop_model=[_PURGE_MODEL_PICKER])
        with patch.object(_cli_stop, "console") as con, \
             patch.object(_cli_stop.sys.stdin, "isatty", return_value=False):
            rc = _cli_stop.stop_models(args, base="http://x", fetch=lambda b: _DEPLOYED_PAYLOAD, stream=None)
        self.assertEqual(rc, 1)
        self.assertIn("--stop-model <name>", _printed_text(con))

    def test_picker_selection_stops_chosen_rows(self):
        from tt_setup.constants import _PURGE_MODEL_PICKER
        stopped = []

        def stream(base, cid):
            stopped.append(cid)
            return self._stream_ok(base, cid)
        args = _cli_args._build_args(stop_model=[_PURGE_MODEL_PICKER])
        with patch.object(_cli_stop, "console"), \
             patch.object(_cli_stop.sys.stdin, "isatty", return_value=True), \
             patch.object(_cli_stop, "ask", return_value="1 3"):
            rc = _cli_stop.stop_models(args, base="http://x", fetch=lambda b: _DEPLOYED_PAYLOAD, stream=stream)
        self.assertEqual(rc, 0)
        self.assertEqual(stopped, ["c1", "c3"])

    def test_picker_cancel_is_clean(self):
        from tt_setup.constants import _PURGE_MODEL_PICKER
        args = _cli_args._build_args(stop_model=[_PURGE_MODEL_PICKER])
        with patch.object(_cli_stop, "console"), \
             patch.object(_cli_stop.sys.stdin, "isatty", return_value=True), \
             patch.object(_cli_stop, "ask", return_value=""):
            rc = _cli_stop.stop_models(args, base="http://x", fetch=lambda b: _DEPLOYED_PAYLOAD, stream=None)
        self.assertEqual(rc, 0)

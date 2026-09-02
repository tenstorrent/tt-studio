# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the Typer CLI: parsing, help, and dispatch (logic mocked)."""
import contextlib
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
                     "--build-images", "--no-clear", "--auto-deploy", "--headless"):
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
        # hits an AttributeError. Derive the expected set from _entry's own
        # signature so a flag added to the callback but not to _build_args fails
        # here instead of at runtime.
        import inspect
        ns = _cli_args._build_args()
        # Callback-only params: consumed inside _entry, or renamed before _run.
        consumed = {"ctx", "verbose", "no_clear"}
        renamed = {"stop": "cleanup", "purge_all": "cleanup_all"}
        for name in inspect.signature(_cli_args._entry).parameters:
            if name in consumed:
                continue
            field = renamed.get(name, name)
            self.assertTrue(hasattr(ns, field), f"_build_args lacks field for --{name}")

    def test_purge_model_defaults_to_empty_list(self):
        # _entry always passes a list; the `run` path must match that shape.
        self.assertEqual(_cli_args._build_args().purge_model, [])


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


    def test_training_and_unknown_groups_get_labels(self):
        # Every catalog display type gets a header; anything unmapped lands under
        # "Other" rather than a raw enum name.
        catalog = [
            {"name": "Llama-3.1-8B-Instruct-train", "group": "TRAINING", "boards": ["P300x2"]},
            {"name": "mystery-model", "group": "NEW_KIND", "boards": ["P300x2"]},
        ]
        with patch.object(_cli_args, "_catalog_models", return_value=catalog), \
             patch.object(_cli_args, "_detect_board", return_value=""), \
             patch.object(_cli_args.typer, "prompt", return_value="1"), \
             patch.object(_cli_args.console, "print") as out:
            _cli_args._prompt_for_model()
        text = " ".join(str(a) for c in out.call_args_list for a in c.args)
        self.assertIn("Training", text)
        self.assertIn("New_Kind", text)  # unmapped groups are title-cased, not shouted

    def test_catalog_groups_use_display_type_only(self):
        # display_model_type (LLM/VLM/...) and model_type (CHAT/...) are different
        # vocabularies; the picker must not mix them.
        entries = {"models": [
            {"model_name": "A", "display_model_type": "LLM", "model_type": "CHAT"},
            {"model_name": "B", "model_type": "CHAT"},
        ]}
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "app", "backend", "shared_config")
            os.makedirs(path)
            with open(os.path.join(path, "models_from_inference_server.json"), "w") as f:
                json.dump(entries, f)
            with patch.object(_cli_args, "TT_STUDIO_ROOT", d):
                groups = {m["name"]: m["group"] for m in _cli_args._catalog_models()}
        self.assertEqual(groups, {"A": "LLM", "B": "OTHER"})


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


_CATALOG = {
    "status": "success",
    "models": {
        "model_ABC": {"model_name": "Qwen3-32B"},
        "model_LL8": {"model_name": "Llama-3.1-8B-Instruct"},
        "model_LL70": {"model_name": "Llama-3.3-70B-Instruct"},
    },
}


def _fake_driver(bodies, catalog=None, progress=None, get_fn=None, bases=None,
                 health=None, deployed=None):
    """A stand-in for ci/deploy_healthcheck.py that records deploy payloads.

    `progress` / `health` are lists of (status, payload) or payloads served in
    order (the last one repeats); `get_fn` overrides GET handling entirely;
    `bases` collects the base URLs the Client was built with; `deployed` is the
    /models/deployed/ payload (defaults to the resolved model being present).
    """
    catalog = _CATALOG if catalog is None else catalog
    progress = progress or [{"status": "completed", "progress": 100, "message": "ready"}]
    health = health or [(200, {"message": "Healthy"})]
    calls = {"progress": 0, "health": 0}

    def _deployed():
        if deployed is not None:
            return deployed
        mid = bodies[-1]["model_id"] if bodies else "model_ABC"
        return {"deploy-1": {"name": "x", "model_impl": {"model_id": mid}}}

    class FakeClient:
        def __init__(self, base, proxy):
            if bases is not None:
                bases.append(base)

        def get(self, key, timeout=30, query=None, **fmt):
            if get_fn is not None:
                return get_fn(key, **fmt)
            if key == "catalog":
                return 200, catalog
            if key == "progress":
                i = min(calls["progress"], len(progress) - 1)
                calls["progress"] += 1
                return 200, progress[i]
            if key == "deployed":
                return 200, _deployed()
            if key == "health":
                i = min(calls["health"], len(health) - 1)
                calls["health"] += 1
                item = health[i]
                return item if isinstance(item, tuple) else (200, item)
            raise AssertionError(f"unexpected GET {key}")

        def post(self, key, body, timeout=60):
            bodies.append(body)
            return 200, {"status": "success", "job_id": "job-1"}

    return types.SimpleNamespace(
        SmokeTestError=_FakeSmokeTestError,
        Client=FakeClient,
        PROGRESS_FAIL={"error", "failed", "timeout", "cancelled"},
    )


class _Capture:
    """Collect everything the headless deploy prints, with notice panels
    flattened to their text so assertions can read them."""

    def __init__(self):
        self.lines = []

    def __enter__(self):
        self._stack = contextlib.ExitStack()
        self._stack.enter_context(patch.object(
            _cli_run, "notice_panel",
            side_effect=lambda title, lines, **kw: f"[{title}] " + " ".join(lines)))
        self._stack.enter_context(patch.object(
            _cli_run.console, "print",
            side_effect=lambda *a, **k: self.lines.append(" ".join(str(x) for x in a))))
        return self

    def __exit__(self, *exc):
        self._stack.close()
        return False

    @property
    def text(self):
        return "\n".join(self.lines)


class TestHeadlessDeploy(unittest.TestCase):
    def test_omits_device_id_when_unset(self):
        # The headline behavior: no --device-id -> backend allocates by model.
        bodies = []
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B", device_id=None)
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [{"model_id": "model_ABC", "force_full_board": True}])

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
        args = _cli_args._build_args(auto_deploy="Llama-3.1-8B-Instruct", device_id="0,1")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [{"model_id": "model_LL8", "device_id": "0,1"}])

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
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="not-a-model")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             _Capture() as cap:
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [])  # a real miss never posts a deploy
        text = cap.text
        self.assertIn("No catalog model matches", text)
        self.assertIn("Qwen3-32B", text)  # lists what is available

    def test_ambiguous_match_error_has_no_ci_flag_text(self):
        # "Llama" matches two catalog entries. The message must speak `run`'s
        # language — never the CI driver's `--model-id` flag.
        bodies = []
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="Llama")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             _Capture() as cap:
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [])
        text = cap.text
        self.assertIn("matches several models", text)
        self.assertIn("Re-run with the exact model name", text)
        self.assertNotIn("--model-id", text)

    def test_unique_substring_match_resolves(self):
        bodies = []
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="qwen3")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertEqual(bodies, [{"model_id": "model_ABC", "force_full_board": True}])

    def test_retries_on_backend_warmup_then_succeeds(self):
        bodies = []
        calls = {"n": 0}

        def flaky(key, **fmt):
            if key == "catalog":
                calls["n"] += 1
                if calls["n"] == 1:
                    raise _FakeSmokeTestError("cannot reach http://localhost:8000/docker/catalog/")
                return 200, _CATALOG
            if key == "deployed":
                return 200, {"d1": {"model_impl": {"model_id": "model_ABC"}}}
            if key == "health":
                return 200, {"message": "Healthy"}
            return 200, {"status": "completed", "progress": 100}

        dh = _fake_driver(bodies, get_fn=flaky)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             patch.object(_cli_run.time, "sleep"):
            _cli_run._headless_deploy(args)
        self.assertEqual(calls["n"], 2)          # retried once past the warmup error
        self.assertEqual(len(bodies), 1)         # then deployed

    def test_not_found_job_fails_fast_after_grace(self):
        # An orphaned job (backend restarted, imgpull id evicted) must not spin
        # for the full timeout: past the grace period `not_found` is a failure.
        bodies = []
        dh = _fake_driver(bodies, progress=[{"status": "not_found"}])
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        clock = {"t": 1000.0}

        def fake_time():
            return clock["t"]

        def fake_sleep(secs):
            clock["t"] += secs

        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             patch.object(_cli_run.time, "time", fake_time), \
             patch.object(_cli_run.time, "sleep", fake_sleep), \
             _Capture() as cap:
            _cli_run._headless_deploy(args)
        elapsed = clock["t"] - 1000.0
        self.assertLess(elapsed, 120)  # well inside the 3600 s deploy timeout
        text = cap.text
        self.assertIn("no longer reports this deploy job", text)

    def test_failed_status_reports_reason(self):
        bodies = []
        dh = _fake_driver(bodies, progress=[
            {"status": "running", "progress": 10, "message": "pulling image"},
            {"status": "failed", "progress": 10, "message": "no space left on device"},
        ])
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             patch.object(_cli_run.time, "sleep"), \
             _Capture() as cap:
            _cli_run._headless_deploy(args)
        text = cap.text
        self.assertIn("no space left on device", text)

    def test_keyboard_interrupt_while_polling_exits_cleanly(self):
        bodies = []

        def interrupt(key, **fmt):
            if key == "catalog":
                return 200, _CATALOG
            raise KeyboardInterrupt

        dh = _fake_driver(bodies, get_fn=interrupt)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             _Capture() as cap:
            _cli_run._headless_deploy(args)  # must not propagate
        text = cap.text
        self.assertIn("keeps deploying", text)

    def test_completed_then_healthy_reports_serving(self):
        bodies = []
        dh = _fake_driver(bodies, health=[(202, {"message": "Starting"}), (200, {"message": "Healthy"})])
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             patch.object(_cli_run.time, "sleep"), _Capture() as cap:
            _cli_run._headless_deploy(args)
        self.assertIn("is serving", cap.text)
        self.assertNotIn("Auto-deploy failed", cap.text)

    def test_container_vanishing_after_start_is_a_failure(self):
        # `completed` only means the container launched. If it then drops out of
        # /models/deployed/ (tt-metal fatal at startup), that must surface as a
        # failure rather than a success banner.
        bodies = []
        seen = {"n": 0}

        def flaky(key, **fmt):
            if key == "catalog":
                return 200, _CATALOG
            if key == "progress":
                return 200, {"status": "completed", "progress": 100}
            if key == "deployed":
                seen["n"] += 1
                if seen["n"] == 1:
                    return 200, {"d1": {"model_impl": {"model_id": "model_ABC"}}}
                return 200, {}
            if key == "health":
                return 202, {"message": "Starting"}
            raise AssertionError(key)

        dh = _fake_driver(bodies, get_fn=flaky)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             patch.object(_cli_run.time, "sleep"), _Capture() as cap:
            _cli_run._headless_deploy(args)
        self.assertIn("exited during startup", cap.text)
        self.assertNotIn("is serving", cap.text)

    def test_three_unavailable_in_a_row_fails(self):
        bodies = []
        dh = _fake_driver(bodies, health=[(503, {"message": "Unavailable", "details": "engine down"})])
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             patch.object(_cli_run.time, "sleep"), _Capture() as cap:
            _cli_run._headless_deploy(args)
        self.assertIn("Unavailable 3x", cap.text)

    def test_pinned_device_sends_no_placement_hint(self):
        bodies = []
        dh = _fake_driver(bodies)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B", device_id="2,3")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh):
            _cli_run._headless_deploy(args)
        self.assertNotIn("force_full_board", bodies[0])

    def test_base_url_honours_env_override(self):
        bodies, bases = [], []
        dh = _fake_driver(bodies, bases=bases)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             patch.dict(os.environ, {"TTSTUDIO_BASE_URL": "http://box:8010/"}):
            _cli_run._headless_deploy(args)
        self.assertEqual(bases, ["http://box:8010"])

    def test_base_url_defaults_to_local_backend(self):
        bodies, bases = [], []
        dh = _fake_driver(bodies, bases=bases)
        args = _cli_args._build_args(auto_deploy="Qwen3-32B")
        env = {k: v for k, v in os.environ.items() if k != "TTSTUDIO_BASE_URL"}
        with patch.object(_cli_run, "_load_deploy_driver", return_value=dh), \
             patch.dict(os.environ, env, clear=True):
            _cli_run._headless_deploy(args)
        self.assertEqual(bases, ["http://localhost:8000"])


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

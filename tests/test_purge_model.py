# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for --purge-model: name matching, image reference counting, discovery,
and the orchestrator's abort/removal behavior (docker mocked)."""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import tt_setup.cleanup as run
from tt_setup.cleanup import _purge_model as _pm

CATALOG = {
    "models": [
        {"model_name": "Llama-3.1-8B-Instruct", "docker_image": "ghcr.io/x/vllm:1"},
        {"model_name": "Llama-3.1-8B-Instruct-FP8", "docker_image": "ghcr.io/x/vllm:1"},
        {"model_name": "Qwen3-32B", "docker_image": "ghcr.io/x/vllm:2"},
        {"model_name": "whisper-large-v3", "docker_image": "ghcr.io/x/media:1"},
        {"model_name": "speecht5_tts", "docker_image": "ghcr.io/x/media:1"},
        {"model_name": "YOLOv4", "docker_image": "ghcr.io/x/yolo:1"},
    ]
}
NAMES = [m["model_name"] for m in CATALOG["models"]]


class DirMatchTests(unittest.TestCase):
    def test_versioned_host_dir_and_unversioned_volume(self):
        self.assertTrue(run._dir_matches_model(
            "volume_id_tt-metal-Llama-3.1-8B-Instruct-v0.0.1", "Llama-3.1-8B-Instruct"))
        self.assertTrue(run._dir_matches_model(
            "volume_id_tt_transformers-Qwen3-32B", "Qwen3-32B"))

    def test_case_insensitive(self):
        self.assertTrue(run._dir_matches_model(
            "volume_id_tt-metal-llama-3.1-8b-instruct-v0.0.1", "Llama-3.1-8B-Instruct"))

    def test_legacy_glued_id(self):
        self.assertTrue(run._dir_matches_model("volume_id_yolov4v0.0.1", "YOLOv4"))
        self.assertTrue(run._dir_matches_model(
            "volume_id_stable_diffusionv0.1.0", "stable_diffusion"))

    def test_prefix_collision_is_rejected(self):
        # A model must never claim a sibling whose name extends its own.
        base, fp8 = "Llama-3.1-8B-Instruct", "Llama-3.1-8B-Instruct-FP8"
        fp8_dir = "volume_id_tt-metal-Llama-3.1-8B-Instruct-FP8-v0.0.1"
        self.assertFalse(run._dir_matches_model(fp8_dir, base))
        self.assertTrue(run._dir_matches_model(fp8_dir, fp8))

    def test_non_volume_names_are_rejected(self):
        self.assertFalse(run._dir_matches_model("backend_volume", "backend"))
        self.assertFalse(run._dir_matches_model("model_envs", "model"))


class ResolveNamesTests(unittest.TestCase):
    def test_exact_case_insensitive_and_substring(self):
        resolved, errors = run._resolve_model_names(
            ["Qwen3-32B", "yolov4", "whisper"], NAMES)
        self.assertEqual(errors, [])
        self.assertEqual([m for _, m in resolved],
                         ["Qwen3-32B", "YOLOv4", "whisper-large-v3"])

    def test_comma_separated_and_dedup(self):
        resolved, errors = run._resolve_model_names(
            ["Qwen3-32B,YOLOv4", "qwen3-32b"], NAMES)
        self.assertEqual(errors, [])
        self.assertEqual([m for _, m in resolved], ["Qwen3-32B", "YOLOv4"])

    def test_ambiguous_substring_errors_with_suggestions(self):
        resolved, errors = run._resolve_model_names(["Llama"], NAMES)
        self.assertEqual(resolved, [])
        self.assertEqual(len(errors), 1)
        name, suggestions = errors[0]
        self.assertEqual(name, "Llama")
        self.assertIn("Llama-3.1-8B-Instruct", suggestions)

    def test_unknown_name_gets_close_matches(self):
        resolved, errors = run._resolve_model_names(["Qwen3-38B"], NAMES)
        self.assertEqual(resolved, [])
        self.assertEqual(errors[0][0], "Qwen3-38B")
        self.assertIn("Qwen3-32B", errors[0][1])


class DeploymentRecordTests(unittest.TestCase):
    def _write(self, path, records):
        path.write_text(json.dumps({"next_id": len(records) + 1, "records": records}))

    def test_records_matched_by_model_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Path(tmp) / "deployments.json"
            self._write(store, [
                {"model_name": "Qwen3-32B", "container_name": "tt-inference-server-ab12",
                 "container_id": "c1", "status": "running"},
                {"model_name": "YOLOv4", "container_name": "tt-inference-server-cd34",
                 "container_id": "c2", "status": "stopped"},
            ])
            records = run._deployments_for_model(str(store), "qwen3-32b")
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["container_name"], "tt-inference-server-ab12")

    def test_missing_and_corrupt_store_return_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = str(Path(tmp) / "nope.json")
            self.assertEqual(run._deployments_for_model(missing, "Qwen3-32B"), [])
            corrupt = Path(tmp) / "deployments.json"
            corrupt.write_text("{not json")
            self.assertEqual(run._deployments_for_model(str(corrupt), "Qwen3-32B"), [])


class PartitionImagesTests(unittest.TestCase):
    def test_shared_image_is_kept_when_a_user_remains(self):
        removable, shared = run._partition_images(
            CATALOG["models"], ["whisper-large-v3"],
            ["whisper-large-v3", "speecht5_tts"])
        self.assertEqual(removable, [])
        self.assertEqual(shared, {"ghcr.io/x/media:1": ["speecht5_tts"]})

    def test_image_removable_when_all_users_purged(self):
        removable, shared = run._partition_images(
            CATALOG["models"], ["whisper-large-v3", "speecht5_tts"],
            ["whisper-large-v3", "speecht5_tts"])
        self.assertEqual(removable, ["ghcr.io/x/media:1"])
        self.assertEqual(shared, {})

    def test_uninstalled_catalog_models_do_not_pin(self):
        # speecht5_tts shares the tag but has nothing installed → no pin.
        removable, shared = run._partition_images(
            CATALOG["models"], ["whisper-large-v3"], ["whisper-large-v3"])
        self.assertEqual(removable, ["ghcr.io/x/media:1"])
        self.assertEqual(shared, {})


class PickerSelectionTests(unittest.TestCase):
    def test_valid_forms(self):
        self.assertEqual(run._parse_picker_selection("1 3", 4), [1, 3])
        self.assertEqual(run._parse_picker_selection("3,1", 4), [1, 3])
        self.assertEqual(run._parse_picker_selection("2, 2", 4), [2])
        self.assertEqual(run._parse_picker_selection("all", 3), [1, 2, 3])

    def test_invalid_forms(self):
        for raw in ("", "0", "5", "1 5", "one", "1-3", "-1"):
            self.assertIsNone(run._parse_picker_selection(raw, 4), raw)


class InstalledModelsTests(unittest.TestCase):
    def _make_pv(self, root):
        pv = root / "tt_studio_persistent_volume"
        (pv / "volume_id_tt-metal-Llama-3.1-8B-Instruct-v0.0.1").mkdir(parents=True)
        (pv / "volume_id_tt-metal-Llama-3.1-8B-Instruct-v0.0.1" / "w.bin").write_text("x" * 64)
        (pv / "model_envs").mkdir()
        (pv / "model_envs" / "Llama-3.1-8B-Instruct.env").write_text("A=1")
        (pv / "volume_id_old-orphan-v0.0.9").mkdir()
        (pv / "backend_volume").mkdir()
        (pv / "backend_volume" / "deployments.json").write_text(json.dumps({
            "next_id": 2,
            "records": [{"model_name": "Qwen3-32B", "container_id": "c1",
                         "container_name": "tt-inference-server-ab12",
                         "status": "running"}],
        }))
        return pv

    def test_discovery_includes_disk_deployments_and_orphans(self):
        with tempfile.TemporaryDirectory() as tmp:
            pv = self._make_pv(Path(tmp))
            models = run._installed_models(
                str(pv), CATALOG["models"],
                str(pv / "backend_volume" / "deployments.json"),
                docker_volumes=["volume_id_tt-metal-Llama-3.1-8B-Instruct"],
            )
            by_name = {m["name"]: m for m in models}
            self.assertIn("Llama-3.1-8B-Instruct", by_name)
            llama = by_name["Llama-3.1-8B-Instruct"]
            self.assertEqual(len(llama["weight_dirs"]), 1)
            self.assertIsNotNone(llama["env_file"])
            self.assertEqual(llama["volumes"],
                             ["volume_id_tt-metal-Llama-3.1-8B-Instruct"])
            # FP8 sibling shares a name prefix but has nothing installed.
            self.assertNotIn("Llama-3.1-8B-Instruct-FP8", by_name)
            # Qwen is installed via its running deployment record alone.
            self.assertIn("Qwen3-32B", by_name)
            self.assertEqual(len(by_name["Qwen3-32B"]["running"]), 1)
            # Unclaimed volume_id_ dir surfaces as a purgeable orphan.
            self.assertIn("volume_id_old-orphan-v0.0.9", by_name)
            self.assertTrue(by_name["volume_id_old-orphan-v0.0.9"]["orphan"])


class PurgeModelsFlowTests(unittest.TestCase):
    """End-to-end orchestrator runs with docker helpers mocked."""

    def _stack(self, stack, pv, catalog_file, volumes=(), live=()):
        stack.enter_context(patch.object(
            _pm, "get_env_var", side_effect=lambda name, default="": str(pv)))
        stack.enter_context(patch.object(
            _pm, "_model_catalog_path", return_value=str(catalog_file)))
        stack.enter_context(patch.object(_pm, "check_docker_access", return_value=True))
        stack.enter_context(patch.object(_pm, "_docker_daemon_status", return_value="ok"))
        stack.enter_context(patch.object(
            _pm, "_docker_volume_names", return_value=list(volumes)))
        stack.enter_context(patch.object(
            _pm, "_deployed_model_names", return_value=list(live)))
        stack.enter_context(patch.object(
            _pm, "_docker_object_sizes", return_value=({}, {})))

    def _setup_tree(self, root):
        pv = InstalledModelsTests()._make_pv(root)
        catalog_file = root / "catalog.json"
        catalog_file.write_text(json.dumps(CATALOG))
        return pv, catalog_file

    def test_unknown_model_exits_1_and_touches_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            weights = pv / "volume_id_tt-metal-Llama-3.1-8B-Instruct-v0.0.1"
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file)
                removed = stack.enter_context(
                    patch.object(_pm, "_remove_docker_volumes"))
                args = SimpleNamespace(purge_model=["no-such-model"], yes=True,
                                       no_sudo=True)
                with contextlib.redirect_stdout(io.StringIO()):
                    code = run.purge_models(args)
            self.assertEqual(code, 1)
            self.assertTrue(weights.exists())
            removed.assert_not_called()

    def test_abort_at_confirmation_deletes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            weights = pv / "volume_id_tt-metal-Llama-3.1-8B-Instruct-v0.0.1"
            env_file = pv / "model_envs" / "Llama-3.1-8B-Instruct.env"
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file,
                            volumes=["volume_id_tt-metal-Llama-3.1-8B-Instruct"])
                vols = stack.enter_context(patch.object(_pm, "_remove_docker_volumes"))
                imgs = stack.enter_context(patch.object(_pm, "_remove_image_ref"))
                stack.enter_context(patch("builtins.input", return_value="n"))
                args = SimpleNamespace(purge_model=["Llama-3.1-8B-Instruct"],
                                       yes=False, no_sudo=True)
                with contextlib.redirect_stdout(io.StringIO()):
                    code = run.purge_models(args)
            self.assertEqual(code, 0)
            self.assertTrue(weights.exists())
            self.assertTrue(env_file.exists())
            vols.assert_not_called()
            imgs.assert_not_called()

    def test_purge_removes_model_artifacts_and_keeps_shared_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            weights = pv / "volume_id_tt-metal-Llama-3.1-8B-Instruct-v0.0.1"
            env_file = pv / "model_envs" / "Llama-3.1-8B-Instruct.env"
            orphan = pv / "volume_id_old-orphan-v0.0.9"
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file,
                            volumes=["volume_id_tt-metal-Llama-3.1-8B-Instruct"])
                vols = stack.enter_context(patch.object(
                    _pm, "_remove_docker_volumes",
                    return_value=(["volume_id_tt-metal-Llama-3.1-8B-Instruct"], [])))
                imgs = stack.enter_context(patch.object(
                    _pm, "_remove_image_ref", return_value=True))
                # FP8 sibling is "installed" too so the shared vllm:1 image must
                # be kept; give it a weights dir.
                fp8_dir = pv / "volume_id_tt-metal-Llama-3.1-8B-Instruct-FP8-v0.0.1"
                fp8_dir.mkdir()
                args = SimpleNamespace(purge_model=["Llama-3.1-8B-Instruct"],
                                       yes=True, no_sudo=True)
                with contextlib.redirect_stdout(io.StringIO()):
                    code = run.purge_models(args)
            self.assertEqual(code, 0)
            self.assertFalse(weights.exists())
            self.assertFalse(env_file.exists())
            # Only the requested model is touched.
            self.assertTrue(orphan.exists())
            self.assertTrue(fp8_dir.exists())
            vols.assert_called_once_with(
                ["volume_id_tt-metal-Llama-3.1-8B-Instruct"], True)
            imgs.assert_not_called()

    def test_purge_removes_image_when_last_user_goes(self):
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file)
                stack.enter_context(patch.object(
                    _pm, "_remove_docker_volumes", return_value=([], [])))
                imgs = stack.enter_context(patch.object(
                    _pm, "_remove_image_ref", return_value=True))
                # Llama is the only installed user of ghcr.io/x/vllm:1 (the FP8
                # sibling has nothing on disk), so the image goes with it.
                args = SimpleNamespace(purge_model=["Llama-3.1-8B-Instruct"],
                                       yes=True, no_sudo=True)
                with contextlib.redirect_stdout(io.StringIO()):
                    code = run.purge_models(args)
            self.assertEqual(code, 0)
            imgs.assert_called_once_with("ghcr.io/x/vllm:1", True)

    def test_running_model_container_is_stopped_and_record_updated(self):
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            store = pv / "backend_volume" / "deployments.json"
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file,
                            live=["tt-inference-server-ab12"])
                containers = stack.enter_context(patch.object(
                    _pm, "_remove_docker_containers", return_value=1))
                stack.enter_context(patch.object(
                    _pm, "_remove_docker_volumes", return_value=([], [])))
                stack.enter_context(patch.object(
                    _pm, "_remove_image_ref", return_value=True))
                args = SimpleNamespace(purge_model=["Qwen3-32B"], yes=True,
                                       no_sudo=True)
                with contextlib.redirect_stdout(io.StringIO()):
                    code = run.purge_models(args)
            self.assertEqual(code, 0)
            containers.assert_called_once_with(["tt-inference-server-ab12"], True)
            record = json.loads(store.read_text())["records"][0]
            self.assertEqual(record["status"], "stopped")
            self.assertTrue(record["stopped_by_user"])

    def test_bare_picker_without_tty_exits_1(self):
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            from tt_setup.constants import _PURGE_MODEL_PICKER
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file)
                stack.enter_context(patch.object(
                    _pm.sys.stdin, "isatty", return_value=False))
                args = SimpleNamespace(purge_model=[_PURGE_MODEL_PICKER],
                                       yes=False, no_sudo=True)
                with contextlib.redirect_stdout(io.StringIO()):
                    code = run.purge_models(args)
            self.assertEqual(code, 1)

    def test_bare_picker_with_nothing_installed_exits_0(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pv = root / "tt_studio_persistent_volume"  # never created
            catalog_file = root / "catalog.json"
            catalog_file.write_text(json.dumps(CATALOG))
            from tt_setup.constants import _PURGE_MODEL_PICKER
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file)
                args = SimpleNamespace(purge_model=[_PURGE_MODEL_PICKER],
                                       yes=False, no_sudo=True)
                with contextlib.redirect_stdout(io.StringIO()):
                    code = run.purge_models(args)
            self.assertEqual(code, 0)


class DockerHelperArgvTests(unittest.TestCase):
    """The new _resource_ops helpers issue exactly the expected docker argv."""

    def test_remove_docker_volumes_reports_in_use(self):
        from tt_setup.cleanup import _resource_ops as rops
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            ok = "in-use-vol" not in cmd
            return SimpleNamespace(returncode=0 if ok else 1,
                                   stdout="", stderr="" if ok else "volume is in use")

        with patch.object(rops.subprocess, "run", side_effect=fake_run):
            removed, in_use = run._remove_docker_volumes(
                ["volume_id_a", "in-use-vol"], True)
        self.assertEqual(removed, ["volume_id_a"])
        self.assertEqual(in_use, ["in-use-vol"])
        self.assertIn(["docker", "volume", "rm", "-f", "volume_id_a"], calls)

    def test_remove_docker_volumes_removes_stopped_holders_and_retries(self):
        """A volume pinned only by a stopped container (docker counts those as
        "in use" too) gets freed: the holders are force-removed and the rm is
        retried, so purge works after `--stop` without manual docker surgery."""
        from tt_setup.cleanup import _resource_ops as rops
        calls = []
        state = {"holders_removed": False}

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            if cmd[:2] == ["docker", "ps"]:
                return SimpleNamespace(returncode=0, stdout="abc123\n", stderr="")
            if cmd[:3] == ["docker", "rm", "-fv"]:
                state["holders_removed"] = True
                return SimpleNamespace(returncode=0, stdout="", stderr="")
            if state["holders_removed"]:
                return SimpleNamespace(returncode=0, stdout="", stderr="")
            return SimpleNamespace(
                returncode=1, stdout="",
                stderr="volume is in use - [abc123]")

        with patch.object(rops.subprocess, "run", side_effect=fake_run):
            removed, in_use = run._remove_docker_volumes(["pinned-vol"], True)
        self.assertEqual(removed, ["pinned-vol"])
        self.assertEqual(in_use, [])
        self.assertIn(["docker", "ps", "-aq", "--filter", "volume=pinned-vol"], calls)
        self.assertIn(["docker", "rm", "-fv", "abc123"], calls)
        self.assertEqual(
            calls.count(["docker", "volume", "rm", "-f", "pinned-vol"]), 2)

    def test_remove_image_ref_targets_exact_reference(self):
        from tt_setup.cleanup import _resource_ops as rops
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            if cmd[:3] == ["docker", "image", "ls"]:
                return SimpleNamespace(returncode=0, stdout="abc123\n", stderr="")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with patch.object(rops.subprocess, "run", side_effect=fake_run):
            self.assertTrue(run._remove_image_ref("ghcr.io/x/media:1", True))
        self.assertIn(["docker", "image", "ls", "--filter",
                       "reference=ghcr.io/x/media:1", "-q"], calls)
        self.assertIn(["docker", "image", "rm", "-f", "abc123"], calls)

    def test_remove_docker_containers_uses_rm_fv(self):
        from tt_setup.cleanup import _resource_ops as rops
        calls = []
        with patch.object(rops.subprocess, "run",
                          side_effect=lambda cmd, **k: calls.append(cmd) or
                          SimpleNamespace(returncode=0, stdout="", stderr="")):
            count = run._remove_docker_containers(["c1", "c2"], True)
        self.assertEqual(count, 2)
        self.assertEqual(calls, [["docker", "rm", "-fv", "c1", "c2"]])


if __name__ == "__main__":
    unittest.main()

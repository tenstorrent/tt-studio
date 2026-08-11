# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for --purge-model: name matching, image reference counting, discovery,
and the orchestrator's abort/removal behavior (docker mocked)."""

import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import tt_setup.cleanup as run
from tt_setup.cleanup import _purge_model as _pm

CATALOG = {
    "models": [
        {"model_name": "Llama-3.1-8B-Instruct", "docker_image": "ghcr.io/x/vllm:1",
         "hf_model_id": "meta-llama/Llama-3.1-8B-Instruct"},
        {"model_name": "Llama-3.1-8B-Instruct-FP8", "docker_image": "ghcr.io/x/vllm:1"},
        {"model_name": "Qwen3-32B", "docker_image": "ghcr.io/x/vllm:2"},
        # whisper + speecht5 share an HF repo to exercise cache ref-counting.
        {"model_name": "whisper-large-v3", "docker_image": "ghcr.io/x/media:1",
         "hf_model_id": "shared/tts-repo"},
        {"model_name": "speecht5_tts", "docker_image": "ghcr.io/x/media:1",
         "hf_model_id": "shared/tts-repo"},
        {"model_name": "YOLOv4", "docker_image": "ghcr.io/x/yolo:1",
         "hf_model_id": "yolov4"},  # non-namespaced: no HF cache dir
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

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0,
                     "chmod-based permission test is meaningless as root")
    def test_mark_stopped_falls_back_to_docker_write_on_permission_error(self):
        # deployments.json lives in backend_volume, usually owned by the
        # backend container's user — the host-side write fails and must fall
        # back to the ephemeral-container writer instead of leaving the record
        # stuck on "running".
        with tempfile.TemporaryDirectory() as tmp:
            store = Path(tmp) / "deployments.json"
            self._write(store, [{"model_name": "Qwen3-32B", "container_id": "c1",
                                 "container_name": "tt-inference-server-ab12",
                                 "status": "running"}])
            os.chmod(tmp, 0o555)
            try:
                with patch.object(_pm, "_write_file_with_docker",
                                  return_value=True) as fallback:
                    ok = _pm._mark_deployments_stopped(str(store), ["Qwen3-32B"])
            finally:
                os.chmod(tmp, 0o755)
            self.assertTrue(ok)
            fallback.assert_called_once()
            path, payload = fallback.call_args.args
            self.assertEqual(path, str(store))
            self.assertIn('"stopped"', payload)

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

    def test_stale_running_record_is_ignored_when_docker_is_queryable(self):
        """A record stuck on status "running" (its write-back failed after an
        earlier purge) must not resurrect the model as "deployed" when docker
        confirms no such container exists — only when docker can't be checked
        (live_containers=None) are records trusted."""
        with tempfile.TemporaryDirectory() as tmp:
            pv = self._make_pv(Path(tmp))
            store = str(pv / "backend_volume" / "deployments.json")
            verified = run._installed_models(str(pv), CATALOG["models"], store,
                                             live_containers=[])
            self.assertNotIn("Qwen3-32B", {m["name"] for m in verified})
            unverified = run._installed_models(str(pv), CATALOG["models"], store,
                                               live_containers=None)
            by_name = {m["name"]: m for m in unverified}
            self.assertEqual(len(by_name["Qwen3-32B"]["running"]), 1)


class HfCacheTests(unittest.TestCase):
    def test_cache_dirs_found_across_layouts(self):
        with tempfile.TemporaryDirectory() as tmp:
            hub = Path(tmp) / "hub" / "models--meta-llama--Llama-3.1-8B-Instruct"
            hub.mkdir(parents=True)
            legacy = Path(tmp) / "models--meta-llama--Llama-3.1-8B-Instruct"
            legacy.mkdir()
            locks = Path(tmp) / "hub" / ".locks" / "models--meta-llama--Llama-3.1-8B-Instruct"
            locks.mkdir(parents=True)
            dirs = run._hf_cache_dirs_for_repo(tmp, "meta-llama/Llama-3.1-8B-Instruct")
            self.assertEqual(sorted(dirs), sorted([str(hub), str(legacy), str(locks)]))

    def test_non_namespaced_ids_have_no_cache_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(run._hf_cache_dirs_for_repo(tmp, "yolov4"), [])
            self.assertEqual(run._hf_cache_dirs_for_repo(tmp, None), [])
            self.assertEqual(run._hf_cache_dirs_for_repo(None, "a/b"), [])

    def test_kept_by_counts_installed_unpurged_repo_sharers(self):
        installed = [
            {"name": "speecht5_tts", "hf_model_id": "shared/tts-repo"},
            {"name": "whisper-large-v3", "hf_model_id": "shared/tts-repo"},
            {"name": "Qwen3-32B", "hf_model_id": "Qwen/Qwen3-32B"},
        ]
        self.assertEqual(
            run._hf_cache_kept_by(installed[0], {"speecht5_tts"}, installed),
            ["whisper-large-v3"])
        # Purging both frees the repo; a model with its own repo pins nothing.
        self.assertEqual(
            run._hf_cache_kept_by(installed[0],
                                  {"speecht5_tts", "whisper-large-v3"}, installed),
            [])
        self.assertEqual(
            run._hf_cache_kept_by(installed[2], {"Qwen3-32B"}, installed), [])


class PurgeModelsFlowTests(unittest.TestCase):
    """End-to-end orchestrator runs with docker helpers mocked."""

    def _stack(self, stack, pv, catalog_file, volumes=(), live=(), daemon="ok"):
        stack.enter_context(patch.object(
            _pm, "get_env_var", side_effect=lambda name, default="": str(pv)))
        stack.enter_context(patch.object(
            _pm, "_model_catalog_path", return_value=str(catalog_file)))
        stack.enter_context(patch.object(_pm, "check_docker_access", return_value=True))
        stack.enter_context(patch.object(_pm, "_docker_daemon_status", return_value=daemon))
        stack.enter_context(patch.object(
            _pm, "_docker_volume_names", return_value=list(volumes)))
        stack.enter_context(patch.object(
            _pm, "_running_container_names", return_value=list(live)))
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

    def test_docker_down_says_unchecked_not_missing(self):
        """With the daemon down, volumes can't even be listed — the run must say
        they were NOT CHECKED (with a re-run hint), never that they were absent,
        or users trust a reclaim that left tens of GB in docker volumes."""
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            weights = pv / "volume_id_tt-metal-Llama-3.1-8B-Instruct-v0.0.1"
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file, daemon="down")
                vols = stack.enter_context(patch.object(_pm, "_remove_docker_volumes"))
                args = SimpleNamespace(purge_model=["Llama-3.1-8B-Instruct"],
                                       yes=True, no_sudo=True)
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    code = run.purge_models(args)
            text = " ".join(out.getvalue().split())
            self.assertEqual(code, 0)
            self.assertFalse(weights.exists())   # host-side purge still runs
            vols.assert_not_called()
            self.assertIn("not checked", text)
            self.assertIn("Start Docker and re-run", text)

    def test_in_use_volume_names_holders_and_exits_nonzero(self):
        """A volume that survives removal must flip the run to a warning exit
        with advice that works — name the holding container(s), don't point at
        `--stop`, which leaves deployed models running."""
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            vol = "volume_id_tt-metal-Llama-3.1-8B-Instruct"
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file, volumes=[vol])
                stack.enter_context(patch.object(
                    _pm, "_remove_docker_volumes", return_value=([], [vol])))
                stack.enter_context(patch.object(
                    _pm, "_containers_using_volume", return_value=["stray-ctr"]))
                stack.enter_context(patch.object(
                    _pm, "_remove_image_ref", return_value=True))
                args = SimpleNamespace(purge_model=["Llama-3.1-8B-Instruct"],
                                       yes=True, no_sudo=True)
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    code = run.purge_models(args)
            text = " ".join(out.getvalue().split())
            self.assertEqual(code, 1)
            self.assertIn("finished with issues", text)
            self.assertIn("docker rm -f stray-ctr", text)
            self.assertNotIn("--stop", text)

    def test_failed_file_removal_is_not_reported_as_reclaimed(self):
        """When deleting host files fails (e.g. permissions), the run must not
        print a success header or count those bytes as reclaimed."""
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            weights = pv / "volume_id_tt-metal-Llama-3.1-8B-Instruct-v0.0.1"
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file)
                stack.enter_context(patch.object(
                    _pm, "_remove_docker_volumes", return_value=([], [])))
                stack.enter_context(patch.object(
                    _pm, "_remove_image_ref", return_value=True))
                stack.enter_context(patch.object(
                    _pm, "_remove_path", return_value=False))
                args = SimpleNamespace(purge_model=["Llama-3.1-8B-Instruct"],
                                       yes=True, no_sudo=True)
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    code = run.purge_models(args)
            text = " ".join(out.getvalue().split())
            self.assertEqual(code, 1)
            self.assertTrue(weights.exists())
            self.assertIn("finished with issues", text)
            self.assertIn("Could not remove", text)
            self.assertNotIn("Reclaimed", text)
            self.assertNotIn("Cleanup complete", text)

    def test_purge_removes_hf_cache_weights(self):
        """Forge/vLLM weights live in the HF hub cache (hf_home resolves to pv
        here via the patched get_env_var), not under the persistent volume —
        purging the model must delete its models--… dir and lock stubs."""
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            hub = pv / "hub" / "models--meta-llama--Llama-3.1-8B-Instruct"
            hub.mkdir(parents=True)
            (hub / "model.safetensors").write_text("x" * 128)
            locks = pv / "hub" / ".locks" / "models--meta-llama--Llama-3.1-8B-Instruct"
            locks.mkdir(parents=True)
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file)
                stack.enter_context(patch.object(
                    _pm, "_remove_docker_volumes", return_value=([], [])))
                stack.enter_context(patch.object(
                    _pm, "_remove_image_ref", return_value=True))
                args = SimpleNamespace(purge_model=["Llama-3.1-8B-Instruct"],
                                       yes=True, no_sudo=True)
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    code = run.purge_models(args)
            text = " ".join(out.getvalue().split())
            self.assertEqual(code, 0)
            self.assertFalse(hub.exists())
            self.assertFalse(locks.exists())
            self.assertIn("Hugging Face weights cache", text)

    def test_shared_hf_cache_is_kept_while_a_sharer_remains(self):
        """speecht5 and whisper share an HF repo — purging one must keep the
        cache dir and say so, exactly like shared docker images."""
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            for name in ("speecht5_tts", "whisper-large-v3"):
                (pv / "model_envs" / f"{name}.env").write_text("A=1")
            hub = pv / "hub" / "models--shared--tts-repo"
            hub.mkdir(parents=True)
            (hub / "weights.bin").write_text("x" * 64)
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file)
                stack.enter_context(patch.object(
                    _pm, "_remove_docker_volumes", return_value=([], [])))
                stack.enter_context(patch.object(
                    _pm, "_remove_image_ref", return_value=True))
                args = SimpleNamespace(purge_model=["speecht5_tts"],
                                       yes=True, no_sudo=True)
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    code = run.purge_models(args)
            text = " ".join(out.getvalue().split())
            self.assertEqual(code, 0)
            self.assertTrue(hub.exists())
            self.assertFalse((pv / "model_envs" / "speecht5_tts.env").exists())
            self.assertIn("still used by whisper-large-v3", text)

    def test_record_update_failure_is_reported_not_hidden(self):
        """If deployments.json can't be written even via the container
        fallback, the run must warn that the backend may still list the model
        as deployed, and exit non-zero — a silent 'left as-is' is how purged
        models kept resurrecting in the picker."""
        with tempfile.TemporaryDirectory() as tmp:
            pv, catalog_file = self._setup_tree(Path(tmp))
            with contextlib.ExitStack() as stack:
                self._stack(stack, pv, catalog_file,
                            live=["tt-inference-server-ab12"])
                stack.enter_context(patch.object(
                    _pm, "_remove_docker_containers", return_value=1))
                stack.enter_context(patch.object(
                    _pm, "_remove_docker_volumes", return_value=([], [])))
                stack.enter_context(patch.object(
                    _pm, "_remove_image_ref", return_value=True))
                stack.enter_context(patch.object(
                    _pm, "_mark_deployments_stopped", return_value=False))
                args = SimpleNamespace(purge_model=["Qwen3-32B"], yes=True,
                                       no_sudo=True)
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    code = run.purge_models(args)
            text = " ".join(out.getvalue().split())
            self.assertEqual(code, 1)
            self.assertIn("finished with issues", text)
            self.assertIn("still list the purged model(s) as deployed", text)

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

    def test_remove_docker_containers_counts_only_actual_removals(self):
        # docker echoes each removed container; a name that no longer exists
        # produces no echo, and the count must reflect that.
        from tt_setup.cleanup import _resource_ops as rops
        calls = []
        with patch.object(rops.subprocess, "run",
                          side_effect=lambda cmd, **k: calls.append(cmd) or
                          SimpleNamespace(returncode=1, stdout="c1\n", stderr="")):
            count = run._remove_docker_containers(["c1", "already-gone"], True)
        self.assertEqual(count, 1)
        self.assertEqual(calls, [["docker", "rm", "-fv", "c1", "already-gone"]])


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import run


class CleanupAllTests(unittest.TestCase):
    def _patch_cleanup_paths(self, root, sentinel):
        setup_config = root / ".tt_studio_setup_config.json"
        docker_log = root / "docker-control-service.log"
        docker_pid = root / "docker-control-service.pid"
        return (
            patch.object(run, "TT_STUDIO_ROOT", str(root)),
            patch.object(run, "ENV_FILE_PATH", str(root / ".env")),
            patch.object(run, "LEGACY_ENV_FILE_PATH", str(root / "app" / ".env")),
            patch.object(run, "LEGACY_ENV_BACKUP_PATH", str(root / "app" / ".env-old")),
            patch.object(run, "STARTUP_LOG_FILE", str(root / "startup.log")),
            patch.object(run, "PREFS_FILE_PATH", str(root / ".tt_studio_preferences.json")),
            patch.object(run, "SETUP_CONFIG_FILE_PATH", str(setup_config)),
            patch.object(run, "MODEL_RUN_LOG_FILE", str(root / "model_run.log")),
            patch.object(run, "FASTAPI_PID_FILE", str(root / "fastapi.pid")),
            patch.object(run, "DOCKER_CONTROL_LOG_FILE", str(docker_log)),
            patch.object(run, "DOCKER_CONTROL_PID_FILE", str(docker_pid)),
            patch.object(run, "INFERENCE_API_DIR", str(root / "inference-api")),
            patch.object(run, "DOCKER_CONTROL_SERVICE_DIR", str(root / "docker-control-service")),
            patch.object(run, "BROWSER_CLEANUP_SENTINEL", str(sentinel)),
        )

    def test_cleanup_helpers_handle_sizes_and_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            nested = Path(tmp) / "nested"
            nested.mkdir()
            (nested / "a.txt").write_text("abc")
            (nested / "b.txt").write_text("de")

            self.assertEqual(run._format_bytes(0), "0 B")
            self.assertEqual(run._format_bytes(1024), "1.0 KB")
            self.assertEqual(run._path_size(str(nested)), 5)

            self.assertTrue(run._remove_path(str(nested), no_sudo=True))
            self.assertFalse(nested.exists())

    def test_remove_directory_contents_preserves_tracked_bootstrap(self):
        with tempfile.TemporaryDirectory() as tmp:
            workflow_venvs = Path(tmp) / ".workflow_venvs"
            generated = workflow_venvs / "generated_venv"
            generated.mkdir(parents=True)
            (generated / "payload.txt").write_text("generated")
            bootstrap = workflow_venvs / ".venv_bootstrap_uv"
            bootstrap.write_text("tracked")

            self.assertTrue(run._remove_directory_contents(
                str(workflow_venvs),
                preserve_names={".venv_bootstrap_uv"},
                no_sudo=True,
            ))
            self.assertTrue(bootstrap.exists())
            self.assertFalse(generated.exists())

    def test_write_browser_cleanup_sentinel_uses_numeric_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            sentinel = Path(tmp) / "public" / ".cleanup-pending"
            with patch.object(run, "BROWSER_CLEANUP_SENTINEL", str(sentinel)):
                token = run._write_browser_cleanup_sentinel()

            self.assertIsNotNone(token)
            self.assertTrue(token.isdigit())
            self.assertEqual(sentinel.read_text(), token)

    def test_cleanup_all_aborts_before_destructive_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sentinel = root / "app" / "frontend" / "public" / ".cleanup-pending"
            called = {"runtime": False, "images": False, "sentinel": False}
            with contextlib.ExitStack() as stack:
                for patcher in self._patch_cleanup_paths(root, sentinel):
                    stack.enter_context(patcher)
                stack.enter_context(patch.object(run, "check_docker_access", return_value=True))
                stack.enter_context(patch.object(run, "_docker_reclaimable_bytes", return_value={
                    "images": 0, "model_volumes": 0, "anon_volumes": 0}))
                stack.enter_context(patch("builtins.input", return_value="n"))
                stack.enter_context(patch.object(
                    run,
                    "_cleanup_runtime",
                    side_effect=lambda *args, **kwargs: called.__setitem__("runtime", True),
                ))
                stack.enter_context(patch.object(
                    run,
                    "_remove_local_tt_studio_images",
                    side_effect=lambda *args, **kwargs: called.__setitem__("images", True),
                ))
                stack.enter_context(patch.object(
                    run,
                    "_write_browser_cleanup_sentinel",
                    side_effect=lambda: called.__setitem__("sentinel", True),
                ))
                args = SimpleNamespace(cleanup_all=True, yes=False, no_sudo=True, dev=False)
                with contextlib.redirect_stdout(io.StringIO()):
                    run.cleanup_resources(args)

            self.assertEqual(called, {"runtime": False, "images": False, "sentinel": False})

    def test_cleanup_all_yes_removes_state_and_arms_browser_wipe(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            persistent = root / "tt_studio_persistent_volume"
            persistent.mkdir()
            (persistent / "user_config.json").write_text('{"hf_token": "hf_test"}')
            env_file = root / ".env"
            env_file.write_text("HF_TOKEN=hf_test\n")
            # Legacy pre-consolidation files must also be scrubbed so --cleanup-all
            # cannot leave a stale HF_TOKEN behind (issue #984).
            legacy_env = root / "app" / ".env"
            legacy_env.parent.mkdir(parents=True, exist_ok=True)
            legacy_env.write_text("HF_TOKEN=hf_stale\n")
            legacy_env_old = root / "app" / ".env-old"
            legacy_env_old.write_text("HF_TOKEN=hf_stale\n")
            startup_log = root / "startup.log"
            startup_log.write_text("log")
            prefs = root / ".tt_studio_preferences.json"
            prefs.write_text("{}")
            workflow_venvs = root / ".workflow_venvs"
            workflow_generated = workflow_venvs / "generated_venv"
            workflow_generated.mkdir(parents=True)
            (workflow_generated / "payload.txt").write_text("generated")
            workflow_bootstrap = workflow_venvs / ".venv_bootstrap_uv"
            workflow_bootstrap.write_text("tracked")
            sentinel = root / "app" / "frontend" / "public" / ".cleanup-pending"

            with contextlib.ExitStack() as stack:
                for patcher in self._patch_cleanup_paths(root, sentinel):
                    stack.enter_context(patcher)
                stack.enter_context(patch.object(
                    run,
                    "get_env_var",
                    side_effect=lambda name, default="": default,
                ))
                stack.enter_context(patch.object(run, "check_docker_access", return_value=True))
                stack.enter_context(patch.object(run, "_docker_reclaimable_bytes", return_value={
                    "images": 0, "model_volumes": 0, "anon_volumes": 0}))
                stack.enter_context(patch.object(run, "_cleanup_runtime"))
                stack.enter_context(patch.object(run, "_remove_local_tt_studio_images", return_value=0))
                stack.enter_context(patch.object(run, "_remove_tt_studio_model_volumes", return_value=0))
                stack.enter_context(patch.object(run, "_prune_anonymous_volumes", return_value=0))
                args = SimpleNamespace(cleanup_all=True, yes=True, no_sudo=True, dev=False)
                with contextlib.redirect_stdout(io.StringIO()):
                    run.cleanup_resources(args)

            self.assertFalse(persistent.exists())
            self.assertFalse(env_file.exists())
            self.assertFalse(legacy_env.exists())
            self.assertFalse(legacy_env_old.exists())
            self.assertFalse(startup_log.exists())
            self.assertFalse(prefs.exists())
            self.assertTrue(workflow_bootstrap.exists())
            self.assertFalse(workflow_generated.exists())
            self.assertTrue(sentinel.exists())
            self.assertTrue(sentinel.read_text().isdigit())


class CleanupDockerSurfaceTests(unittest.TestCase):
    """Covers the gaps the original cleanup-all missed: deployment containers
    spawned outside compose, and images outside ghcr.io/tenstorrent/tt-studio/*."""

    def test_remove_local_tt_studio_images_covers_all_known_refs(self):
        # Source of truth is the module constant; the test must follow it,
        # not duplicate it.
        ref_to_id = {ref: f"id_{i}" for i, ref in enumerate(run._CLEANUP_IMAGE_REFS)}
        self.assertIn("ghcr.io/tenstorrent/tt-studio/*", ref_to_id)
        self.assertIn("ghcr.io/tenstorrent/tt-inference-server/*", ref_to_id)
        self.assertIn("ghcr.io/tenstorrent/tt-media-inference-server", ref_to_id)
        self.assertIn("chromadb/chroma", ref_to_id)

        queried_refs = []

        def fake_run(cmd, **kwargs):
            if "ls" in cmd:
                ref = cmd[cmd.index("--filter") + 1].split("=", 1)[1]
                queried_refs.append(ref)
                return SimpleNamespace(stdout=ref_to_id.get(ref, "") + "\n", returncode=0)
            self.assertEqual(cmd[:4], ["docker", "image", "rm", "-f"])
            self.assertEqual(sorted(cmd[4:]), sorted(ref_to_id.values()))
            return SimpleNamespace(stdout="", returncode=0)

        with patch("subprocess.run", side_effect=fake_run):
            removed = run._remove_local_tt_studio_images(has_docker_access=True)

        self.assertEqual(removed, len(ref_to_id))
        self.assertEqual(sorted(queried_refs), sorted(ref_to_id))

    def test_remove_tt_studio_model_volumes_prefix_filters_unrelated(self):
        # docker volume ls --filter name=foo is substring match; the helper
        # must add a Python-side prefix guard so we don't blow away an
        # unrelated volume whose name happens to contain "volume_id_".
        listed = (
            "volume_id_tt_transformers-Llama-3.1-8B\n"
            "volume_id_whisper-distil-large-v3\n"
            "not_a_match_volume_id_extra\n"  # contains substring but wrong prefix
            "\n"
        )
        recorded = {}

        def fake_run(cmd, **kwargs):
            if "ls" in cmd:
                self.assertIn(f"name={run._CLEANUP_VOLUME_PREFIX}", cmd)
                return SimpleNamespace(stdout=listed, returncode=0)
            recorded["rm"] = cmd
            return SimpleNamespace(stdout="", returncode=0)

        with patch("subprocess.run", side_effect=fake_run):
            removed = run._remove_tt_studio_model_volumes(has_docker_access=True)

        self.assertEqual(removed, 2)
        self.assertEqual(recorded["rm"][:4], ["docker", "volume", "rm", "-f"])
        self.assertEqual(
            sorted(recorded["rm"][4:]),
            ["volume_id_tt_transformers-Llama-3.1-8B",
             "volume_id_whisper-distil-large-v3"],
        )

    def test_prune_anonymous_volumes_counts_delta(self):
        # Simulate: ls before sees 5 volumes, prune wipes 2 anonymous ones,
        # ls after sees 3. Helper must return 2.
        ls_responses = iter([
            SimpleNamespace(stdout="a\nb\nc\nanon1\nanon2\n", returncode=0),
            SimpleNamespace(stdout="a\nb\nc\n", returncode=0),
        ])
        prune_calls = []

        def fake_run(cmd, **kwargs):
            if "prune" in cmd:
                prune_calls.append(cmd)
                # `--force` and *without* --all (named volumes must survive).
                self.assertIn("--force", cmd)
                self.assertNotIn("--all", cmd)
                self.assertNotIn("-a", cmd)
                return SimpleNamespace(stdout="", returncode=0)
            self.assertIn("ls", cmd)
            return next(ls_responses)

        with patch("subprocess.run", side_effect=fake_run):
            removed = run._prune_anonymous_volumes(has_docker_access=True)

        self.assertEqual(removed, 2)
        self.assertEqual(len(prune_calls), 1)

    def test_prune_anonymous_volumes_zero_when_nothing_changes(self):
        ls_responses = iter([
            SimpleNamespace(stdout="a\nb\n", returncode=0),
            SimpleNamespace(stdout="a\nb\n", returncode=0),
        ])

        def fake_run(cmd, **kwargs):
            if "prune" in cmd:
                return SimpleNamespace(stdout="", returncode=0)
            return next(ls_responses)

        with patch("subprocess.run", side_effect=fake_run):
            self.assertEqual(run._prune_anonymous_volumes(has_docker_access=True), 0)

    def test_remove_tt_studio_model_volumes_noop_when_empty(self):
        rm_called = {"yes": False}

        def fake_run(cmd, **kwargs):
            if "ls" in cmd:
                return SimpleNamespace(stdout="\n", returncode=0)
            rm_called["yes"] = True
            return SimpleNamespace(stdout="", returncode=0)

        with patch("subprocess.run", side_effect=fake_run):
            removed = run._remove_tt_studio_model_volumes(has_docker_access=True)

        self.assertEqual(removed, 0)
        self.assertFalse(rm_called["yes"], "must not invoke `volume rm` with no volumes")

    def test_remove_tt_studio_network_containers_force_removes_all(self):
        recorded = {}

        def fake_run(cmd, **kwargs):
            if "ps" in cmd:
                # Two enumeration passes: by network membership, and by image
                # ancestor for media containers that miss the post-deploy
                # network connect (see _CLEANUP_IMAGE_REFS).
                filter_arg = cmd[cmd.index("--filter") + 1]
                self.assertTrue(
                    filter_arg == "network=tt_studio_network"
                    or filter_arg.startswith("ancestor="),
                    f"unexpected --filter: {filter_arg}",
                )
                if filter_arg == "network=tt_studio_network":
                    return SimpleNamespace(stdout="abc\ndef\n", returncode=0)
                return SimpleNamespace(stdout="", returncode=0)
            recorded["rm"] = cmd
            return SimpleNamespace(stdout="", returncode=0)

        with patch("subprocess.run", side_effect=fake_run):
            removed = run._remove_tt_studio_network_containers(has_docker_access=True)

        self.assertEqual(removed, 2)
        # -fv (force + volumes) so anonymous volumes attached to the container
        # don't orphan when we remove the container before compose down -v.
        self.assertEqual(recorded["rm"][:3], ["docker", "rm", "-fv"])
        self.assertEqual(sorted(recorded["rm"][3:]), ["abc", "def"])

    def test_remove_tt_studio_network_containers_uses_sudo_without_access(self):
        seen_prefixes = []

        def fake_run(cmd, **kwargs):
            seen_prefixes.append(cmd[0])
            if "ps" in cmd:
                return SimpleNamespace(stdout="xyz\n", returncode=0)
            return SimpleNamespace(stdout="", returncode=0)

        with patch("subprocess.run", side_effect=fake_run):
            run._remove_tt_studio_network_containers(has_docker_access=False)

        # 1 network-filter ps + N ancestor-filter ps (one per image ref) + 1 rm.
        expected_calls = 2 + len(run._CLEANUP_IMAGE_REFS)
        self.assertEqual(seen_prefixes, ["sudo"] * expected_calls)

    def test_parse_size_to_bytes_handles_docker_si_units(self):
        # Docker reports sizes as SI (base 1000) strings via go-units.
        self.assertEqual(run._parse_size_to_bytes("32B"), 32)
        self.assertEqual(run._parse_size_to_bytes("545kB"), 545_000)
        self.assertEqual(run._parse_size_to_bytes("628.7MB"), 628_700_000)
        self.assertEqual(run._parse_size_to_bytes("39.42GB"), 39_420_000_000)
        # Degrades to 0 on empty / unparseable input.
        self.assertEqual(run._parse_size_to_bytes(""), 0)
        self.assertEqual(run._parse_size_to_bytes("N/A"), 0)

    def test_docker_reclaimable_bytes_sums_only_removed_objects(self):
        # Mirrors `docker system df -v --format json`: only images matching
        # _CLEANUP_IMAGE_REFS, volume_id_* model volumes, and anonymous volumes
        # count — unrelated images/volumes and build cache must be ignored.
        payload = {
            "Images": [
                {"Repository": "ghcr.io/tenstorrent/tt-studio/backend-dev", "Size": "11.6GB"},
                {"Repository": "ghcr.io/tenstorrent/tt-inference-server/vllm", "Size": "23.3GB"},
                {"Repository": "chromadb/chroma", "Size": "699MB"},
                {"Repository": "alpine", "Size": "13.1MB"},  # unrelated — excluded
            ],
            "Volumes": [
                {"Name": "volume_id_tt_transformers-Llama-3.1-8B", "Size": "39.42GB",
                 "Labels": ""},
                {"Name": "bc66deadbeef", "Size": "628.7MB",
                 "Labels": "com.docker.volume.anonymous="},  # anonymous — counted
                {"Name": "app_hf_cache", "Size": "91.58MB", "Labels": ""},  # named, unrelated
            ],
            "BuildCache": [{"Size": "35.97GB"}],  # never pruned by cleanup-all — excluded
        }

        def fake_run(cmd, **kwargs):
            self.assertEqual(cmd[:5], ["docker", "system", "df", "-v", "--format"])
            return SimpleNamespace(stdout=json.dumps(payload), returncode=0)

        with patch("subprocess.run", side_effect=fake_run):
            sizes = run._docker_reclaimable_bytes(has_docker_access=True)

        self.assertEqual(sizes["images"],
                         run._parse_size_to_bytes("11.6GB")
                         + run._parse_size_to_bytes("23.3GB")
                         + run._parse_size_to_bytes("699MB"))
        self.assertEqual(sizes["model_volumes"], run._parse_size_to_bytes("39.42GB"))
        self.assertEqual(sizes["anon_volumes"], run._parse_size_to_bytes("628.7MB"))

    def test_docker_reclaimable_bytes_zero_when_docker_unavailable(self):
        def fake_run(cmd, **kwargs):
            return SimpleNamespace(stdout="not json", returncode=1)

        with patch("subprocess.run", side_effect=fake_run):
            self.assertEqual(
                run._docker_reclaimable_bytes(has_docker_access=True),
                {"images": 0, "model_volumes": 0, "anon_volumes": 0},
            )

    def _record_runtime_order(self, args):
        order = []

        def record_deployments(*a, **kwargs):
            order.append("deployments")
            return 2

        def record_run_docker(cmd, **kwargs):
            if "down" in cmd:
                order.append("compose_down")
            elif "network" in cmd and "rm" in cmd:
                order.append("network_rm")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with patch.object(run, "_remove_tt_studio_network_containers", side_effect=record_deployments), \
             patch.object(run, "run_docker_command", side_effect=record_run_docker), \
             patch.object(run, "cleanup_fastapi_server"), \
             patch.object(run, "cleanup_docker_control_service"), \
             contextlib.redirect_stdout(io.StringIO()):
            run._cleanup_runtime(args, has_docker_access=True)
        return order

    def test_cleanup_runtime_preserves_deployments_for_basic_cleanup(self):
        # Plain `--cleanup` must not touch deployment containers — loaded
        # models stay serving so a TT Studio restart doesn't pay the ~minutes
        # cost of re-loading weights onto the device. The shared docker
        # network also stays since deployments are attached to it.
        args = SimpleNamespace(dev=False, no_sudo=True, cleanup_all=False)
        order = self._record_runtime_order(args)
        self.assertNotIn("deployments", order)
        self.assertNotIn("network_rm", order)
        self.assertIn("compose_down", order)

    def test_cleanup_runtime_stops_deployments_first_for_full_cleanup(self):
        # `--cleanup-all` is the full reset path; deployments must be torn
        # down before `compose down -v` so the network is empty when we then
        # remove it.
        args = SimpleNamespace(dev=False, no_sudo=True, cleanup_all=True)
        order = self._record_runtime_order(args)
        self.assertEqual(order[:3], ["deployments", "compose_down", "network_rm"])


class TermsAcceptanceGateTests(unittest.TestCase):
    def test_accepting_terms_persists_prefs_and_gates_off_first_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            prefs = Path(tmp) / ".tt_studio_preferences.json"
            with patch.object(run, "PREFS_FILE_PATH", str(prefs)):
                # No prefs file → treated as first run (terms asked).
                self.assertTrue(run.is_first_time_setup())

                # Accepting terms writes the prefs file (the fix: in the default
                # quick setup this was previously never created, so terms re-fired every run).
                run.save_preference("terms_accepted", True)
                self.assertTrue(prefs.exists())

                # Prefs file now exists → no longer treated as first run.
                self.assertFalse(run.is_first_time_setup())


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for how the community router reads the bridge's output.

The bridge's stdout is the only channel between tt-model-manager and TT Studio, so
these cover the two ways that channel can go wrong: extra output around the JSON, and
an error event whose message has to reach the user intact.
"""

import asyncio
import json
import sys
import threading
import time
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import community  # noqa: E402


class TestLastJsonLine:
    def test_returns_the_final_object(self):
        text = "\n".join([
            "some tool wrote here",
            json.dumps({"event": "stage", "progress": 10}),
            json.dumps({"event": "result", "status": "success"}),
        ])
        assert community._last_json_line(text)["event"] == "result"

    def test_none_when_there_is_no_json(self):
        assert community._last_json_line("") is None
        assert community._last_json_line("garbage\n") is None

    def test_ignores_non_object_json(self):
        # A bare list or scalar is not a result document.
        assert community._last_json_line("[1, 2]\n3\n") is None


class TestErrorDetail:
    def test_flattens_message_detail_and_first_action(self):
        message = community._error_detail({
            "message": "you do not have access",
            "detail": "the repo is gated",
            "actions": ["accept the terms", "log in"],
        })
        assert "you do not have access" in message
        assert "the repo is gated" in message
        assert "accept the terms" in message
        # Only the first action: the rest would bury the actionable one in a toast.
        assert "log in" not in message

    def test_survives_a_bare_event(self):
        assert community._error_detail({}) == "community model operation failed"


class TestRouter:
    def test_exposes_the_expected_surface(self):
        router = community.create_community_router(
            progress_store={}, log_store={}, progress_lock=threading.Lock(),
            max_log_messages=10,
        )
        paths = {route.path for route in router.routes}
        assert paths == {
            "/community/status",
            "/community/models",
            "/community/models/{repo_id:path}",
            "/community/run",
            "/community/stop",
        }

    def test_run_request_does_not_wait_for_ready_by_default(self):
        request = community.CommunityRunRequest(repo_id="ns/name")
        assert request.wait_ready is False


class TestDriveServe:
    """The NDJSON stream is mapped into the shared job stores by a background thread.

    Driven with a stub runner rather than tt-model-manager: what is under test is the
    translation, and the real thing would need a board and ten minutes.
    """

    STUB = """
import json, sys
for event in [
    {"event": "stage", "stage": "model_preparation", "progress": 10, "message": "Installing…"},
    {"event": "log", "level": "INFO", "message": "loading image"},
    {"event": "warning", "message": "could not connect to tt_studio_network"},
    {"event": "started", "container_name": "tt-model-x-default", "container_id": "abc123", "port": 7001},
    {"event": "result", "status": "success", "container_name": "tt-model-x-default", "container_id": "abc123", "port": 7001},
]:
    print(json.dumps(event), flush=True)
"""

    FAILING_STUB = """
import json, sys
print(json.dumps({"event": "stage", "stage": "initialization", "progress": 2, "message": "Resolving…"}), flush=True)
print(json.dumps({"event": "error", "message": "you do not have access", "detail": "gated"}), flush=True)
sys.exit(1)
"""

    # Records the argv it was handed beside itself, so a test can assert what the
    # router actually asked tt-model-manager to do.
    ARGV_STUB = """
import json, sys
open(sys.argv[0] + ".argv.json", "w").write(json.dumps(sys.argv[1:]))
print(json.dumps({"event": "result", "status": "success"}), flush=True)
"""

    def _drive(self, tmp_path, monkeypatch, script, request=None, log_dir=None):
        """Run one deploy against a stub runner; return its progress record and logs."""
        runner = tmp_path / "stub_runner.py"
        runner.write_text(script)
        monkeypatch.setattr(community, "RUNNER", str(runner))
        monkeypatch.setattr(community, "runner_python", lambda: sys.executable)

        progress_store: dict = {}
        log_store: dict = {}
        router = community.create_community_router(
            progress_store=progress_store, log_store=log_store,
            progress_lock=threading.Lock(), max_log_messages=50,
            deployment_log_dir=log_dir,
        )
        # Reached through the route it backs, so the test drives the same closure the
        # app does rather than a copy of it.
        run_route = next(r for r in router.routes if r.path == "/community/run")
        response = asyncio.run(
            run_route.endpoint(request or community.CommunityRunRequest(repo_id="ns/name"))
        )
        job_id = response["job_id"]

        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if progress_store[job_id].get("status") in ("completed", "error"):
                break
            time.sleep(0.02)
        return progress_store[job_id], list(log_store[job_id])

    def test_success_reaches_completed_with_the_container(self, tmp_path, monkeypatch):
        progress, logs = self._drive(tmp_path, monkeypatch, self.STUB)
        assert progress["status"] == "completed"
        assert progress["stage"] == "complete"
        assert progress["progress"] == 100
        # The backend swaps the job id for this container id when the job completes.
        assert progress["container_id"] == "abc123"
        assert progress["container_name"] == "tt-model-x-default"
        messages = [entry["message"] for entry in logs]
        assert "loading image" in messages
        assert any(entry["level"] == "WARNING" for entry in logs)

    def _serve_argv(self, tmp_path, monkeypatch, request):
        self._drive(tmp_path, monkeypatch, self.ARGV_STUB, request)
        return json.loads((tmp_path / "stub_runner.py.argv.json").read_text())

    def test_device_ids_are_passed_to_the_runner(self, tmp_path, monkeypatch):
        argv = self._serve_argv(
            tmp_path, monkeypatch,
            community.CommunityRunRequest(
                repo_id="ns/name", profile="default", service_port=7002, device_ids=[2, 3]
            ),
        )
        assert argv[:2] == ["serve", "ns/name"]
        # tt-model's own spelling: one comma-separated --device-id.
        assert argv[argv.index("--device-id") + 1] == "2,3"

    def test_no_wait_ready_means_no_boot_watch(self, tmp_path, monkeypatch):
        argv = self._serve_argv(
            tmp_path, monkeypatch, community.CommunityRunRequest(repo_id="ns/name")
        )
        assert "--wait-ready" not in argv

    def test_no_device_ids_leaves_the_pick_to_tt_model_manager(self, tmp_path, monkeypatch):
        argv = self._serve_argv(
            tmp_path, monkeypatch, community.CommunityRunRequest(repo_id="ns/name")
        )
        assert "--device-id" not in argv

    def test_error_event_becomes_a_terminal_error(self, tmp_path, monkeypatch):
        progress, logs = self._drive(tmp_path, monkeypatch, self.FAILING_STUB)
        assert progress["status"] == "error"
        assert progress["stage"] == "error"
        assert "you do not have access" in progress["message"]
        assert "gated" in progress["message"]
        assert any(entry["level"] == "ERROR" for entry in logs)


class TestDownloadProgress:
    """``download`` events land on the progress record in inference-api's own shape."""

    # Stops mid-download, so the record is read while the counters are live.
    DOWNLOADING = """
import json, sys
print(json.dumps({"event": "download", "weights_repo": "org/w", "weights_cached": True}), flush=True)
print(json.dumps({"event": "download", "stage": "pulling_image", "message": "Pulling Docker Image...", "weights_repo": "tt-model/x:1", "downloaded_bytes": 5, "total_bytes": 10, "speed_bps": 1.0, "eta_seconds": 5.0, "expects_weights": True}), flush=True)
print(json.dumps({"event": "error", "message": "stop here"}), flush=True)
sys.exit(1)
"""

    FINISHED = """
import json
print(json.dumps({"event": "download", "stage": "model_preparation", "message": "Downloading weights", "weights_repo": "org/w", "downloaded_bytes": 10, "total_bytes": 10}), flush=True)
print(json.dumps({"event": "stage", "stage": "container_setup", "progress": 60, "message": "Starting…"}), flush=True)
print(json.dumps({"event": "result", "status": "success", "container_name": "c", "container_id": "i"}), flush=True)
"""

    def test_byte_counters_are_copied(self, tmp_path, monkeypatch):
        progress, logs = TestDriveServe()._drive(tmp_path, monkeypatch, self.DOWNLOADING)
        assert progress["downloaded_bytes"] == 5
        assert progress["total_bytes"] == 10
        assert progress["weights_repo"] == "tt-model/x:1"
        # The stage-less cached event sets its flag without touching the stage.
        assert progress["weights_cached"] is True
        assert not any("Pulling" in entry["message"] for entry in logs)

    def test_the_next_stage_clears_the_counters(self, tmp_path, monkeypatch):
        progress, _ = TestDriveServe()._drive(tmp_path, monkeypatch, self.FINISHED)
        assert progress["status"] == "completed"
        assert "downloaded_bytes" not in progress
        assert progress["weights_repo"] == "org/w"


class TestDeploymentLog:
    """A deploy's log outlives the deploy, in the directory the logs browser lists."""

    STUB = """
import json, sys
print(json.dumps({"event": "stage", "stage": "container_setup", "progress": 60, "message": "Starting…"}), flush=True)
print(json.dumps({"event": "log", "level": "INFO", "message": "engine line one"}), flush=True)
print("this went to stderr, as tt-model-manager's own output does", file=sys.stderr, flush=True)
print(json.dumps({"event": "result", "status": "success", "container_name": "tt-model-x", "container_id": "abc", "port": 7000}), flush=True)
"""

    # Exits non-zero having said nothing on stdout: the reason exists only in what it
    # printed, which is the case the log tail has to answer for.
    SILENT_FAILURE_STUB = """
import sys
print("FileNotFoundError: weights snapshot is not a local snapshot", file=sys.stderr, flush=True)
sys.exit(1)
"""

    def _drive(self, tmp_path, monkeypatch, script, log_dir):
        return TestDriveServe()._drive(tmp_path, monkeypatch, script, log_dir=log_dir)

    def _only_log(self, log_dir):
        files = list(log_dir.glob("*.log"))
        assert len(files) == 1, files
        return files[0]

    def test_the_log_is_written_where_every_consumer_looks(self, tmp_path, monkeypatch):
        log_dir = tmp_path / "model_run_logs"
        progress, _ = self._drive(tmp_path, monkeypatch, self.STUB, log_dir)
        log = self._only_log(log_dir)
        # Discovered by listing the directory for *.log, so the suffix matters.
        assert log.name.startswith("model_run_")
        assert log.name.endswith(".log")
        assert progress["log_file"] == str(log)

    def test_the_log_holds_the_events_and_the_runners_own_output(self, tmp_path, monkeypatch):
        log_dir = tmp_path / "model_run_logs"
        self._drive(tmp_path, monkeypatch, self.STUB, log_dir)
        body = self._only_log(log_dir).read_text()
        assert "deploying ns/name" in body
        assert "engine line one" in body
        assert "Starting" in body
        # stderr is redirected into the same file: a pipe nobody drains until exit
        # would deadlock a long weights download.
        assert "this went to stderr" in body

    def test_a_silent_failure_is_explained_from_the_log(self, tmp_path, monkeypatch):
        log_dir = tmp_path / "model_run_logs"
        progress, logs = self._drive(tmp_path, monkeypatch, self.SILENT_FAILURE_STUB, log_dir)
        assert progress["status"] == "error"
        assert "FileNotFoundError" in progress["message"]
        assert any(entry["level"] == "ERROR" for entry in logs)

    def test_no_log_dir_configured_still_deploys(self, tmp_path, monkeypatch):
        # Persistence is an addition, not a dependency.
        progress, _ = self._drive(tmp_path, monkeypatch, self.STUB, None)
        assert progress["status"] == "completed"
        assert "log_file" not in progress


class TestDeploymentLogPath:
    def test_a_hub_id_becomes_a_usable_filename(self, tmp_path):
        path = community.deployment_log_path(tmp_path, "ns/some-model", "p300x2")
        assert "/" not in path.name.replace(".log", "")
        assert "ns-some-model" in path.name
        assert "p300x2" in path.name

    def test_no_profile_is_named_default(self, tmp_path):
        path = community.deployment_log_path(tmp_path, "ns/model", None)
        assert "default" in path.name

    def test_the_directory_is_created(self, tmp_path):
        target = tmp_path / "nested" / "model_run_logs"
        community.deployment_log_path(target, "ns/model", "p150")
        assert target.is_dir()

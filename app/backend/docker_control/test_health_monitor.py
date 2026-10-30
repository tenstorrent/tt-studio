# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""How a model that dies on its own is recorded, whichever backend started it.

Both backends keep the container's output in a file the record points at
(``workflow_log_path``), so a death is reported from that file the same way, and a
leftover container is cleared through the backend that owns it.
"""

from unittest.mock import MagicMock, patch

from docker_control import health_monitor, launchers
from docker_control.deployment_sync import _do_sync
from docker_control.docker_control_client import ContainerNotFound
from docker_control.models import ModelDeployment
from docker_control.test_deploy_reservation import IsolatedStoreTestCase
from shared_config.community_model_config import community_model_id

CONTAINER_ID = "a" * 64


class UnexpectedDeathTests(IsolatedStoreTestCase):
    def _deployment(self, log_lines=None, failure=None, **fields):
        log_path = None
        if log_lines is not None:
            log_path = f"{self._tmp.name}/container.log"
            with open(log_path, "w") as handle:
                handle.write("\n".join(log_lines) + "\n")
        dep = ModelDeployment.objects.create(
            container_id=CONTAINER_ID,
            container_name="tt-model-x-p150",
            model_name="ns/x",
            device="p300x2",
            status="running",
            port=7000,
            workflow_log_path=log_path,
            **fields,
        )
        if failure:
            dep.failure_reason, dep.failure_message = failure
            dep.save()
        return dep

    def _check(self, docker):
        # Removal runs on a background thread in production; inline here.
        with patch.object(health_monitor, "get_docker_client", return_value=docker), \
             patch.object(health_monitor, "_service_unreachable", False), \
             patch.object(health_monitor, "_remove_dead_container_in_background",
                          health_monitor._remove_dead_container):
            health_monitor.check_container_health()
        return ModelDeployment.objects.filter(container_id=CONTAINER_ID).first()

    def test_an_exited_community_model_keeps_its_reason_and_is_removed(self):
        self._deployment(
            ["loading", "TT_FATAL: Requested mesh shape requires 4 devices", "backtrace"],
            community_model_id=community_model_id("ns/x", "p150"),
        )
        docker = MagicMock()
        docker.get_container.return_value = {"status": "exited", "attrs": {"State": {"ExitCode": 2}}}
        community = launchers.get(launchers.COMMUNITY)
        with patch.object(community, "stop") as stop:
            dep = self._check(docker)
        self.assertEqual(dep.status, "exited")
        self.assertIn("TT_FATAL: Requested mesh shape requires 4 devices", dep.failure_message)
        self.assertEqual(dep.failure_reason, "unknown")
        # The container is removed, so its exit code is kept with the reason.
        self.assertTrue(dep.failure_message.startswith("Container exited with code 2.\n"))
        # tt-model-manager removes it, resetting the chips if the server was killed.
        stop.assert_called_once()
        docker.remove_container.assert_called_once_with(CONTAINER_ID, force=True)

    def test_a_vanished_inference_server_model_keeps_its_reason(self):
        # --rm containers are gone by the time the monitor looks: the log file is all
        # that is left of them.
        self._deployment(["Traceback (most recent call last):", "RuntimeError: out of memory"])
        docker = MagicMock()
        docker.get_container.side_effect = ContainerNotFound(CONTAINER_ID)
        dep = self._check(docker)
        self.assertEqual(dep.status, "dead")
        self.assertIn("RuntimeError: out of memory", dep.failure_message)

    def test_a_paused_container_is_marked_but_kept(self):
        self._deployment(["serving"], community_model_id=community_model_id("ns/x", "p150"))
        docker = MagicMock()
        docker.get_container.return_value = {"status": "paused"}
        with patch.object(launchers.get(launchers.COMMUNITY), "stop") as stop:
            dep = self._check(docker)
        self.assertEqual(dep.status, "paused")
        stop.assert_not_called()
        docker.remove_container.assert_not_called()

    def test_an_exit_code_alone_is_still_a_reason(self):
        self._deployment()
        docker = MagicMock()
        docker.get_container.return_value = {"status": "exited", "attrs": {"State": {"ExitCode": 137}}}
        with patch.object(launchers.get(launchers.INFERENCE_SERVER), "stop"):
            dep = self._check(docker)
        self.assertEqual(dep.failure_reason, "unknown")
        self.assertEqual(dep.failure_message, "Container exited with code 137.")

    def test_removal_does_not_block_the_poll(self):
        self._deployment(["boom"])
        docker = MagicMock()
        docker.get_container.return_value = {"status": "exited"}
        started = []
        with patch.object(health_monitor, "get_docker_client", return_value=docker), \
             patch.object(health_monitor, "_service_unreachable", False), \
             patch.object(health_monitor.threading, "Thread") as thread:
            thread.return_value.start.side_effect = lambda: started.append(True)
            health_monitor.check_container_health()
        self.assertEqual(started, [True])
        self.assertIs(thread.call_args.kwargs["target"], health_monitor._remove_dead_container)
        docker.remove_container.assert_not_called()

    def test_a_death_with_no_log_records_no_reason(self):
        self._deployment()
        docker = MagicMock()
        docker.get_container.return_value = {"status": "exited"}
        with patch.object(launchers.get(launchers.INFERENCE_SERVER), "stop"):
            dep = self._check(docker)
        self.assertEqual(dep.status, "exited")
        self.assertIsNone(dep.failure_reason)
        self.assertIsNone(dep.failure_message)

    def test_an_existing_failure_reason_is_kept(self):
        self._deployment(["RuntimeError: boom"], failure=("hf_auth", "401"))
        docker = MagicMock()
        docker.get_container.return_value = {"status": "exited"}
        with patch.object(launchers.get(launchers.INFERENCE_SERVER), "stop"):
            dep = self._check(docker)
        self.assertEqual((dep.failure_reason, dep.failure_message), ("hf_auth", "401"))

    def test_the_log_tail_skips_blank_lines_and_is_bounded(self):
        dep = self._deployment([f"line {i}" for i in range(100)] + ["", ""])
        tail = health_monitor._log_tail(dep.workflow_log_path).splitlines()
        self.assertEqual(len(tail), health_monitor._DEATH_LOG_LINES)
        self.assertEqual(tail[-1], "line 99")


class CompletedJobLogPathTests(IsolatedStoreTestCase):
    def test_the_container_log_path_is_recorded(self):
        ModelDeployment.objects.create(
            container_id="job1", container_name="ns/x", model_name="ns/x",
            device="p300x2", status="starting", port=7000,
        )
        with patch("model_control.model_utils.update_deploy_cache"):
            _do_sync("job1", {
                "status": "completed",
                "container_id": CONTAINER_ID,
                "container_name": "tt-model-x-p150",
                "docker_log_file_path": "/logs/model_run_x_community.log",
            })
        dep = ModelDeployment.objects.filter(container_id=CONTAINER_ID).first()
        self.assertEqual(dep.status, "running")
        self.assertEqual(dep.workflow_log_path, "/logs/model_run_x_community.log")

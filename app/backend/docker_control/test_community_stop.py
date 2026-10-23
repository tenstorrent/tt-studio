# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A community stop keeps its record running until tt-model-manager confirms it (issue #1387)."""

import asyncio
import threading
from unittest.mock import MagicMock, patch

from docker_control import views
from docker_control.launchers.base import StopResult
from docker_control.models import ModelDeployment
from docker_control.test_deploy_reservation import IsolatedStoreTestCase

CONTAINER_ID = "c" * 64


class CommunityStopTests(IsolatedStoreTestCase):
    def setUp(self):
        super().setUp()
        self.dep = ModelDeployment.objects.create(
            container_id=CONTAINER_ID,
            model_name="org/bundle",
            community_model_id="org/bundle:default",
            status="running",
        )
        docker = MagicMock()
        docker.get_container.return_value = {"status": "running"}
        self.launcher = MagicMock()
        for p in (
            patch.object(views, "get_docker_client", return_value=docker),
            patch.object(views.launchers, "get", return_value=self.launcher),
            patch.object(views, "update_deploy_cache"),
        ):
            p.start()
            self.addCleanup(p.stop)

    def _record(self):
        return ModelDeployment.objects.get(id=self.dep.id)

    def _run_stop(self):
        async def consume():
            lines = []
            try:
                async for line in views._astream_stop_remove_container(CONTAINER_ID, CONTAINER_ID[:12]):
                    lines.append(line)
            except views._StopFailed as e:
                return lines, e
            return lines, None

        return asyncio.run(consume())

    def test_record_stays_running_while_the_stop_is_in_flight(self):
        seen = {}

        def stop(_):
            record = self._record()
            seen.update(status=record.status, stopped_by_user=record.stopped_by_user)
            return StopResult(status="success")

        self.launcher.stop.side_effect = stop
        self._run_stop()

        self.assertEqual(seen, {"status": "running", "stopped_by_user": True})

    def test_failed_stop_leaves_the_record_running(self):
        self.launcher.stop.return_value = StopResult(status="error", message="tt-model-manager did not respond")

        _, error = self._run_stop()

        self.assertIsInstance(error, views._StopFailed)
        self.assertIn("try stopping it again", str(error))
        record = self._record()
        self.assertEqual(record.status, "running")
        self.assertIsNone(record.stopped_at)
        self.assertFalse(record.stopped_by_user)

    def test_launcher_exception_is_a_stop_failure(self):
        self.launcher.stop.side_effect = RuntimeError("boom")

        _, error = self._run_stop()

        self.assertIsInstance(error, views._StopFailed)
        self.assertEqual(self._record().status, "running")

    def test_successful_stop_marks_the_record_stopped(self):
        self.launcher.stop.return_value = StopResult(status="success")

        _, error = self._run_stop()

        self.assertIsNone(error)
        record = self._record()
        self.assertEqual(record.status, "stopped")
        self.assertIsNotNone(record.stopped_at)
        self.assertTrue(record.stopped_by_user)

    def test_outcome_is_recorded_after_the_client_disconnects(self):
        release = threading.Event()

        def stop(_):
            release.wait(5)
            return StopResult(status="success")

        self.launcher.stop.side_effect = stop

        async def disconnect_mid_stop():
            stream = views._astream_stop_remove_container(CONTAINER_ID, CONTAINER_ID[:12])
            await stream.__anext__()  # the "Stopping … via tt-model-manager" line
            pending = asyncio.ensure_future(stream.__anext__())
            await asyncio.sleep(0.05)
            pending.cancel()
            release.set()

        # asyncio.run waits for the worker thread before returning.
        asyncio.run(disconnect_mid_stop())

        self.assertEqual(self._record().status, "stopped")

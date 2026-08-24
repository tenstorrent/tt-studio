# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Regression tests for the deploy-window bug (GitHub issue #1271).

A chat deploy's ModelDeployment record sits in 'starting' with no Docker container
for the whole host-side weights download, because tt-inference-server runs
`hf download` before it ever calls `docker run`. The canonical reconciler used to
reap that record after 60s, freeing the chip slots mid-deploy and letting a second
deploy be admitted onto a busy board.
"""

import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from docker_control import deployment_store
from docker_control.chip_allocator import ChipSlotAllocator, MultiChipConflictError
from docker_control.deployment_sync import _heartbeat_starting_record
from docker_control.models import ModelDeployment

MODEL = "Qwen3.8-27B"  # 4-chip model: occupies every slot on a P300x2


class IsolatedStoreTestCase(TestCase):
    """Point the deployment store at a scratch file for the duration of a test.

    ModelDeployment is backed by a JSON file in the persistent volume, not the ORM,
    so Django's per-test transaction rollback does not cover it. Without this,
    every test that creates a deployment writes into the real deployments.json.
    """

    def setUp(self):
        super().setUp()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        store_patch = patch.object(
            deployment_store, "_STORE_PATH", Path(self._tmp.name) / "deployments.json"
        )
        store_patch.start()
        self.addCleanup(store_patch.stop)


class StartingRecordHeartbeatTests(IsolatedStoreTestCase):
    """Fix 1: a live job's record must survive the reconciler's grace window."""

    def _make_starting_record(self, age_seconds: int) -> ModelDeployment:
        dep = ModelDeployment.objects.create(
            container_id="job_under_test",
            container_name=MODEL,
            model_name=MODEL,
            device="p300x2",
            device_id=0,
            device_ids=[0, 1, 2, 3],
            status="starting",
            port=7000,
        )
        dep.deployed_at = timezone.now() - timedelta(seconds=age_seconds)
        dep.save()
        return dep

    def test_heartbeat_refreshes_a_stale_starting_record(self):
        dep = self._make_starting_record(age_seconds=120)
        stale_deployed_at = dep.deployed_at

        _heartbeat_starting_record("job_under_test")

        refreshed = ModelDeployment.objects.filter(container_id="job_under_test").first()
        self.assertGreater(
            refreshed.deployed_at,
            stale_deployed_at,
            "heartbeat must push deployed_at forward so the reconciler keeps trusting "
            "the record while its job is still downloading weights",
        )

    def test_heartbeat_leaves_non_starting_records_alone(self):
        dep = self._make_starting_record(age_seconds=120)
        dep.status = "running"
        dep.save()
        before = dep.deployed_at

        _heartbeat_starting_record("job_under_test")

        after = ModelDeployment.objects.filter(container_id="job_under_test").first()
        self.assertEqual(
            after.deployed_at,
            before,
            "once a record is 'running' Docker is the liveness signal, not the heartbeat",
        )


class DuplicateDeployGuardTests(IsolatedStoreTestCase):
    """Fix 2: a second concurrent start of the same model must be refused."""

    def test_allocator_rejects_while_a_full_board_model_is_starting(self):
        ModelDeployment.objects.create(
            container_id="job_under_test",
            container_name=MODEL,
            model_name=MODEL,
            device="p300x2",
            device_id=0,
            device_ids=[0, 1, 2, 3],
            status="starting",
            port=7000,
        )
        with patch.object(ChipSlotAllocator, "_detect_board_type", return_value="P300x2"):
            allocator = ChipSlotAllocator()
            with self.assertRaises(MultiChipConflictError):
                allocator.allocate_chip_slot(MODEL)

    def test_in_flight_lookup_is_independent_of_chip_accounting(self):
        # The DeployView guard keys on this query alone, so it still refuses a
        # duplicate even if slot bookkeeping wrongly believes the board is free.
        ModelDeployment.objects.create(
            container_id="job_under_test",
            container_name=MODEL,
            model_name=MODEL,
            device="p300x2",
            device_id=0,
            device_ids=[0, 1, 2, 3],
            status="starting",
            port=7000,
        )
        in_flight = ModelDeployment.objects.filter(
            model_name=MODEL, status="starting"
        ).first()
        self.assertIsNotNone(in_flight)
        self.assertEqual(in_flight.container_id, "job_under_test")

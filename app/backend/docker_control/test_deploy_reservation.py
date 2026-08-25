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


class MediaPrePullReservationTests(IsolatedStoreTestCase):
    """A media deploy must hold its slot and be visible during its image pull.

    The media pre-pull branch previously created no ModelDeployment at all, so for
    the whole pull the allocator reported the device free and nothing was is_pending
    — the Voice Agent's Whisper/TTS cards showed pull progress while the deployment
    tray showed nothing.
    """

    def test_placeholder_reserves_the_slot_and_reads_as_pending(self):
        dep = ModelDeployment.objects.create(
            container_id="imgpull_deadbeef",
            container_name="distil-large-v3",
            model_name="distil-large-v3",
            device="p150",
            device_id=2,
            device_ids=[2],
            status="starting",
            port=7002,
        )
        self.assertEqual(dep.status, "starting")

        with patch.object(ChipSlotAllocator, "_detect_board_type", return_value="P300x2"):
            occupied = ChipSlotAllocator()._get_occupied_slots()
        self.assertIn(
            2,
            occupied,
            "an image-pulling media deploy must keep its device reserved",
        )

    def test_retiring_the_placeholder_frees_the_slot(self):
        ModelDeployment.objects.create(
            container_id="imgpull_deadbeef",
            container_name="distil-large-v3",
            model_name="distil-large-v3",
            device="p150",
            device_id=2,
            device_ids=[2],
            status="starting",
            port=7002,
        )
        dep = ModelDeployment.objects.filter(container_id="imgpull_deadbeef").first()
        dep.status = "stopped"
        dep.save()

        with patch.object(ChipSlotAllocator, "_detect_board_type", return_value="P300x2"):
            occupied = ChipSlotAllocator()._get_occupied_slots()
        self.assertNotIn(2, occupied)


class PlaceholderNameMatchTests(IsolatedStoreTestCase):
    """An imgpull_ placeholder must not be resolved to a previous deploy's container.

    get_canonical_deployments() falls back to matching a record to a live container by
    name. A placeholder is created before its image is even pulled, so a name hit can
    only be an older container — and treating it as live marks an in-flight deploy
    is_pending=False, which hides it from the tray and from slot accounting on redeploy.
    """

    def _canonical_with_live_container(self, container_name):
        from docker_control import docker_utils

        live = {
            "abc123def456": {
                "name": container_name,
                "status": "running",
                "health": "healthy",
                "port_bindings": {},
                "networks": {},
                "env_vars": {},
            }
        }
        with patch.object(docker_utils, "get_container_status", return_value=live), \
             patch.object(docker_utils, "_enrich_container_with_model_impl", return_value=False):
            return docker_utils.get_canonical_deployments()

    def test_placeholder_stays_pending_when_an_older_container_shares_its_name(self):
        ModelDeployment.objects.create(
            container_id="imgpull_abcdef",
            container_name="distil-large-v3",
            model_name="distil-large-v3",
            device="p150",
            device_id=2,
            device_ids=[2],
            status="starting",
            port=7002,
        )
        canonical = self._canonical_with_live_container("distil-large-v3")
        pending = [e for e in canonical.values() if e.get("is_pending")]
        self.assertEqual(
            len(pending),
            1,
            "an image-pulling deploy must stay pending even when a same-named "
            "container from a previous deploy is still up",
        )
        self.assertEqual(pending[0]["deployment_model_name"], "distil-large-v3")

    def test_real_job_id_records_still_match_their_container_by_name(self):
        ModelDeployment.objects.create(
            container_id="a241aacf",
            container_name="distil-large-v3",
            model_name="distil-large-v3",
            device="p150",
            device_id=2,
            device_ids=[2],
            status="starting",
            port=7002,
        )
        canonical = self._canonical_with_live_container("distil-large-v3")
        self.assertTrue(
            any(not e.get("is_pending") for e in canonical.values()),
            "name matching must still resolve a real job-id record to its container",
        )


class HeartbeatCancelRaceTests(IsolatedStoreTestCase):
    """The heartbeat must never undo a cancel.

    A read-modify-write (filter().first(), mutate, save()) rewrites the whole record
    from a detached copy. A cancel landing between the read and the write would be
    silently reverted — status back to 'starting', stopped_by_user back to False —
    leaving a cancelled deploy holding its devices and eligible for resurrection on
    completion. touch_starting() does the check and the write under the store lock.
    """

    def _starting(self):
        return ModelDeployment.objects.create(
            container_id="job_under_test",
            container_name=MODEL,
            model_name=MODEL,
            device="p300x2",
            device_id=0,
            device_ids=[0, 1, 2, 3],
            status="starting",
            port=7000,
        )

    def test_refreshes_a_live_starting_record(self):
        dep = self._starting()
        dep.deployed_at = timezone.now() - timedelta(seconds=120)
        dep.save()
        before = ModelDeployment.objects.filter(container_id="job_under_test").first().deployed_at

        self.assertTrue(ModelDeployment.objects.touch_starting("job_under_test"))

        after = ModelDeployment.objects.filter(container_id="job_under_test").first()
        self.assertGreater(after.deployed_at, before)
        self.assertEqual(after.status, "starting")

    def test_does_not_revive_a_user_cancelled_record(self):
        dep = self._starting()
        dep.status = "stopped"
        dep.stopped_by_user = True
        dep.save()

        self.assertFalse(ModelDeployment.objects.touch_starting("job_under_test"))

        after = ModelDeployment.objects.filter(container_id="job_under_test").first()
        self.assertEqual(after.status, "stopped", "a cancelled deploy must stay stopped")
        self.assertTrue(after.stopped_by_user, "the cancel flag must survive a heartbeat")

    def test_heartbeat_wrapper_is_a_no_op_after_cancellation(self):
        dep = self._starting()
        dep.status = "stopped"
        dep.stopped_by_user = True
        dep.save()

        _heartbeat_starting_record("job_under_test")

        after = ModelDeployment.objects.filter(container_id="job_under_test").first()
        self.assertEqual(after.status, "stopped")
        self.assertTrue(after.stopped_by_user)

    def test_unknown_job_is_a_no_op(self):
        self.assertFalse(ModelDeployment.objects.touch_starting("no_such_job"))

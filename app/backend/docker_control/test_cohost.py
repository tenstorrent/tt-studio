# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Several catalog models deployed onto the same chips (a co-host group).

The models share one container, so TT Studio keeps one deployment record per model
and lists each one as a deployed model of its own: the first under the container id,
the others under "<container id>@<port>".
"""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from rest_framework.test import APIClient

from docker_control import cohost, docker_utils
from docker_control.chip_allocator import ChipSlotAllocator
from docker_control.deployment_sync import _do_sync
from docker_control.models import ModelDeployment
from docker_control.test_deploy_reservation import IsolatedStoreTestCase
from shared_config.backend_config import backend_config
from shared_config.model_config import model_implmentations
from shared_config.model_type_config import ModelTypes

NETWORK = backend_config.docker_bridge_network_name


def _impl(name, model_type=ModelTypes.CHAT, engine="vLLM"):
    return SimpleNamespace(
        model_id=f"id_tt-transformers-{name}-v0.1.0",
        model_name=name,
        model_type=model_type,
        inference_engine=engine,
        inference_impl="tt-transformers",
        service_route="/v1/chat/completions",
        health_route="/health",
    )


QWEN, LLAMA = _impl("Qwen3-32B"), _impl("Llama-3.1-8B-Instruct")
CATALOG = {QWEN.model_id: QWEN, LLAMA.model_id: LLAMA}


class MemberKeyTests(unittest.TestCase):
    def test_round_trip(self):
        key = cohost.member_key("abc123", 20001)
        self.assertEqual(key, "abc123@20001")
        self.assertEqual(cohost.split_member_key(key), ("abc123", 20001))

    def test_plain_container_id_is_left_alone(self):
        self.assertEqual(cohost.split_member_key("abc123"), ("abc123", None))
        self.assertEqual(cohost.split_member_key("abc@x"), ("abc@x", None))


class ResolveMembersTests(unittest.TestCase):
    def test_returns_the_members_impls(self):
        members = cohost.resolve_cohost_members(QWEN, [LLAMA.model_id], CATALOG)
        self.assertEqual(members, [LLAMA])

    def test_unknown_model_is_refused(self):
        with self.assertRaisesRegex(cohost.CohostError, "not in the model catalog"):
            cohost.resolve_cohost_members(QWEN, ["id_nope"], CATALOG)

    def test_a_model_twice_is_refused(self):
        with self.assertRaisesRegex(cohost.CohostError, "listed twice"):
            cohost.resolve_cohost_members(QWEN, [QWEN.model_id], CATALOG)

    def test_non_chat_member_is_refused(self):
        whisper = _impl("whisper", model_type=ModelTypes.SPEECH_RECOGNITION, engine="media")
        with self.assertRaisesRegex(cohost.CohostError, "whisper is not a vLLM chat model"):
            cohost.resolve_cohost_members(QWEN, [whisper.model_id], {whisper.model_id: whisper})

    def test_different_images_are_refused(self):
        images = {QWEN.model_name: "img:a", LLAMA.model_name: "img:b"}
        with self.assertRaisesRegex(cohost.CohostError, "need the same image"):
            cohost.check_same_image(QWEN, [LLAMA], lambda m: images[m.model_name])

    def test_unresolvable_image_is_left_to_the_server(self):
        cohost.check_same_image(QWEN, [LLAMA], lambda m: None)


class ServicePortBlockTests(unittest.TestCase):
    def test_finds_consecutive_free_ports(self):
        with patch.object(docker_utils, "get_managed_containers", return_value={}), \
             patch.object(docker_utils, "get_port_mappings", return_value={}), \
             patch.object(docker_utils, "get_used_host_ports", return_value=["20001"]), \
             patch.object(docker_utils.ModelDeployment.objects, "filter", return_value=[]):
            self.assertEqual(docker_utils.get_next_service_port(count=1), 20000)
            self.assertEqual(docker_utils.get_next_service_port(count=3), 20002)


def _create_group(container_id="job1", status="starting"):
    first = ModelDeployment.objects.create(
        container_id=container_id,
        container_name=QWEN.model_name,
        model_name=QWEN.model_name,
        model_id=QWEN.model_id,
        device="p300x2",
        device_ids=[0, 1, 2, 3],
        status=status,
        port=20000,
        cohost_group="cohost_test",
    )
    cohost.create_member_records(
        [LLAMA],
        20000,
        "cohost_test",
        container_id=container_id,
        device="p300x2",
        device_id=0,
        device_ids=[0, 1, 2, 3],
        status=status,
    )
    return first


class GroupRecordTests(IsolatedStoreTestCase):
    def test_member_gets_its_own_record_on_the_next_port(self):
        _create_group()
        member = ModelDeployment.objects.filter(model_name=LLAMA.model_name).first()
        self.assertEqual(member.port, 20001)
        self.assertTrue(member.cohost_member)
        self.assertEqual(member.cohost_group, "cohost_test")
        self.assertEqual(member.device_ids, [0, 1, 2, 3])

    def test_completed_job_moves_the_whole_group_to_the_container(self):
        _create_group()
        with patch("model_control.model_utils.update_deploy_cache"):
            _do_sync("job1", {"status": "completed", "container_id": "c0ffee", "container_name": "Qwen3-32B"})
        records = list(ModelDeployment.objects.all())
        self.assertEqual({r.container_id for r in records}, {"c0ffee"})
        self.assertEqual({r.status for r in records}, {"running"})

    def test_failed_job_stops_the_whole_group(self):
        _create_group()
        _do_sync("job1", {"status": "error", "message": "boom"})
        self.assertEqual({r.status for r in ModelDeployment.objects.all()}, {"stopped"})

    def test_stopping_one_model_stops_the_group(self):
        first = _create_group(container_id="c0ffee", status="running")
        first.status, first.stopped_by_user = "stopped", True
        first.save()
        note = cohost.stop_group_records("c0ffee")
        member = ModelDeployment.objects.filter(model_name=LLAMA.model_name).first()
        self.assertEqual((member.status, member.stopped_by_user), ("stopped", True))
        self.assertIn(LLAMA.model_name, note)

    def test_a_solo_deployment_is_not_a_group(self):
        ModelDeployment.objects.create(container_id="solo", model_name="m", status="running")
        self.assertIsNone(cohost.stop_group_records("solo"))


class CanonicalDeploymentTests(IsolatedStoreTestCase):
    """Each model of the group is listed, with its own catalog impl and port."""

    def _live(self):
        return {
            "c0ffee": {
                "name": "Qwen3-32B",
                "status": "running",
                "image_name": "img:a",
                "port_bindings": {"20000/tcp": [{"HostPort": "20000"}]},
                "networks": {NETWORK: {"DNSNames": ["Qwen3-32B", "c0ffee"]}},
                "env_vars": {},
            }
        }

    def test_one_entry_per_model(self):
        _create_group(container_id="c0ffee", status="running")
        with patch.object(docker_utils, "get_container_status", return_value=self._live()), \
             patch.object(docker_utils, "model_implmentations", CATALOG):
            canonical = docker_utils.get_canonical_deployments()

        self.assertEqual(set(canonical), {"c0ffee", "c0ffee@20001"})
        first, member = canonical["c0ffee"], canonical["c0ffee@20001"]
        self.assertIs(first["model_impl"], QWEN)
        self.assertIs(member["model_impl"], LLAMA)
        self.assertEqual(first["internal_url"], "Qwen3-32B:20000/v1/chat/completions")
        self.assertEqual(member["internal_url"], "Qwen3-32B:20001/v1/chat/completions")
        self.assertEqual(member["health_url"], "Qwen3-32B:20001/health")
        self.assertEqual(member["cohost_models"], ["Qwen3-32B", "Llama-3.1-8B-Instruct"])
        self.assertEqual(member["source"], "managed")

    def test_starting_group_lists_each_model_as_pending(self):
        _create_group(container_id="job1", status="starting")
        with patch.object(docker_utils, "get_container_status", return_value={}):
            canonical = docker_utils.get_canonical_deployments()
        self.assertEqual(set(canonical), {"job1", "job1@20001"})
        self.assertTrue(all(e["is_pending"] for e in canonical.values()))


def _catalog_model_id(name):
    return next(
        (mid for mid, impl in model_implmentations.items()
         if impl.model_name == name and impl.model_type == ModelTypes.CHAT),
        None,
    )


class DeployViewCohostTests(IsolatedStoreTestCase):
    """POST /docker/deploy/ with cohost_with, on a QuietBox 2 (P300x2)."""

    def setUp(self):
        super().setUp()
        self.primary = _catalog_model_id("Llama-3.1-8B-Instruct")
        self.member = _catalog_model_id("Qwen3-32B")
        if not (self.primary and self.member):
            self.skipTest("catalog lacks the chat models this test deploys")
        patches = [
            patch("api.hf_access._check_repo", return_value=200),
            patch("shared_config.user_config.get_hf_token", return_value="fake-token"),
            patch("docker_control.views.SystemResourceService.is_reset_in_progress", return_value=False),
            patch("docker_control.views.detect_board_type", return_value="P300x2"),
            patch.object(ChipSlotAllocator, "_detect_board_type", return_value="P300x2"),
            patch.object(ChipSlotAllocator, "_get_total_slots", return_value=4),
            patch.object(ChipSlotAllocator, "_get_occupied_slots", return_value=set()),
            patch("docker_control.views.resolve_deploy_image", return_value="img:shared"),
            patch("docker_control.deployment_sync.start_deployment_sync"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.claim = patch("docker_control.views.claim_service_port", return_value=(20000, None))
        self.claim_mock = self.claim.start()
        self.addCleanup(self.claim.stop)
        docker_client = MagicMock()
        docker_client.image_exists.return_value = True
        client_patch = patch("docker_control.views.get_docker_client", return_value=docker_client)
        client_patch.start()
        self.addCleanup(client_patch.stop)
        self.start = patch(
            "docker_control.views.start_chat_deployment",
            return_value=SimpleNamespace(status="success", job_id="job1", message="ok", api_response={}),
        )
        self.start_mock = self.start.start()
        self.addCleanup(self.start.stop)

    def _deploy(self, cohost_with):
        return APIClient().post(
            "/docker/deploy/",
            {"model_id": self.primary, "weights_id": "", "force_full_board": True,
             "cohost_with": cohost_with},
            format="json",
        )

    def test_group_deploy_records_every_model(self):
        response = self._deploy([self.member])

        self.assertEqual(response.status_code, 201, response.data)
        self.claim_mock.assert_called_once()
        self.assertEqual(self.claim_mock.call_args.kwargs["count"], 3)
        kwargs = self.start_mock.call_args.kwargs
        self.assertEqual(kwargs["cohost_with"], ["Qwen3-32B"])
        self.assertEqual(kwargs["service_port"], 20000)
        self.assertEqual(
            response.data["cohost_members"], [{"model_name": "Qwen3-32B", "service_port": 20001}]
        )
        records = sorted(ModelDeployment.objects.all(), key=lambda r: r.port)
        self.assertEqual(
            [(r.model_name, r.port, r.container_id, r.cohost_member) for r in records],
            [("Llama-3.1-8B-Instruct", 20000, "job1", False), ("Qwen3-32B", 20001, "job1", True)],
        )
        self.assertEqual(len({r.cohost_group for r in records}), 1)
        self.assertIsNotNone(records[0].cohost_group)

    def test_solo_deploy_is_unchanged(self):
        response = self._deploy([])

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.claim_mock.call_args.kwargs.get("count", 1), 1)
        self.assertIsNone(self.start_mock.call_args.kwargs["cohost_with"])
        self.assertNotIn("cohost_members", response.data)
        (record,) = ModelDeployment.objects.all()
        self.assertIsNone(record.cohost_group)

    def test_refused_member_starts_nothing(self):
        response = self._deploy(["id_not_a_model"])

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error_type"], "cohost_refused")
        self.start_mock.assert_not_called()
        self.assertEqual(list(ModelDeployment.objects.all()), [])

# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the community-model path (tt-model-manager).

No network and no hardware: what is covered is the translation layer — a bundle
manifest becoming a model_impl, a model_id round-tripping, and the launcher dispatch
that decides which backend owns a deploy. Those are the places where a mistake would
send a community model down the inference-server path or lose its profile.
"""

import unittest
from unittest.mock import patch

from shared_config.community_model_config import (
    CommunityModelImpl,
    arch_for_board,
    build_community_model_impl,
    community_model_id,
    community_model_type,
    devices_for_hardware,
    no_page_reason,
    is_community_model_id,
    parse_community_model_id,
    profile_for_chips,
)
from shared_config.device_config import DeviceConfigurations
from shared_config.model_type_config import ModelTypes

# Shaped like a real `tt_model_runner.py inspect` document.
BUNDLE = {
    "repo_id": "tt-hous/qwen3.8-flash-next-p300x2",
    "name": "qwen3.8-flash-next-p300x2",
    "arch": "blackhole",
    "kind": "vllm-plugin",
    "supported": True,
    "image": "tt-model/qwen3.8-flash-next-p300x2:d4eca6fb35da",
    "image_present": True,
    "weights_repo": "Qwen/Qwen3.8-Flash-Next",
    "default_profile": "batch1-latency",
    "profiles": [
        {
            "name": "batch1-latency",
            "hardware": "p300x2",
            "mesh_device": "(4, 1)",
            "chips_required": 4,
            "port": 8000,
            "max_model_len": 4096,
            "tool_parser": None,
            "reasoning_parser": "qwen3",
        },
        {
            "name": "long-context",
            "hardware": "p300x2",
            "mesh_device": "(4, 1)",
            "chips_required": 4,
            "port": 8000,
            "max_model_len": 262144,
            "tool_parser": "hermes",
            "reasoning_parser": "qwen3",
        },
    ],
}


class ModelIdTests(unittest.TestCase):
    def test_round_trip_with_profile(self):
        model_id = community_model_id("ns/name", "fast")
        self.assertEqual(parse_community_model_id(model_id), ("ns/name", "fast"))

    def test_round_trip_without_profile(self):
        model_id = community_model_id("ns/name")
        self.assertEqual(parse_community_model_id(model_id), ("ns/name", None))

    def test_catalog_ids_are_not_community_ids(self):
        # A Hub repo must never be able to shadow a catalog entry.
        self.assertFalse(is_community_model_id("id_mock_vllm_modelv0.0.1"))
        self.assertFalse(is_community_model_id(None))
        self.assertTrue(is_community_model_id(community_model_id("ns/name")))

    def test_parsing_rejects_a_catalog_id(self):
        with self.assertRaises(ValueError):
            parse_community_model_id("id_external-something")


class BuildImplTests(unittest.TestCase):
    def test_uses_the_default_profile(self):
        impl = build_community_model_impl(BUNDLE)
        self.assertEqual(impl.profile, "batch1-latency")
        self.assertEqual(impl.model_name, BUNDLE["repo_id"])
        self.assertEqual(impl.model_type, ModelTypes.CHAT)
        self.assertEqual(impl.service_route, "/v1/chat/completions")
        self.assertEqual(impl.hf_model_id, "Qwen/Qwen3.8-Flash-Next")
        self.assertEqual(impl.author, "tt-hous")
        self.assertTrue(impl.is_community)

    def test_named_profile_overrides_the_default(self):
        impl = build_community_model_impl(BUNDLE, "long-context")
        self.assertEqual(impl.profile, "long-context")
        self.assertEqual(impl.max_model_len, 262144)

    def test_tool_calling_comes_from_the_manifest(self):
        # Declared per profile, so it must not be read off the bundle as a whole.
        self.assertFalse(build_community_model_impl(BUNDLE).tool_calling_enabled)
        self.assertTrue(
            build_community_model_impl(BUNDLE, "long-context").tool_calling_enabled
        )

    def test_chips_and_devices_come_from_the_profile_mesh(self):
        impl = build_community_model_impl(BUNDLE)
        self.assertEqual(impl.chips_required, 4)
        self.assertEqual(impl.device_configurations, frozenset({DeviceConfigurations.P300x2}))

    def test_service_port_is_carried_through(self):
        # TT Studio's 7000 + device_id convention has to reach the launcher, since it
        # moves both the published mapping and the engine's own port.
        self.assertEqual(build_community_model_impl(BUNDLE, service_port=7002).service_port, 7002)

    def test_unknown_profile_falls_back_rather_than_raising(self):
        impl = build_community_model_impl(BUNDLE, "no-such-profile")
        self.assertIn(impl.profile, {"batch1-latency", "long-context"})

    def test_bundle_without_profiles_still_builds(self):
        impl = build_community_model_impl(
            {"repo_id": "ns/name", "kind": "vllm-plugin", "default_profile": "default"}
        )
        self.assertEqual(impl.profile, "default")
        self.assertEqual(impl.chips_required, 1)

    def test_serializes_for_http(self):
        # The deploy cache renders model_impl with asdict(); enums must not leak.
        data = build_community_model_impl(BUNDLE).asdict()
        self.assertEqual(data["model_type"], "chat")
        self.assertEqual(data["device_configurations"], ["P300x2"])


# Shaped like changh95/qwen-image-2.1-p150's `inspect` document.
DIT_BUNDLE = {
    "repo_id": "changh95/qwen-image-2.1-p150",
    "kind": "tt-dit-server",
    "task": "text-to-image",
    "weights_repo": "Qwen/Qwen-Image-2.1",
    "default_profile": "default",
    "profiles": [{"name": "default", "hardware": "p150", "chips_required": 1}],
}


class ModelTypeTests(unittest.TestCase):
    def test_vllm_bundles_are_chat_whatever_the_task(self):
        self.assertEqual(community_model_type("vllm-plugin", None), ModelTypes.CHAT)
        self.assertEqual(community_model_type("vllm-fork", "robotics"), ModelTypes.CHAT)

    def test_dit_image_tasks_are_image_generation(self):
        for task in ("text-to-image", "image-to-image"):
            self.assertEqual(
                community_model_type("tt-dit-server", task), ModelTypes.IMAGE_GENERATION
            )

    def test_dit_speech_tasks_use_the_openai_audio_routes(self):
        # The TTS and speech-recognition pages speak OpenAI's audio contract, which
        # Fish S2 Pro serves; the route is fixed rather than discovered.
        tts = build_community_model_impl({**DIT_BUNDLE, "task": "text-to-speech"})
        self.assertEqual(tts.model_type, ModelTypes.TTS)
        self.assertEqual(tts.service_route, "/v1/audio/speech")
        stt = build_community_model_impl(
            {**DIT_BUNDLE, "task": "automatic-speech-recognition"}
        )
        self.assertEqual(stt.model_type, ModelTypes.SPEECH_RECOGNITION)
        self.assertEqual(stt.service_route, "/v1/audio/transcriptions")

    def test_dit_tasks_without_a_page_deploy_as_unknown(self):
        for task in ("robotics", "depth-estimation", "never-seen", None):
            self.assertEqual(
                community_model_type("tt-dit-server", task), ModelTypes.UNKNOWN
            )

    def test_unlisted_engines_deploy_as_unknown(self):
        self.assertEqual(
            community_model_type("something-new", "text-to-image"), ModelTypes.UNKNOWN
        )

    def test_no_page_reason_comes_from_the_overrides_file(self):
        self.assertIsNone(no_page_reason("tt-dit-server", "text-to-image"))
        self.assertIsNone(no_page_reason("vllm-plugin", None))
        self.assertIn("Robot policies", no_page_reason("tt-dit-server", "robotics"))

    def test_no_page_reason_covers_what_the_file_does_not_list(self):
        self.assertIn("never-seen", no_page_reason("tt-dit-server", "never-seen"))
        self.assertIn("something-new", no_page_reason("something-new", None))

    def test_an_image_bundle_registers_no_route(self):
        # Each tt-dit app picks its own routes; the image view reads them off the
        # container's OpenAPI document instead.
        impl = build_community_model_impl(DIT_BUNDLE)
        self.assertEqual(impl.model_type, ModelTypes.IMAGE_GENERATION)
        self.assertEqual(impl.service_route, "")
        self.assertEqual(impl.display_model_type, "IMAGE")

    def test_a_bundle_without_a_page_builds_as_unknown(self):
        impl = build_community_model_impl({**DIT_BUNDLE, "task": "robotics"})
        self.assertEqual(impl.model_type, ModelTypes.UNKNOWN)
        self.assertEqual(impl.service_route, "")
        self.assertEqual(impl.display_model_type, "OTHER")


class HardwareMappingTests(unittest.TestCase):
    def test_known_labels(self):
        self.assertEqual(devices_for_hardware("p150"), frozenset({DeviceConfigurations.P150}))
        self.assertEqual(devices_for_hardware("P300X2"), frozenset({DeviceConfigurations.P300x2}))

    def test_unknown_label_is_empty_not_wrong(self):
        # Empty reads as "compatibility unknown"; a new device target must not
        # silently hide a model.
        self.assertEqual(devices_for_hardware("p999x9"), frozenset())
        self.assertEqual(devices_for_hardware(None), frozenset())

    def test_board_to_arch(self):
        self.assertEqual(arch_for_board("P300x2"), "blackhole")
        self.assertEqual(arch_for_board("N300"), "wormhole")
        self.assertEqual(arch_for_board("T3K"), "wormhole")
        self.assertIsNone(arch_for_board("unknown"))
        self.assertIsNone(arch_for_board(None))


class LauncherDispatchTests(unittest.TestCase):
    def test_dispatch_by_model_id(self):
        from docker_control import launchers

        self.assertEqual(
            launchers.source_for_model_id(community_model_id("ns/name")),
            launchers.COMMUNITY,
        )
        self.assertEqual(
            launchers.source_for_model_id("id_mock_vllm_modelv0.0.1"),
            launchers.INFERENCE_SERVER,
        )
        self.assertIs(
            type(launchers.for_model_id(community_model_id("ns/name"))),
            launchers.TTModelManagerLauncher,
        )

    def test_community_impl_is_coding_agent_eligible_on_structure(self):
        # It has no catalog entry to allowlist, so it qualifies the way an
        # externally-registered model does; tool_calling_enabled still gates usability.
        from shared_config.coding_agent_config import is_coding_agent_eligible

        self.assertTrue(
            is_coding_agent_eligible(build_community_model_impl(BUNDLE, "long-context"))
        )


class ImplFromDeploymentTests(unittest.TestCase):
    class _Deployment:
        model_name = "ns/name"
        community_model_id = community_model_id("ns/name", "fast")
        service_route = "/v1/chat/completions"
        port = 7001
        hf_model_id = "org/weights"
        tool_calling_enabled = True
        device_ids = [1]
        device = "blackhole"

    def test_rebuilds_without_a_hub_request(self):
        from shared_config.community_model_config import community_impl_from_deployment

        impl = community_impl_from_deployment(self._Deployment())
        self.assertIsInstance(impl, CommunityModelImpl)
        self.assertEqual(impl.repo_id, "ns/name")
        self.assertEqual(impl.profile, "fast")
        self.assertEqual(impl.service_port, 7001)
        self.assertTrue(impl.tool_calling_enabled)

    def test_an_image_record_keeps_its_type_and_empty_route(self):
        from shared_config.community_model_config import community_impl_from_deployment

        dep = self._Deployment()
        dep.model_type = "image_generation"
        dep.service_route = ""
        impl = community_impl_from_deployment(dep)
        self.assertEqual(impl.model_type, ModelTypes.IMAGE_GENERATION)
        self.assertEqual(impl.service_route, "")

    def test_returns_none_for_a_non_community_record(self):
        class Plain:
            model_name = "Llama-3.1-8B-Instruct"
            community_model_id = None

        from shared_config.community_model_config import community_impl_from_deployment

        self.assertIsNone(community_impl_from_deployment(Plain()))


class ReservationTests(unittest.TestCase):
    """A community deploy must reserve exactly the chips the bundle's profile declares.

    tt-model-manager scopes the container to the chips it is handed, so the reservation
    can match the manifest instead of claiming the board: a 1-chip bundle has to leave
    the other slots of a P300x2 free for another model.
    """

    class _Allocator:
        """Stands in for ChipSlotAllocator, recording what it was asked to allocate."""

        total_slots = 4

        def __init__(self, base=0, error=None):
            self._base = base
            self._error = error
            self.call = None

        def allocate_chip_slot(self, model_name, manual_override=None, chips_required=None):
            self.call = (model_name, manual_override, chips_required)
            if self._error:
                raise self._error
            return self._base if manual_override is None else manual_override

        def slot_group(self, device_id, chips_required):
            if chips_required >= 4 or chips_required >= self.total_slots:
                return list(range(self.total_slots))
            return list(range(device_id, device_id + chips_required))

    def _allocate(self, allocator, bundle=BUNDLE, manual=None):
        from docker_control.community_deploy import _allocate_slots

        with patch("docker_control.community_deploy.ChipSlotAllocator", lambda: allocator):
            return _allocate_slots(build_community_model_impl(bundle), manual)

    @staticmethod
    def _bundle_with(**profile_overrides):
        bundle = dict(BUNDLE)
        bundle["profiles"] = [{**BUNDLE["profiles"][0], **profile_overrides}]
        bundle["default_profile"] = bundle["profiles"][0]["name"]
        return bundle

    def test_a_whole_board_bundle_still_takes_every_slot(self):
        allocator = self._Allocator()
        device_id, device_ids = self._allocate(allocator)
        self.assertEqual(device_id, 0)
        self.assertEqual(device_ids, [0, 1, 2, 3])
        self.assertEqual(allocator.call[2], 4)

    def test_a_single_chip_bundle_reserves_one_slot(self):
        bundle = self._bundle_with(hardware="p150", mesh_device="P150", chips_required=1)
        allocator = self._Allocator(base=2)
        device_id, device_ids = self._allocate(allocator, bundle)
        self.assertEqual(device_id, 2)
        self.assertEqual(device_ids, [2])
        self.assertEqual(allocator.call[2], 1)

    def test_a_two_chip_bundle_reserves_one_card(self):
        bundle = self._bundle_with(hardware="p300", mesh_device="(2, 1)", chips_required=2)
        allocator = self._Allocator(base=2)
        _, device_ids = self._allocate(allocator, bundle)
        self.assertEqual(device_ids, [2, 3])

    def test_a_pinned_slot_is_passed_through_as_the_manual_override(self):
        bundle = self._bundle_with(hardware="p150", mesh_device="P150", chips_required=1)
        allocator = self._Allocator()
        device_id, device_ids = self._allocate(allocator, bundle, manual=3)
        self.assertEqual((device_id, device_ids), (3, [3]))
        self.assertEqual(allocator.call[1], 3)

    def test_a_bundle_larger_than_the_board_is_refused(self):
        from docker_control.chip_allocator import AllocationError

        bundle = self._bundle_with(hardware="p150x8", mesh_device="(8, 1)", chips_required=8)
        with self.assertRaises(AllocationError):
            self._allocate(self._Allocator(), bundle)

    def test_a_busy_board_is_refused(self):
        from docker_control.chip_allocator import MultiChipConflictError

        conflict = MultiChipConflictError("board busy")
        with self.assertRaises(MultiChipConflictError):
            self._allocate(self._Allocator(error=conflict))


class RequestedDeviceIdTests(unittest.TestCase):
    """Parsing the deploy form's device_id, which arrives as an int or "0,1"."""

    def _parse(self, raw):
        from docker_control.community_deploy import _requested_device_ids

        return _requested_device_ids(raw)

    def test_auto_placement_when_absent_or_blank(self):
        for raw in (None, "", "   "):
            self.assertEqual(self._parse(raw), [])

    def test_reads_an_int_or_a_string(self):
        self.assertEqual(self._parse(2), [2])
        self.assertEqual(self._parse("2"), [2])

    def test_reads_every_slot_of_a_group(self):
        self.assertEqual(self._parse("2, 3"), [2, 3])

    def test_junk_falls_back_to_auto_placement(self):
        self.assertEqual(self._parse("nope"), [])


# One profile per mesh, like jashansinghTT/olmo-3.1-32b-instruct-blackhole.
TIERED_BUNDLE = {
    **BUNDLE,
    "repo_id": "ns/tiered",
    "default_profile": "p150",
    "profiles": [
        {"name": "p150", "hardware": "p150", "chips_required": 1},
        {"name": "p300", "hardware": "p300", "chips_required": 2},
        {"name": "p300-long", "hardware": "p300", "chips_required": 2},
        {"name": "p300x2", "hardware": "p300x2", "chips_required": 4},
    ],
}


class ProfileForChipsTests(unittest.TestCase):
    def test_picks_the_profile_with_that_mesh(self):
        self.assertEqual(profile_for_chips(TIERED_BUNDLE, 4), "p300x2")

    def test_first_in_manifest_order_wins_a_tie(self):
        self.assertEqual(profile_for_chips(TIERED_BUNDLE, 2), "p300")

    def test_the_preferred_profile_wins_a_tie(self):
        self.assertEqual(profile_for_chips(TIERED_BUNDLE, 2, "p300-long"), "p300-long")

    def test_a_preferred_profile_of_another_size_is_ignored(self):
        self.assertEqual(profile_for_chips(TIERED_BUNDLE, 2, "p150"), "p300")

    def test_no_matching_mesh(self):
        self.assertIsNone(profile_for_chips(TIERED_BUNDLE, 8))
        self.assertIsNone(profile_for_chips({}, 1))


class PinnedProfileTests(unittest.TestCase):
    """An explicit multi-device pin deploys the profile with that mesh."""

    def _resolve(self, pinned, profile=None):
        from docker_control.community_deploy import _impl_for_pinned_devices

        impl = build_community_model_impl(TIERED_BUNDLE, profile)
        with patch(
            "docker_control.community_deploy.fetch_bundle", return_value=TIERED_BUNDLE
        ):
            return _impl_for_pinned_devices(impl, pinned)

    def test_a_card_pin_switches_to_the_two_chip_profile(self):
        impl = self._resolve([2, 3])
        self.assertEqual((impl.profile, impl.chips_required), ("p300", 2))
        self.assertEqual(impl.model_id, community_model_id("ns/tiered", "p300"))

    def test_a_board_pin_switches_to_the_four_chip_profile(self):
        self.assertEqual(self._resolve([0, 1, 2, 3]).profile, "p300x2")

    def test_a_pin_matching_the_requested_profile_keeps_it(self):
        self.assertEqual(self._resolve([0, 1], "p300-long").profile, "p300-long")

    def test_a_lone_slot_keeps_the_requested_profile(self):
        # For a multi-chip profile a single slot only names the base.
        self.assertEqual(self._resolve([2], "p300x2").profile, "p300x2")

    def test_a_pin_no_profile_matches_keeps_the_requested_profile(self):
        self.assertEqual(self._resolve([0, 1, 2]).profile, "p150")


if __name__ == "__main__":
    unittest.main()


class CommunityHealthRouteTests(unittest.TestCase):
    """Each tt-dit app picks its own health route; it is read off the app's OpenAPI."""

    def setUp(self):
        from docker_control import docker_utils

        self.docker_utils = docker_utils
        docker_utils._community_health_routes.clear()

    def _route(self, con_id, response=None, error=None):
        with patch("docker_control.docker_utils.requests.get") as get:
            if error:
                get.side_effect = error
            else:
                get.return_value.json.return_value = response
            return self.docker_utils._community_health_route(con_id, "app:7000"), get

    def test_a_v1_health_app_is_probed_there(self):
        # Fish S2 Pro serves /v1/health only.
        route, _ = self._route("c1", {"paths": {"/v1/health": {}, "/v1/tts": {}}})
        self.assertEqual(route, "/v1/health")

    def test_plain_health_is_preferred(self):
        route, _ = self._route("c2", {"paths": {"/health": {}, "/v1/health": {}}})
        self.assertEqual(route, "/health")

    def test_the_route_is_read_once_per_container(self):
        self._route("c3", {"paths": {"/v1/health": {}}})
        route, get = self._route("c3", {"paths": {"/health": {}}})
        self.assertEqual(route, "/v1/health")
        get.assert_not_called()

    def test_an_app_still_loading_is_retried_later(self):
        import requests

        route, _ = self._route("c4", error=requests.ConnectionError("refused"))
        self.assertEqual(route, "/health")
        self.assertNotIn("c4", self.docker_utils._community_health_routes)

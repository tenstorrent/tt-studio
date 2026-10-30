# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for telling model servers apart from other containers at discovery."""

from django.test import SimpleTestCase

from docker_control.chip_allocator import _detect_device_ids_from_mounts
from docker_control.views import _model_server_signal


def _signal(container):
    return _model_server_signal(container, _detect_device_ids_from_mounts(container))


class ModelServerSignalTests(SimpleTestCase):
    def test_bound_chips_mark_a_model_whatever_its_image(self):
        # Locally built bundles show only an image hash.
        container = {
            "HostConfig": {"Devices": [{"PathOnHost": "/dev/tenstorrent/0"}]},
            "Config": {"Image": "4ee43e47ad5d"},
        }
        self.assertEqual(_signal(container), "Tenstorrent devices bound")

    def test_a_whole_device_mount_counts(self):
        container = {"HostConfig": {"Devices": [{"PathOnHost": "/dev/tenstorrent"}]}}
        self.assertIsNotNone(_signal(container))

    def test_a_privileged_container_counts(self):
        self.assertEqual(
            _signal({"HostConfig": {"Privileged": True}}), "privileged container"
        )

    def test_tt_launch_arguments_count(self):
        container = {"Config": {"Cmd": ["vllm", "serve", "--tt-device", "p150"]}}
        self.assertEqual(_signal(container), "Tenstorrent launch settings")

    def test_a_mesh_env_counts(self):
        container = {"Config": {"Env": ["MESH_DEVICE=P300x2"]}}
        self.assertEqual(_signal(container), "Tenstorrent launch settings")

    def test_a_model_server_image_counts(self):
        container = {"Config": {"Image": "ghcr.io/tenstorrent/tt-media-inference-server:0.2.0"}}
        self.assertEqual(_signal(container), "model server image")

    def test_an_unrelated_container_has_no_signal(self):
        container = {
            "HostConfig": {"Devices": []},
            "Config": {"Image": "ghcr.io/open-webui/open-webui:main", "Env": ["PORT=8080"]},
        }
        self.assertIsNone(_signal(container))

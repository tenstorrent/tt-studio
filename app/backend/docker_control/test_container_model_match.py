# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A trainer container without a usable deployment record must not resolve to the
chat model it shares a model_name with (chat comes first in the catalog)."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from docker_control import docker_utils
from docker_control.models import ModelDeployment
from docker_control.test_deploy_reservation import IsolatedStoreTestCase
from shared_config.backend_config import backend_config
from shared_config.model_config import (
    load_model_implementations_from_json,
    register_model_implementations,
)
from shared_config.model_type_config import ModelTypes

MODEL = "Llama-3.1-8B-Instruct"
TRAINER_ENV = {"CACHE_ROOT": "/home/container_app_user/cache_root",
               "MODEL_RUNNER": "trainer-training-lora"}
CHAT_ENV = {"CACHE_ROOT": "/home/container_app_user/cache_root"}


def _row(engine, model_type, version):
    return {
        "model_name": MODEL,
        "model_type": model_type,
        "inference_engine": engine,
        "hf_model_id": f"meta-llama/{MODEL}",
        "device_configurations": ["N150"],
        "docker_image": f"ghcr.io/x/{engine}:{version}",
        "service_route": "/v1/chat/completions",
        "version": version,
    }


class TrainerContainerMatchTests(IsolatedStoreTestCase):
    def setUp(self):
        super().setUp()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"
            path.write_text(json.dumps({"models": [
                _row("vLLM", "CHAT", "0.19.0"),
                _row("forge", "TRAINING", "0.0.1"),
            ]}))
            registry = register_model_implementations(
                load_model_implementations_from_json(path)
            )
        catalog_patch = patch.object(docker_utils, "model_implmentations", registry)
        catalog_patch.start()
        self.addCleanup(catalog_patch.stop)

    def _container(self, name, env_vars):
        return {
            "name": name,
            "image_name": "ghcr.io/x/image:tag",
            "port_bindings": {},
            "networks": {
                backend_config.docker_bridge_network_name: {"DNSNames": [name]}
            },
            "env_vars": dict(env_vars),
        }

    def _enrich(self, con, con_id="c0ffee0000000000"):
        self.assertTrue(docker_utils._enrich_container_with_model_impl(con, con_id))
        return con["model_impl"]

    def test_trainer_without_a_record_resolves_to_training(self):
        impl = self._enrich(self._container(f"{MODEL}-training", TRAINER_ENV))
        self.assertEqual(impl.model_type, ModelTypes.TRAINING)

    def test_trainer_with_pre_upgrade_model_id_resolves_to_training(self):
        ModelDeployment.objects.create(
            container_id="c0ffee0000000000",
            container_name=MODEL,
            model_name=MODEL,
            model_id=f"id_tt-metal-{MODEL}-v0.0.1",
            device="n150",
            device_id=0,
            device_ids=[0],
            status="running",
            port=7000,
        )
        impl = self._enrich(self._container(MODEL, TRAINER_ENV))
        self.assertEqual(impl.model_type, ModelTypes.TRAINING)

    def test_chat_container_without_a_record_still_resolves_to_chat(self):
        impl = self._enrich(self._container(MODEL, CHAT_ENV))
        self.assertEqual(impl.model_type, ModelTypes.CHAT)

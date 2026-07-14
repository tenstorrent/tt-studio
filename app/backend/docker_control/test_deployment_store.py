# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The ModelDeployment ORM surface must round-trip through the config store's
``deployments`` namespace (issue #807) without any behavioural change."""

import importlib
import os
import tempfile

import pytest


@pytest.fixture
def store(monkeypatch):
    """Reload deployment_store against an isolated config file."""
    tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
    tmp.close()
    monkeypatch.setenv("TT_STUDIO_CONFIG_PATH", tmp.name)
    from shared_config import config_store
    importlib.reload(config_store)
    from docker_control import deployment_store
    importlib.reload(deployment_store)
    yield deployment_store, config_store
    os.unlink(tmp.name)


def test_create_and_query_roundtrip(store):
    deployment_store, config_store = store
    ModelDeployment = deployment_store.ModelDeployment

    dep = ModelDeployment.objects.create(
        container_id="abc123",
        container_name="Llama-3.1-8B-Instruct",
        model_name="Llama-3.1-8B-Instruct",
        device="p300x2",
        status="running",
        port=7000,
        device_ids=[0, 1, 2, 3],
    )
    assert dep.id == 1
    assert dep.device_ids == [0, 1, 2, 3]

    # Readable back through the ORM surface.
    fetched = ModelDeployment.objects.get(container_id="abc123")
    assert fetched.model_name == "Llama-3.1-8B-Instruct"
    assert ModelDeployment.objects.filter(status="running").exists()

    # ...and persisted under the deployments namespace of the shared store.
    ns = config_store.get_ns("deployments")
    assert ns["next_id"] == 2
    assert ns["records"][0]["container_id"] == "abc123"


def test_save_updates_existing_record(store):
    deployment_store, config_store = store
    ModelDeployment = deployment_store.ModelDeployment

    dep = ModelDeployment.objects.create(container_id="c1", model_name="m", status="running")
    dep.status = "stopped"
    dep.save()

    assert ModelDeployment.objects.get(container_id="c1").status == "stopped"
    # A namespace write must not disturb sibling namespaces.
    config_store.set("preferences", "terms_accepted", True)
    assert ModelDeployment.objects.get(container_id="c1").status == "stopped"
    assert config_store.get("preferences", "terms_accepted") is True

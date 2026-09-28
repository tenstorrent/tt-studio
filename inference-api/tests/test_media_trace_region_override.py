# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import api  # noqa: E402
from workflows.runtime_config import RuntimeConfig  # noqa: E402


def _flux_p150x4_spec():
    return copy.deepcopy(
        next(
            spec
            for spec in api.MODEL_SPECS.values()
            if spec.model_name == "FLUX.1-dev"
            and spec.device_type.name.lower() == "p150x4"
        )
    )


def test_media_trace_region_override_is_mirrored_to_container_env():
    spec = _flux_p150x4_spec()
    runtime_config = RuntimeConfig(
        model=spec.model_name,
        workflow="server",
        device="p150x4",
        override_tt_config='{"trace_region_size": 51000000}',
    )

    spec.apply_overrides(runtime_config)

    assert spec.device_model_spec.override_tt_config["trace_region_size"] == 51_000_000
    assert spec.env_vars["TRACE_REGION_SIZE"] == "51000000"


def test_media_env_is_unchanged_without_runtime_override():
    spec = _flux_p150x4_spec()
    runtime_config = RuntimeConfig(
        model=spec.model_name,
        workflow="server",
        device="p150x4",
    )

    spec.apply_overrides(runtime_config)

    assert "TRACE_REGION_SIZE" not in spec.env_vars

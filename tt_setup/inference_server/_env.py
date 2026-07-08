# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Populate os.environ with the resolved artifact paths."""

import os
from tt_setup.constants import *


def _set_artifact_environment_variables(artifact_dir):
    """Set environment variables for artifact directory."""
    os.environ["TT_INFERENCE_ARTIFACT_PATH"] = artifact_dir
    # Set OVERRIDE_BENCHMARK_TARGETS to point to the file in the artifact directory
    benchmark_file = os.path.join(artifact_dir, "benchmarking", "benchmark_targets", "model_performance_reference.json")
    if os.path.exists(benchmark_file):
        os.environ["OVERRIDE_BENCHMARK_TARGETS"] = benchmark_file

# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Resource cleanup for --stop / --purge-all.

Split into `_resource_ops` (low-level removal/inventory helpers), `_runtime`
(host-service + compose teardown), and `_orchestrate` (the user-facing flow).
Re-exports the full prior surface so `import tt_setup.cleanup as X` /
`from tt_setup.cleanup import cleanup_resources` keep working unchanged.
"""

from tt_setup.cleanup._confirm import _confirm_purge
from tt_setup.cleanup._orchestrate import cleanup_resources
from tt_setup.cleanup._purge_model import (
    purge_models,
    _deployments_for_model,
    _dir_matches_model,
    _hf_cache_dirs_for_repo,
    _hf_cache_kept_by,
    _installed_models,
    _load_catalog,
    _model_storage_locations,
    _parse_picker_selection,
    _partition_images,
    _resolve_model_names,
)
from tt_setup.cleanup._runtime import _cleanup_runtime
from tt_setup.cleanup._resource_ops import (
    _CLEANUP_IMAGE_REFS,
    _CLEANUP_VOLUME_PREFIX,
    _deployed_model_names,
    _docker_daemon_status,
    _docker_object_sizes,
    _docker_reclaimable_bytes,
    _docker_volume_mountpoints,
    _docker_volume_names,
    _format_bytes,
    _parse_size_to_bytes,
    _path_size,
    _port_owned_by_root,
    _prune_anonymous_volumes,
    _remove_directory_contents,
    _remove_docker_containers,
    _remove_docker_volumes,
    _remove_image_ref,
    _remove_local_tt_studio_images,
    _remove_path,
    _remove_tt_studio_model_volumes,
    _remove_tt_studio_network_containers,
    _write_browser_cleanup_sentinel,
)

__all__ = [
    "cleanup_resources",
    "purge_models",
    "_cleanup_runtime",
    "_confirm_purge",
    "_deployments_for_model",
    "_dir_matches_model",
    "_hf_cache_dirs_for_repo",
    "_hf_cache_kept_by",
    "_installed_models",
    "_load_catalog",
    "_model_storage_locations",
    "_parse_picker_selection",
    "_partition_images",
    "_resolve_model_names",
    "_docker_object_sizes",
    "_docker_volume_mountpoints",
    "_docker_volume_names",
    "_remove_docker_containers",
    "_remove_docker_volumes",
    "_remove_image_ref",
    "_CLEANUP_IMAGE_REFS",
    "_CLEANUP_VOLUME_PREFIX",
    "_deployed_model_names",
    "_docker_daemon_status",
    "_docker_reclaimable_bytes",
    "_format_bytes",
    "_parse_size_to_bytes",
    "_path_size",
    "_port_owned_by_root",
    "_prune_anonymous_volumes",
    "_remove_directory_contents",
    "_remove_local_tt_studio_images",
    "_remove_path",
    "_remove_tt_studio_model_volumes",
    "_remove_tt_studio_network_containers",
    "_write_browser_cleanup_sentinel",
]

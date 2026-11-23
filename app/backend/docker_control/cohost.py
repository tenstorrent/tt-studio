# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Deploy several catalog models onto the same chips (a co-host group).

A Tenstorrent chip can be opened by one process at a time, so models that share
chips share one process: tt-inference-server's ``run.py --cohost-with`` serves
them from one container, the first model on the deploy's port and each further
model on the next port (the group's status endpoint follows the last one).

TT Studio keeps one deployment record per model. The records of a group share
the container and carry the same ``cohost_group``; every model after the first
is a member, listed under ``<container id>@<port>`` so chat, health and the
deployed-models list treat it as a deployed model of its own. Stopping any of
them stops the container, so the whole group stops together.
"""

from typing import List, Optional, Sequence, Tuple
from uuid import uuid4

from shared_config.logger_config import get_logger
from shared_config.model_type_config import ModelTypes

logger = get_logger(__name__)

MEMBER_KEY_SEPARATOR = "@"


class CohostError(ValueError):
    """A group that cannot share one process; the message names the model."""


def member_key(container_id: str, port) -> str:
    return f"{container_id}{MEMBER_KEY_SEPARATOR}{port}"


def split_member_key(key: str) -> Tuple[str, Optional[int]]:
    """``"<container id>@<port>"`` -> ``(container id, port)``; any other key -> ``(key, None)``."""
    container_id, sep, port = (key or "").partition(MEMBER_KEY_SEPARATOR)
    if sep and port.isdigit():
        return container_id, int(port)
    return key, None


def _is_vllm_chat(impl) -> bool:
    return impl.model_type == ModelTypes.CHAT and (impl.inference_engine or "").lower() == "vllm"


def resolve_cohost_members(primary, member_ids: Sequence[str], catalog) -> list:
    """The catalog impls of ``member_ids``, checked against ``primary``.

    Every model of a group is a chat model served by vLLM and appears once. That
    they share a Docker image is checked by ``check_same_image``; the inference
    server makes both checks again at launch, and checks every model runs on the
    deploy's device.
    """
    if not _is_vllm_chat(primary):
        raise CohostError(
            f"{primary.model_name} is not a vLLM chat model; only those can share chips."
        )
    members, seen = [], {primary.model_id}
    for model_id in member_ids:
        impl = catalog.get(model_id)
        if impl is None:
            raise CohostError(f"Unknown model {model_id!r}: it is not in the model catalog.")
        if impl.model_id in seen:
            raise CohostError(f"{impl.model_name} is listed twice; a group serves each model once.")
        if not _is_vllm_chat(impl):
            raise CohostError(
                f"{impl.model_name} is not a vLLM chat model; only those can share chips. "
                "Deploy it on its own chips."
            )
        seen.add(impl.model_id)
        members.append(impl)
    return members


def check_same_image(primary, members: list, resolve_image) -> None:
    """Refuse members that the inference server would run on another image.

    ``resolve_image(impl)`` returns the image the server deploys, or None when it
    cannot tell (the server then makes the same check at launch).
    """
    primary_image = resolve_image(primary)
    if not primary_image:
        return
    for impl in members:
        image = resolve_image(impl)
        if image and image != primary_image:
            raise CohostError(
                f"{primary.model_name} runs on {primary_image} and {impl.model_name} on "
                f"{image}. Models sharing chips share one process, so they need the same "
                "image. Deploy them on separate chips."
            )


def new_group_id() -> str:
    return f"cohost_{uuid4().hex[:12]}"


def create_member_records(members: list, base_port: int, group_id: str, **shared) -> list:
    """One deployment record per member, on the ports after ``base_port``.

    ``shared`` holds the fields every record of the group has in common (the
    placeholder container id, device, chip ids, status, ...).
    """
    from docker_control.models import ModelDeployment

    records = []
    for offset, impl in enumerate(members, start=1):
        records.append(
            ModelDeployment.objects.create(
                container_name=impl.model_name,
                model_name=impl.model_name,
                model_id=impl.model_id,
                port=base_port + offset,
                cohost_group=group_id,
                cohost_member=True,
                **shared,
            )
        )
    return records


def enrich_member_entry(entry: dict, record, catalog, network_name: str) -> bool:
    """Point a canonical entry of a group's container at one of its models.

    The container serves several models, so its env and first port cannot say
    which one this is: the record's model id and port do.
    """
    impl = catalog.get(record.model_id)
    if impl is None:
        logger.warning(
            f"Co-host record {record.id}: model {record.model_id!r} is not in the catalog"
        )
        entry.setdefault("model_impl", None)
        return False
    entry["model_id"] = impl.model_id
    entry["model_impl"] = impl
    entry["cohost_group"] = record.cohost_group
    network = (entry.get("networks") or {}).get(network_name)
    if not network or record.port is None:
        return False
    hostname = network["DNSNames"][0]
    entry["internal_url"] = f"{hostname}:{record.port}{impl.service_route}"
    entry["health_url"] = f"{hostname}:{record.port}{impl.health_route}"
    return True


def group_model_names(records: List, group_id: Optional[str]) -> List[str]:
    """The models of a group, first model first."""
    if not group_id:
        return []
    group = [r for r in records if getattr(r, "cohost_group", None) == group_id]
    return [r.model_name for r in sorted(group, key=lambda r: (r.port is None, r.port))]


_FOLLOWED_FIELDS = (
    "container_id",
    "status",
    "stopped_at",
    "stopped_by_user",
    "failure_reason",
    "failure_message",
    "workflow_log_path",
)


def follow_group_records(job_id: str) -> int:
    """Bring the members still keyed by ``job_id`` in line with their group's first
    model, whose record the deploy sync has just updated. Returns how many changed."""
    from docker_control.models import ModelDeployment

    members = [d for d in ModelDeployment.objects.filter(container_id=job_id) if d.cohost_member]
    if not members:
        return 0
    groups = {m.cohost_group for m in members}
    leaders = {
        d.cohost_group: d
        for d in ModelDeployment.objects.all()
        if d.cohost_group in groups and not d.cohost_member
    }
    changed = 0
    for member in members:
        leader = leaders.get(member.cohost_group)
        if leader is None:
            continue
        for field in _FOLLOWED_FIELDS:
            setattr(member, field, getattr(leader, field))
        member.save()
        changed += 1
    return changed


def stop_group_records(container_id: str) -> Optional[str]:
    """The other models of a co-host group stop with the container: give their
    records the stop just recorded on the first one. Returns a note for the user."""
    from docker_control.models import ModelDeployment

    records = list(ModelDeployment.objects.filter(container_id=container_id))
    if len(records) < 2 or not records[0].cohost_group:
        return None
    first, rest = records[0], records[1:]
    for record in rest:
        record.stopped_by_user = first.stopped_by_user
        record.status = first.status
        record.stopped_at = first.stopped_at
        record.save()
    names = ", ".join(r.model_name for r in rest)
    return f"Also stopped {names}: they share this model's chips and container"

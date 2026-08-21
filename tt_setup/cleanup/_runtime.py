# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Runtime teardown for --stop / --purge-all: host services + compose containers,
each rendered as its own labelled step."""

import os
import subprocess
from tt_setup.console import console, step
from tt_setup.docker import build_docker_compose_command, run_docker_command
from tt_setup.services import cleanup_docker_control_service, cleanup_fastapi_server
from tt_setup.cleanup._resource_ops import (
    _docker_daemon_status,
    _port_owned_by_root,
    _remove_tt_studio_network_containers,
)


def _cleanup_runtime(args, has_docker_access):
    """Tear down host services and compose containers. Deployment containers
    (vLLM, TTS, STT, …) survive a plain ``--stop`` so loaded models keep
    serving across a TT Studio restart; ``--purge-all`` still removes them
    as part of the full reset."""
    full_cleanup = bool(getattr(args, "cleanup_all", False))

    # Tear down each piece as its own labelled step so the user can see exactly
    # what's being stopped (rather than one opaque "Stopping services…" line that
    # sits frozen through the ~25s `docker compose down`).
    # If the Docker daemon isn't reachable there's nothing to tear down on the
    # container side (and trying would leak a raw "Cannot connect to the Docker
    # daemon" error) — skip the docker ops and just stop the host services.
    docker_up = _docker_daemon_status() in ("ok", "sudo")

    if docker_up:
        # Plain --stop preserves deployments (summarised in the Preserved panel
        # afterwards); --purge-all removes them first so the later network removal
        # / weight deletion isn't blocked by running processes.
        if full_cleanup:
            with step("Stopping model deployments", spinner=False) as s:
                removed = _remove_tt_studio_network_containers(has_docker_access)
                s.detail(f"{removed} removed") if removed else s.skip("none running")

        # Animated spinner so the ~5s `docker compose down` shows it's working
        # (not a frozen line). Pre-authenticate sudo up-front when needed so its
        # password prompt doesn't clash with the live spinner.
        if not has_docker_access:
            subprocess.run(["sudo", "-v"], check=False)
        with step("Stopping Docker containers", spinner=True) as s:
            docker_compose_cmd = build_docker_compose_command(
                dev_mode=args.dev, show_hardware_info=False, quiet=True)
            # `--ansi never` is a top-level compose flag (must precede the
            # subcommand): it disables Compose's in-place ANSI progress redraws,
            # which otherwise write cursor-up sequences straight to the terminal
            # and fight the live step spinner — leaving a stranded "⠴ Stopping
            # Docker containers…" frame after the step should have collapsed.
            docker_compose_cmd[2:2] = ["--ansi", "never"]
            docker_compose_cmd.extend(["down", "-v"])
            try:
                # interactive=False → captured even under (pre-authenticated) sudo,
                # so nothing reaches the terminal and fights the live spinner.
                run_docker_command(docker_compose_cmd, use_sudo=not has_docker_access,
                                   capture_output=True, interactive=False)
            except Exception:
                s.skip("none running")

        # Only --purge-all removes the network — preserved deployments stay
        # attached to it for DNS so the backend can reconnect after a restart.
        if full_cleanup:
            with step("Removing Docker network", spinner=False) as s:
                try:
                    run_docker_command(["docker", "network", "rm", "tt_studio_network"],
                                        use_sudo=not has_docker_access, capture_output=True)
                except Exception:
                    s.skip("not present")
    else:
        console.print("[muted]Docker isn't running — stopping host services only "
                      "(no containers to stop).[/muted]")

    # Stopping a root-owned host process (started via sudo in a prior run) needs
    # sudo. Its password prompt would otherwise appear un-announced under a step's
    # spinner and read as a hang. Announce + pre-authenticate up-front, but ONLY
    # when a listener on :8001/:8002 is actually root-owned — so users whose
    # processes are their own (the common case) are never prompted.
    if (not args.no_sudo and os.geteuid() != 0 and console.is_terminal
            and (_port_owned_by_root(8001) or _port_owned_by_root(8002))):
        console.print("[warning]TT Studio needs your password to stop a root-owned "
                      "host service (ports 8001/8002).[/warning]")
        subprocess.run(["sudo", "-v"], check=False)

    # Host-service cleanup can discover a sudo requirement late (for example
    # from a stale/root-owned PID file, or when lsof cannot identify the
    # listener). Keep these steps static so any unexpected sudo prompt remains
    # visible instead of being hidden behind an animation. The early
    # authentication above still avoids prompting in the common root-owned
    # listener case.
    with step("Stopping inference API", spinner=False):
        cleanup_fastapi_server(no_sudo=args.no_sudo)
    with step("Stopping Docker control", spinner=False):
        cleanup_docker_control_service(no_sudo=args.no_sudo)

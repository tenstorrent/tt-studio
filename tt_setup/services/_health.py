# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Service health probing, concurrent snapshots, and multi-service waits."""

import os
import subprocess
import time
import webbrowser
try:
    import requests  # noqa: F401
    HAS_REQUESTS = True
except ImportError:
    import urllib.request  # noqa: F401
    HAS_REQUESTS = False
from tt_setup.constants import *
from tt_setup.docker_diag import _resolve_container_name
from tt_setup.console import console, notice_panel, progress_status
from tt_setup.services._ports import get_backend_port


def probe_service(health_url, timeout=2):
    """One-shot health probe: True if `health_url` returns HTTP 200 within
    `timeout`s. Used for the ready-panel snapshot dot — not the long wait loop."""
    try:
        if HAS_REQUESTS:
            with requests.get(health_url, timeout=timeout) as resp:
                return resp.status_code == 200
        import urllib.request
        with urllib.request.urlopen(health_url, timeout=timeout) as resp:
            return resp.getcode() == 200
    except Exception:
        return False


def snapshot_health(health_urls, timeout=2):
    """Probe several health URLs concurrently; return {url: healthy_bool}. A quick
    parallel snapshot for the ready panel so a stalled service can't block it."""
    if not health_urls:
        return {}
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=len(health_urls)) as pool:
        return dict(pool.map(lambda u: (u, probe_service(u, timeout)), health_urls))


def read_log_tail(log_file, lines=40):
    """The last `lines` non-blank lines of a service log ('' if unreadable)."""
    try:
        with open(log_file, "r", errors="replace") as f:
            kept = [ln.rstrip() for ln in f if ln.strip()]
        return "\n".join(kept[-lines:])
    except Exception:
        return ""


def diagnose_service_log(log_text, port=None, log_file=None):
    """Why a host service didn't come up, from its log tail.

    The counterpart of docker_diag.diagnose_container_failure for the processes
    the launcher runs on the host: recognize the handful of failures that
    actually happen and say what to do about them, instead of dumping the last
    N log lines and leaving the reader to grep. Pure — takes text, returns
    {cause, detail, evidence, actions}.
    """
    text = (log_text or "")
    low = text.lower()
    evidence = ""
    for line in reversed(text.splitlines()):
        if any(k in line.lower() for k in ("error", "exception", "traceback", "failed", "errno")):
            evidence = line.strip()
            break
    port_ref = f":{port}" if port else ""

    if "address already in use" in low or "errno 98" in low or "errno 48" in low:
        return {
            "cause": f"port {port or '?'} is still taken",
            "detail": f"Another process was holding port {port or '?'} when the service tried to bind to it.",
            "evidence": evidence,
            "actions": [f"lsof -i {port_ref}".strip(), "python run.py --stop, then re-run"],
        }
    if "modulenotfounderror" in low or "importerror" in low:
        return {
            "cause": "a Python dependency is missing",
            "detail": "The service's virtual environment is incomplete or out of date.",
            "evidence": evidence,
            "actions": ["delete the service's .venv directory, then re-run python run.py"],
        }
    if "permission denied" in low:
        return {
            "cause": "permission denied",
            "detail": "The service couldn't open a file or socket it needs (often the Docker socket).",
            "evidence": evidence,
            "actions": ["check Docker access: docker ps",
                        "add yourself to the docker group: sudo usermod -aG docker $USER (then log out/in)"],
        }
    if "no space left on device" in low:
        return {
            "cause": "the disk is full",
            "detail": "The service couldn't write to disk.",
            "evidence": evidence,
            "actions": ["df -h", "docker system prune -af"],
        }
    return {
        "cause": "it didn't answer its health check",
        "detail": "The service started but never became healthy.",
        "evidence": evidence,
        "actions": [f"tail -50 {log_file}" if log_file else "check the service log"],
    }


def report_service_failure(name, log_file, port=None, consequence=None):
    """Print the calm 'didn't start' card for a host service: the cause in plain
    words, the one log line that shows it, and what to try. Replaces dumping the
    log tail into the phase output."""
    # Paths read better relative to the repo the user launched from.
    shown_log = log_file
    try:
        if log_file and log_file.startswith(TT_STUDIO_ROOT):
            shown_log = os.path.relpath(log_file, TT_STUDIO_ROOT)
    except Exception:
        pass

    diagnosis = diagnose_service_log(read_log_tail(log_file), port=port, log_file=shown_log)
    lines = [f"[error]{diagnosis['detail']}[/error]"]
    if diagnosis["evidence"]:
        lines.append(f"[muted]Log · {diagnosis['evidence'][:120]}[/muted]")
    if consequence:
        lines += ["", f"[warning]{consequence}[/warning]"]
    lines += ["", "[info]Try:[/info]"]
    lines += [f"[muted]  {action}[/muted]" for action in diagnosis["actions"]]
    if not any(shown_log in action for action in diagnosis["actions"]):
        lines.append(f"[muted]  tail -50 {shown_log}[/muted]")
    console.print(notice_panel(f"[error]{name} didn't start — {diagnosis['cause']}[/error]",
                               lines, border_style="error"))
    return diagnosis


def wait_for_service_health(service_name, health_url, timeout=300, interval=5):
    """
    Wait for a service to become healthy (HTTP 200 at the given URL).
    Returns True if healthy within timeout, else False.
    Classifies failure reasons (connection refused, timeout, HTTP error) for diagnostics.
    """
    start_time = time.time()
    last_failure = "waiting to connect"

    with progress_status(f"Waiting for {service_name}…") as health_spinner:
        while time.time() - start_time < timeout:
            elapsed = int(time.time() - start_time)
            failure_reason = None

            if HAS_REQUESTS:
                try:
                    with requests.get(health_url, timeout=5) as response:
                        if response.status_code == 200:
                            # Spinner clears on exiting the context manager; succeed silently.
                            return True
                        failure_reason = f"HTTP {response.status_code}"
                except requests.exceptions.ConnectionError:
                    failure_reason = "connection refused"
                except requests.exceptions.Timeout:
                    failure_reason = "request timeout"
                except requests.RequestException as exc:
                    failure_reason = f"network error: {type(exc).__name__}"
            else:
                try:
                    import urllib.error
                    with urllib.request.urlopen(health_url, timeout=5) as resp:
                        if resp.getcode() == 200:
                            return True
                        failure_reason = f"HTTP {resp.getcode()}"
                except urllib.error.URLError as exc:
                    reason = str(exc.reason) if hasattr(exc, 'reason') else str(exc)
                    if "refused" in reason.lower():
                        failure_reason = "connection refused"
                    elif "timed out" in reason.lower():
                        failure_reason = "request timeout"
                    else:
                        failure_reason = f"URL error: {reason}"
                except Exception as exc:
                    failure_reason = f"error: {type(exc).__name__}"

            if failure_reason:
                last_failure = failure_reason

            health_spinner.update(
                f"Waiting for {service_name}… ({elapsed}s/{timeout}s) — {last_failure}"
            )
            time.sleep(interval)

    console.print(f"[error]⛔ {service_name} did not become healthy within {timeout}s[/error]")
    console.print(f"   [muted]Last failure: {last_failure}[/muted]")

    # Auto-fetch container logs if this maps to a container. The backend URL
    # carries a dynamic port (BACKEND_PORT), so its map entry (keyed on the
    # default 8000) can miss — match it on the /up/ path instead.
    prefix = SERVICE_CONTAINER_PREFIX_MAP.get(health_url)
    if prefix is None and health_url.endswith("/up/"):
        prefix = "tt_studio_backend"
    container = _resolve_container_name(prefix) if prefix else None
    if container:
        try:
            result = subprocess.run(
                ["docker", "logs", "--tail", "10", container],
                capture_output=True, text=True, check=False, timeout=10,
            )
            log_output = (result.stdout or "") + (result.stderr or "")
            if log_output.strip():
                console.print(f"[muted]   \\[{container} last 10 log lines][/muted]", highlight=False)
                for line in log_output.strip().splitlines()[-10:]:
                    # Raw container log lines may contain markup-like brackets.
                    console.print(f"   {line}", markup=False, highlight=False)
        except Exception:
            pass

    return False


def wait_for_all_services(skip_fastapi=False, is_deployed_mode=False, skip_docker_control=False):
    """
    Wait for all core services to become healthy.
    Returns True if all are healthy, False otherwise.
    """
    console.print("\n[info]⏳ Waiting for all services to become healthy...[/info]")

    services_to_check = [
        ("ChromaDB", "http://localhost:8111/api/v1/heartbeat"),
        ("Backend API", f"http://localhost:{get_backend_port()}/up/"),
        ("Frontend", "http://localhost:3000/"),
    ]
    if not skip_docker_control and os.path.exists(DOCKER_CONTROL_PID_FILE):
        services_to_check.append(("Docker Control Service", "http://localhost:8002/api/v1/health"))
    if not skip_fastapi and not is_deployed_mode:
        services_to_check.append(("FastAPI Server", "http://localhost:8001/"))

    all_healthy = True
    failed_services = []

    for service_name, health_url in services_to_check:
        if not wait_for_service_health(service_name, health_url, timeout=120, interval=3):
            all_healthy = False
            failed_services.append(service_name)

    if all_healthy:
        console.print("\n[success]✅ All services are healthy and ready![/success]")
    else:
        console.print()
        failed_lines = [f"[error]• {svc}[/error]" for svc in failed_services]
        console.print(notice_panel(
            "[error]Service health checks failed[/error]",
            failed_lines,
            border_style="error",
        ))

        # Map to log sources
        service_log_map = {
            "ChromaDB": "docker logs -f tt_studio_chroma",
            "Backend API": "docker logs -f tt_studio_backend",
            "Frontend": "docker logs -f tt_studio_frontend",
            "FastAPI Server": f"tail -f {MODEL_RUN_LOG_FILE}",
            "Docker Control Service": f"tail -f {DOCKER_CONTROL_LOG_FILE}",
        }
        console.print("\n[info]📋 Check logs:[/info]")
        for svc in failed_services:
            log_cmd = service_log_map.get(svc, "unknown")
            console.print(f"  [muted]# {svc}:[/muted]")
            console.print(f"  [muted]{log_cmd}[/muted]", highlight=False)

    return all_healthy


def wait_for_frontend_and_open_browser(host="localhost", port=3000, timeout=60, auto_deploy_model=None, device_id=0):
    """
    Wait for frontend service to be healthy before opening browser.

    Args:
        host: Frontend host
        port: Frontend port
        timeout: Timeout in seconds
        auto_deploy_model: Model name to auto-deploy (optional)
        device_id: Chip slot index for auto-deploy (default 0)

    Returns:
        bool: True if browser opened successfully, False otherwise
    """
    base_url = f"http://{host}:{port}/"

    # Add auto-deploy parameter if specified
    if auto_deploy_model:
        from urllib.parse import urlencode
        params = urlencode({"auto-deploy": auto_deploy_model, "device-id": device_id})
        frontend_url = f"{base_url}?{params}"
        console.print(f"\n[info]🤖 Auto-deploying model: {auto_deploy_model} on chip {device_id}[/info]")
    else:
        frontend_url = base_url

    if wait_for_service_health("Frontend", base_url, timeout=timeout, interval=2):
        try:
            webbrowser.open(frontend_url)
            return True
        except Exception as e:
            console.print(f"[warning]⚠️  Could not open browser automatically: {e}[/warning]")
            console.print(f"[info]💡 Please manually open: {frontend_url}[/info]")
            return False
    else:
        console.print(f"[warning]⚠️  Frontend not ready within {timeout} seconds[/warning]")
        console.print("[info]💡 To fix this, run:[/info]")
        console.print("  [bold]python run.py --stop && python run.py[/bold]")
        console.print("[info]   Or check container logs: cd app && docker compose logs -f[/info]")
        return False


def get_frontend_config():
    """
    Getting frontend configuration from environment or defaults.
    """
    # Read from environment variables or use defaults
    host = os.getenv('FRONTEND_HOST', 'localhost')
    port = int(os.getenv('FRONTEND_PORT', '3000'))
    timeout = int(os.getenv('FRONTEND_TIMEOUT', '60'))
    
    return host, port, timeout


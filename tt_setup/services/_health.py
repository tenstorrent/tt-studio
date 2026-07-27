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

    # Auto-fetch container logs if this maps to a container
    prefix = SERVICE_CONTAINER_PREFIX_MAP.get(health_url)
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
        ("Backend API", "http://localhost:8000/up/"),
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


def wait_for_frontend_and_open_browser(host="localhost", port=3000, timeout=60, auto_deploy_model=None, device_id=None, path=""):
    """
    Wait for frontend service to be healthy before opening browser.

    Args:
        host: Frontend host
        port: Frontend port
        timeout: Timeout in seconds
        auto_deploy_model: Model name to auto-deploy via the web UI (optional)
        device_id: Chip slot index for auto-deploy; None lets the backend allocate
        path: Path to open under the frontend root (e.g. "models-deployed")

    Returns:
        bool: True if browser opened successfully, False otherwise
    """
    base_url = f"http://{host}:{port}/"
    frontend_url = base_url + path.lstrip("/")

    # Add auto-deploy parameter if specified (UI-driven deploy path)
    if auto_deploy_model:
        from urllib.parse import urlencode
        query = {"auto-deploy": auto_deploy_model}
        if device_id is not None:
            query["device-id"] = device_id
        frontend_url = f"{frontend_url}?{urlencode(query)}"
        where = f" on chip {device_id}" if device_id is not None else ""
        console.print(f"\n[info]🤖 Auto-deploying model: {auto_deploy_model}{where}[/info]")

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


# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import sys
import time
import webbrowser

from _runner.constants import SERVICE_CONTAINER_PREFIX_MAP

try:
    import requests as _requests
    _HAS_REQUESTS = True
except ImportError:
    import urllib.request as _urllib_request
    _HAS_REQUESTS = False


def _resolve_container_name(prefix):
    """
    Resolve the full container name from a service prefix.
    Module-level private helper.
    """
    return SERVICE_CONTAINER_PREFIX_MAP.get(prefix, prefix)


class HealthMonitor:
    def __init__(self, ctx):
        self.ctx = ctx

    def wait_for_service_health(self, service_name, health_url, timeout=300, interval=5):
        """
        Wait for a service to become healthy (HTTP 200 at the given URL).
        Returns True if healthy within timeout, else False.
        Prints live status messages.
        """
        start_time = time.time()
        sys.stdout.write(f"⏳ Waiting for {service_name} to become healthy at {health_url}...\n")
        sys.stdout.flush()

        while time.time() - start_time < timeout:
            elapsed = int(time.time() - start_time)
            if _HAS_REQUESTS:
                try:
                    response = _requests.get(health_url, timeout=5)
                    if response.status_code == 200:
                        print(f"\n✅ {service_name} is healthy!")
                        return True
                except _requests.RequestException:
                    pass
            else:
                try:
                    resp = _urllib_request.urlopen(health_url, timeout=5)
                    if resp.getcode() == 200:
                        print(f"\n✅ {service_name} is healthy!")
                        return True
                except Exception:
                    pass

            sys.stdout.write(f"\r⏳ {service_name} not ready yet... ({elapsed}s/{timeout}s)")
            sys.stdout.flush()
            time.sleep(interval)

        print(f"\n⚠️  {service_name} did not become healthy within {timeout} seconds")
        return False

    def wait_for_all_services(self, skip_fastapi=False, is_deployed_mode=False):
        """
        Wait for all core services to become healthy before continuing.
        Returns True if all are healthy.
        """
        print("\n⏳ Waiting for all services to become healthy...")

        services_to_check = [
            ("ChromaDB", "http://localhost:8111/api/v1/heartbeat"),
            ("Backend API", "http://localhost:8000/up/"),
            ("Frontend", "http://localhost:3000/"),
        ]
        # Optionally add FastAPI
        if not skip_fastapi and not is_deployed_mode:
            services_to_check.append(("FastAPI Server", "http://localhost:8001/"))

        all_healthy = True
        for service_name, health_url in services_to_check:
            if not self.wait_for_service_health(service_name, health_url, timeout=120, interval=3):
                all_healthy = False

        if all_healthy:
            print("\n✅ All services are healthy and ready!")
        else:
            print("\n⚠️  Some services may not be fully ready, but main app may still be accessible.")
        return all_healthy

    def wait_for_frontend_and_open_browser(self, host="localhost", port=3000, timeout=60, auto_deploy_model=None):
        """
        Wait for frontend service to be healthy before opening browser.

        Args:
            host: Frontend host
            port: Frontend port
            timeout: Timeout in seconds
            auto_deploy_model: Model name to auto-deploy (optional)

        Returns:
            bool: True if browser opened successfully, False otherwise
        """
        base_url = f"http://{host}:{port}/"

        # Add auto-deploy parameter if specified
        if auto_deploy_model:
            from urllib.parse import urlencode
            params = urlencode({"auto-deploy": auto_deploy_model})
            frontend_url = f"{base_url}?{params}"
            print(f"\n🤖 Auto-deploying model: {auto_deploy_model}")
        else:
            frontend_url = base_url

        print(f"\n🌐 Ensuring frontend is ready before opening browser...")

        if self.wait_for_service_health("Frontend", base_url, timeout=timeout, interval=2):
            print(f"🚀 Opening browser to {frontend_url}")
            try:
                webbrowser.open(frontend_url)
                return True
            except Exception as e:
                print(f"⚠️  Could not open browser automatically: {e}")
                print(f"💡 Please manually open: {frontend_url}")
                return False
        else:
            print(f"⚠️  Frontend not ready within {timeout} seconds")
            print(f"💡 You can try opening {frontend_url} manually once services are ready")
            return False

    def get_frontend_config(self):
        """
        Getting frontend configuration from environment or defaults.
        """
        # Read from environment variables or use defaults
        host = os.getenv('FRONTEND_HOST', 'localhost')
        port = int(os.getenv('FRONTEND_PORT', '3000'))
        timeout = int(os.getenv('FRONTEND_TIMEOUT', '60'))

        return host, port, timeout

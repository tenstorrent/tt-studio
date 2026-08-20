# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Stub TT-Studio stack for the desktop e2e tests.

Answers 200 with a marker body on every path of the stack's ports (frontend
3000, backend 8000, inference 8001, docker control 8002) inside the fixture
container — these are container-local ports; tests reach them only through
the SSH tunnel's random local listeners. Started detached by the fake
run.py's bring-up; killed via /tmp/fake-stack.pid by its --stop.
"""

import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORTS = [3000, 8000, 8001, 8002]
MARKER = b"fake-tt-studio-stack ok\n"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (http.server API)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(MARKER)))
        self.end_headers()
        self.wfile.write(MARKER)

    def log_message(self, *args):  # keep the container logs quiet
        pass


def main():
    with open("/tmp/fake-stack.pid", "w") as f:
        f.write(str(os.getpid()))
    servers = [ThreadingHTTPServer(("127.0.0.1", port), Handler) for port in PORTS]
    threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in servers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


if __name__ == "__main__":
    main()

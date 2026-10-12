# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""PID 1 entrypoint for the Docker Control Uvicorn process.

The old ``uvicorn | tee`` shell pipeline made ``tee`` the status-producing
process and left a shell supervising Uvicorn. This wrapper keeps the log fanout
without losing Uvicorn's exit status or signal delivery.
"""

import os
import signal
import subprocess
import sys


def _forward_signal(process, signum, _frame):
    """Forward a container signal to the complete Uvicorn process group."""
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signum)
    except ProcessLookupError:
        pass
    except PermissionError:
        process.send_signal(signum)


def run_server(command, log_path):
    """Run *command*, mirror combined output, and return its exit status."""
    log_file = None
    if log_path:
        try:
            os.makedirs(os.path.dirname(log_path) or ".", exist_ok=True)
            log_file = open(log_path, "a", buffering=1)
        except OSError as exc:
            print(f"Docker Control log unavailable: {exc}", file=sys.stderr, flush=True)

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,
    )
    signals = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
    previous_handlers = {
        signum: signal.signal(
            signum,
            lambda received, frame, child=process: _forward_signal(child, received, frame),
        )
        for signum in signals
    }

    try:
        for line in process.stdout or ():
            sys.stdout.write(line)
            sys.stdout.flush()
            if log_file:
                log_file.write(line)
                log_file.flush()
        returncode = process.wait()
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
        if log_file:
            log_file.close()

    # Preserve normal failures exactly. A child terminated by a signal is
    # represented as the conventional 128+signal exit code for the container.
    return 128 + -returncode if returncode < 0 else returncode


def main():
    command = [sys.executable, "-m", "uvicorn", "api:app", *sys.argv[1:]]
    return run_server(command, os.getenv("DOCKER_CONTROL_LOG_FILE", ""))


if __name__ == "__main__":
    sys.exit(main())

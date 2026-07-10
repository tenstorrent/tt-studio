# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Structured startup logging (StartupLogger + the shared startup_log singleton)."""

import sys
import platform
from datetime import datetime
from tt_setup.constants import *


class StartupLogger:
    """
    Writes a structured startup.log to TT_STUDIO_ROOT.
    Fail-silent: if log file is unwritable, all methods are no-ops.
    """
    def __init__(self, log_path):
        self._path = log_path
        self._steps = []
        self._enabled = True
        try:
            self._f = open(log_path, 'w', buffering=1)
        except OSError:
            self._enabled = False
            self._f = None

    def _ts(self):
        return datetime.now().isoformat(timespec='seconds')

    def header(self, version_info):
        if not self._enabled:
            return
        self._f.write(f"=== TT Studio Startup Log ===\n")
        self._f.write(f"Timestamp : {self._ts()}\n")
        self._f.write(f"Version   : {version_info}\n")
        self._f.write(f"Python    : {sys.version.split()[0]}\n")
        self._f.write(f"Platform  : {OS_NAME} {platform.release()}\n")
        self._f.write(f"CWD       : {TT_STUDIO_ROOT}\n")
        self._f.write(f"{'─'*60}\n")

    def step(self, name, status="START", detail=""):
        if not self._enabled:
            return
        entry = {"step": name, "status": status, "detail": detail, "ts": self._ts()}
        self._steps.append(entry)
        line = f"[{entry['ts']}] [{status:<5}] {name}"
        if detail:
            line += f"  -- {detail}"
        self._f.write(line + "\n")

    def summary(self, exit_code):
        if not self._enabled:
            return
        self._f.write(f"{'─'*60}\n")
        self._f.write(f"Exit code : {exit_code}\n")
        fails = [s for s in self._steps if s['status'] == 'FAIL']
        if fails:
            self._f.write("Failed steps:\n")
            for s in fails:
                self._f.write(f"  - {s['step']}: {s['detail']}\n")
        else:
            self._f.write("All steps completed successfully.\n")
        self._f.write(f"=== End of log ===\n")
        self._f.flush()

    def close(self):
        if self._f:
            self._f.close()


startup_log = StartupLogger(STARTUP_LOG_FILE)

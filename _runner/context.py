# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import sys
import platform
from dataclasses import dataclass, field
from datetime import datetime
import argparse

from _runner.constants import OS_NAME, TT_STUDIO_ROOT


class StartupLogger:
    """Logger that writes to both stdout and a log file."""

    def __init__(self, log_file_path=None):
        self.log_file_path = log_file_path
        self._log_file = None
        if log_file_path:
            try:
                self._log_file = open(log_file_path, 'a', encoding='utf-8')
            except Exception:
                pass

    def log(self, message="", end="\n"):
        print(message, end=end)
        if self._log_file:
            try:
                self._log_file.write(message + end)
                self._log_file.flush()
            except Exception:
                pass

    def close(self):
        if self._log_file:
            try:
                self._log_file.close()
            except Exception:
                pass
            self._log_file = None

    def __del__(self):
        self.close()


@dataclass
class RunContext:
    args: argparse.Namespace
    startup_log: StartupLogger
    root: str

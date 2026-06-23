# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

# Belt-and-suspenders: never let the dependency bootstrap re-exec during tests
# (the run.py __main__ guard already prevents it on `import run`).
import os as _os
_os.environ.setdefault("TT_STUDIO_BOOTSTRAPPED", "1")

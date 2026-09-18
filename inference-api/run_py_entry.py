# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Entrypoint for dev-mode run.py subprocesses.

api.py patches the artifact's HF_TOKEN hard-gates in-process (hf_anon_patch),
but a dev-mode deploy runs run.py in a fresh interpreter, which re-imports the
artifact unpatched — so a token-less deploy dies at the artifact's
`getpass("Enter your HF_TOKEN: ")` prompt (EOFError, stdin is /dev/null).

This shim recreates the in-process import shape inside the child: put the
artifact on sys.path, import its `run` and `workflows.setup_host` modules,
apply the same patches, then hand over to run.main() with the original argv.

Usage: python run_py_entry.py /path/to/artifact/run.py [run.py args...]
"""

import os
import sys


def main() -> int:
    script = os.path.abspath(sys.argv[1])
    script_dir = os.path.dirname(script)
    # What run.py would see if executed directly.
    sys.argv = [script] + sys.argv[2:]
    # Artifact first so `run` / `workflows.*` resolve there; this shim's own
    # directory (sys.path[0] at script start) still provides hf_anon_patch.
    sys.path.insert(0, script_dir)

    import run as run_module
    import workflows.setup_host as setup_host_module
    from hf_anon_patch import apply_hf_anon_patches

    apply_hf_anon_patches(run_module, setup_host_module)
    return run_module.main()


if __name__ == "__main__":
    sys.exit(main())

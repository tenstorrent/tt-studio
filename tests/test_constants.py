# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for shared constants."""
import os
import unittest

try:
    from tt_setup import constants as M
except ImportError:  # pre-refactor: everything still lives in run.py
    import run as M


class TestConstants(unittest.TestCase):
    def test_colors_are_ansi_escapes(self):
        self.assertEqual(M.C_RESET, "\033[0m")
        for name in ("C_RED", "C_GREEN", "C_YELLOW", "C_BLUE", "C_CYAN", "C_BOLD"):
            self.assertTrue(getattr(M, name).startswith("\033["), name)

    def test_paths_derive_from_root(self):
        self.assertTrue(M.ENV_FILE_PATH.endswith(os.path.join("app", ".env")))
        self.assertTrue(M.ENV_FILE_DEFAULT.endswith(os.path.join("app", ".env.default")))
        self.assertEqual(
            M.DOCKER_COMPOSE_FILE,
            os.path.join(M.TT_STUDIO_ROOT, "app", "docker-compose.yml"),
        )
        self.assertTrue(M.STARTUP_LOG_FILE.endswith("startup.log"))

    def test_service_container_prefix_map(self):
        self.assertIsInstance(M.SERVICE_CONTAINER_PREFIX_MAP, dict)
        self.assertTrue(M.SERVICE_CONTAINER_PREFIX_MAP)

    def test_cleanup_identifiers(self):
        self.assertEqual(M._CLEANUP_VOLUME_PREFIX, "volume_id_")
        self.assertIsInstance(M._CLEANUP_IMAGE_REFS, tuple)
        self.assertTrue(M._CLEANUP_IMAGE_REFS)


if __name__ == "__main__":
    unittest.main()

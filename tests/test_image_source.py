# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the pull-vs-build decision helpers (tt_setup/image_source.py)."""
import unittest
from unittest.mock import patch

from tt_setup import image_source as M


class TestComputeImageTag(unittest.TestCase):
    def test_exact_release_tag_wins(self):
        self.assertEqual(M.compute_image_tag("v2.9.0", "a" * 40), "v2.9.0")

    def test_sha_is_truncated_to_12(self):
        sha = "0123456789abcdef0123456789abcdef01234567"
        self.assertEqual(M.compute_image_tag("", sha), "sha-0123456789ab")

    def test_no_git_metadata_falls_back_to_latest(self):
        self.assertEqual(M.compute_image_tag("", ""), "latest")


class TestFrontendConfigDrift(unittest.TestCase):
    """Naming the offending var is the difference between the user fixing it and
    the user asking why their build takes five minutes."""

    def _env(self, **overrides):
        return lambda name, default="": overrides.get(name, default)

    def test_stock_config_has_no_drift(self):
        self.assertEqual(M.frontend_config_drift(self._env()), [])

    def test_custom_title_is_named(self):
        env = self._env(VITE_APP_TITLE="Tenstorrent | TT Studio")
        self.assertEqual(M.frontend_config_drift(env), ["VITE_APP_TITLE"])

    def test_quoted_stock_title_is_still_stock(self):
        # .env values are sometimes quoted (VITE_APP_TITLE="TT Studio").
        self.assertEqual(M.frontend_config_drift(self._env(VITE_APP_TITLE='"TT Studio"')), [])

    def test_several_drifting_vars_are_all_named(self):
        env = self._env(VITE_APP_TITLE="Lab", VITE_ENABLE_RAG_ADMIN="true",
                        VITE_ENABLE_DEPLOYED="yes")
        self.assertEqual(M.frontend_config_drift(env),
                         ["VITE_ENABLE_DEPLOYED", "VITE_APP_TITLE", "VITE_ENABLE_RAG_ADMIN"])


class TestFrontendConfigIsStock(unittest.TestCase):
    def _env(self, **overrides):
        return lambda name, default="": overrides.get(name, default)

    def test_defaults_are_stock(self):
        self.assertTrue(M.frontend_config_is_stock(self._env()))

    def test_env_default_values_are_stock(self):
        env = self._env(VITE_APP_TITLE="TT Studio", VITE_ENABLE_DEPLOYED="false",
                        VITE_ENABLE_RAG_ADMIN="false")
        self.assertTrue(M.frontend_config_is_stock(env))

    def test_custom_title_is_not_stock(self):
        self.assertFalse(M.frontend_config_is_stock(self._env(VITE_APP_TITLE="My Lab")))

    def test_deployed_mode_is_not_stock(self):
        self.assertFalse(M.frontend_config_is_stock(self._env(VITE_ENABLE_DEPLOYED="true")))

    def test_rag_admin_is_not_stock(self):
        self.assertFalse(M.frontend_config_is_stock(self._env(VITE_ENABLE_RAG_ADMIN="yes")))


class TestDecideImageSource(unittest.TestCase):
    def test_clean_default_pulls(self):
        source, _ = M.decide_image_source(
            build_images=False, worktree_dirty=False, dev_mode=False, frontend_stock=True)
        self.assertEqual(source, "pull")

    def test_flag_forces_build(self):
        source, reason = M.decide_image_source(
            build_images=True, worktree_dirty=False, dev_mode=False, frontend_stock=True)
        self.assertEqual(source, "build")
        self.assertIn("--build-images", reason)

    def test_dirty_worktree_builds(self):
        source, _ = M.decide_image_source(
            build_images=False, worktree_dirty=True, dev_mode=True, frontend_stock=True)
        self.assertEqual(source, "build")

    def test_prod_with_custom_frontend_builds(self):
        # Prod frontend bakes VITE_* at build time; a pulled image would ignore
        # the user's settings.
        source, _ = M.decide_image_source(
            build_images=False, worktree_dirty=False, dev_mode=False, frontend_stock=False)
        self.assertEqual(source, "build")

    def test_dev_with_custom_frontend_still_pulls(self):
        # Dev frontend reads VITE_* at runtime, so the pulled image stays correct.
        source, _ = M.decide_image_source(
            build_images=False, worktree_dirty=False, dev_mode=True, frontend_stock=False)
        self.assertEqual(source, "pull")


class TestRequiredImageRefs(unittest.TestCase):
    def test_prod_refs(self):
        refs = M.required_image_refs(False, "ghcr.io/tenstorrent/tt-studio", "v2.9.0")
        self.assertEqual(refs, [
            "ghcr.io/tenstorrent/tt-studio/backend:v2.9.0",
            "ghcr.io/tenstorrent/tt-studio/agent:v2.9.0",
            "ghcr.io/tenstorrent/tt-studio/frontend:v2.9.0",
        ])

    def test_dev_uses_frontend_dev(self):
        refs = M.required_image_refs(True, "localhost:5000/tt-studio", "sha-abc123def456")
        self.assertIn("localhost:5000/tt-studio/frontend-dev:sha-abc123def456", refs)
        self.assertNotIn("localhost:5000/tt-studio/frontend:sha-abc123def456", refs)


class TestIsWorktreeDirty(unittest.TestCase):
    def _result(self, returncode=0, stdout=""):
        class R:
            pass
        r = R()
        r.returncode = returncode
        r.stdout = stdout
        return r

    def test_clean_tree(self):
        with patch.object(M.subprocess, "run", return_value=self._result(0, "")):
            self.assertFalse(M.is_worktree_dirty())

    def test_modified_tree(self):
        with patch.object(M.subprocess, "run",
                          return_value=self._result(0, " M app/backend/urls.py\n")):
            self.assertTrue(M.is_worktree_dirty())

    def test_git_failure_counts_as_dirty(self):
        # No git / not a repo: never risk running prebuilt bits over unknown
        # sources — build is the safe default.
        with patch.object(M.subprocess, "run", return_value=self._result(128, "")):
            self.assertTrue(M.is_worktree_dirty())

    def test_git_exception_counts_as_dirty(self):
        with patch.object(M.subprocess, "run", side_effect=OSError("no git")):
            self.assertTrue(M.is_worktree_dirty())


class TestDescribePullFallback(unittest.TestCase):
    def test_unpublished_with_cached_images(self):
        msg, hint = M.describe_pull_fallback("unpublished", "sha-205aedf73de2", cached=True)
        self.assertIn("sha-205aedf73de2", msg)
        self.assertIn("using local images", msg)
        self.assertIsNone(hint)

    def test_unpublished_without_cached_images_builds(self):
        msg, _ = M.describe_pull_fallback("unpublished", "sha-abc", cached=False)
        self.assertIn("building locally", msg)

    def test_offline_message_names_the_registry(self):
        msg, hint = M.describe_pull_fallback("unreachable", "v2.9.0", cached=True)
        self.assertIn("ghcr.io", msg)
        self.assertIsNone(hint)

    def test_auth_offers_the_login_hint(self):
        msg, hint = M.describe_pull_fallback("auth", "v2.9.0", cached=False)
        self.assertIn("login", msg)
        self.assertEqual(hint, "run: docker login ghcr.io")

    def test_unknown_kind_falls_back_to_generic(self):
        msg, hint = M.describe_pull_fallback("something-else", "v1", cached=False)
        self.assertIn("Couldn't pull", msg)
        self.assertIsNone(hint)


if __name__ == "__main__":
    unittest.main()

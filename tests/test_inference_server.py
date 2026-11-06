# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for inference-server artifact helpers."""
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    from tt_setup import inference_server as M
    # After the subpackage split, get_inference_server_version() reads
    # INFERENCE_ARTIFACT_DIR from the _metadata submodule's namespace, so patches
    # of that constant must target _metadata (not the re-export on the package).
    from tt_setup.inference_server import _metadata as _version_mod
    from tt_setup.inference_server import _orchestrator as _orch
    from tt_setup.inference_server import _git as _git_mod
    from tt_setup.inference_server import _privileges as _priv_mod
    from tt_setup.inference_server import _config as _cfg_mod
except ImportError:  # pre-refactor
    import run as M
    _version_mod = _orch = _git_mod = _priv_mod = _cfg_mod = M


class TestValidateArtifactStructure(unittest.TestCase):
    def test_missing_dir_is_invalid(self):
        self.assertFalse(M.validate_artifact_structure("/nope/xyz"))

    def test_missing_workflows_is_invalid(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(M.validate_artifact_structure(d))

    def test_valid_structure(self):
        with tempfile.TemporaryDirectory() as d:
            wf = os.path.join(d, "workflows")
            os.makedirs(wf)
            with open(os.path.join(wf, "utils.py"), "w") as f:
                f.write("# not empty\n")
            self.assertTrue(M.validate_artifact_structure(d))

    def test_empty_utils_is_invalid(self):
        with tempfile.TemporaryDirectory() as d:
            wf = os.path.join(d, "workflows")
            os.makedirs(wf)
            open(os.path.join(wf, "utils.py"), "w").close()  # empty
            self.assertFalse(M.validate_artifact_structure(d))


class TestWriteArtifactInfo(unittest.TestCase):
    def test_writes_machine_readable_markers(self):
        with tempfile.TemporaryDirectory() as d:
            M._write_artifact_info(d, "branch", "main", commit_sha="abc123")
            with open(os.path.join(d, "artifact-info.txt")) as f:
                content = f.read()
        self.assertIn("artifact_type=branch", content)
        self.assertIn("artifact_value=main", content)
        self.assertIn("commit_sha=abc123", content)


class TestGetInferenceServerVersion(unittest.TestCase):
    def test_reads_version_file(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "VERSION"), "w") as f:
                f.write("v9.9.9\n")
            with patch.object(_version_mod, "INFERENCE_ARTIFACT_DIR", d):
                self.assertEqual(M.get_inference_server_version(), "v9.9.9")


class TestSyncModelCatalog(unittest.TestCase):
    def setUp(self):
        from tt_setup.inference_server import _catalog
        self.catalog = _catalog

    def test_retries_without_the_spec_when_the_sync_fails(self):
        with patch.object(self.catalog, "_run_sync", side_effect=[False, True]) as run:
            self.assertTrue(M._sync_model_catalog())
        self.assertEqual(run.call_args_list[-1].args, ("--no-model-support",))

    def test_no_retry_when_the_sync_succeeds(self):
        with patch.object(self.catalog, "_run_sync", return_value=True) as run:
            self.assertTrue(M._sync_model_catalog())
        run.assert_called_once_with()

    def _matches(self, built_from, installed):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "catalog.json")
            with open(path, "w") as f:
                f.write('{"source": {"artifact_version": "%s"}}' % built_from)
            with patch.object(self.catalog, "CATALOG_JSON", path), \
                 patch.object(self.catalog, "_installed_version", return_value=installed):
                return M.catalog_matches_artifact()

    def test_catalog_matches_artifact(self):
        self.assertTrue(self._matches("0.23.0", "0.23.0"))
        self.assertTrue(self._matches("v0.23.0", "0.23.0"))
        self.assertFalse(self._matches("0.22.0", "0.23.0"))

    def test_unknown_versions_count_as_matching(self):
        self.assertTrue(self._matches("0.22.0", None))
        self.assertTrue(self._matches("", "0.23.0"))


if __name__ == "__main__":
    unittest.main()


class TestArtifactMountStub(unittest.TestCase):
    """Before the first download the artifact dir holds only the empty
    workflow_logs/ bind-mount source; that must not read as a broken download,
    but anything else must."""

    def test_empty_workflow_logs_stub_is_recognised(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "workflow_logs", "run_logs"))
            self.assertTrue(_orch._is_mount_stub(root))

    def test_partial_download_is_not_a_stub(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "workflow_logs"))
            with open(os.path.join(root, "VERSION"), "w") as f:
                f.write("0.22.0")
            self.assertFalse(_orch._is_mount_stub(root))

    def test_extraction_that_left_only_directories_is_not_a_stub(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "workflow_logs"))
            os.makedirs(os.path.join(root, "workflows", "utils"))
            self.assertFalse(_orch._is_mount_stub(root))


class TestInferenceServerGit(unittest.TestCase):
    def test_is_commit_sha(self):
        self.assertTrue(_git_mod._is_commit_sha("a" * 40))
        self.assertTrue(_git_mod._is_commit_sha("0123456789abcdef0123456789ABCDEF01234567"))
        self.assertFalse(_git_mod._is_commit_sha("a" * 39))
        self.assertFalse(_git_mod._is_commit_sha("a" * 41))
        self.assertFalse(_git_mod._is_commit_sha("g" * 40))
        self.assertFalse(_git_mod._is_commit_sha(""))
        self.assertFalse(_git_mod._is_commit_sha(None))

    def test_fetch_branch_commit_sha(self):
        import io
        import json

        # Dict response
        mock_resp = io.BytesIO(json.dumps({"object": {"sha": "deadbeef" * 5}}).encode())
        with patch("urllib.request.urlopen", return_value=mock_resp):
            self.assertEqual(_git_mod.fetch_branch_commit_sha("main"), "deadbeef" * 5)

        # List response
        mock_resp = io.BytesIO(json.dumps([{"object": {"sha": "feedface" * 5}}]).encode())
        with patch("urllib.request.urlopen", return_value=mock_resp):
            self.assertEqual(_git_mod.fetch_branch_commit_sha("dev"), "feedface" * 5)

        # Empty list
        mock_resp = io.BytesIO(json.dumps([]).encode())
        with patch("urllib.request.urlopen", return_value=mock_resp):
            self.assertIsNone(_git_mod.fetch_branch_commit_sha("empty"))

        # Exception
        with patch("urllib.request.urlopen", side_effect=Exception("network down")):
            self.assertIsNone(_git_mod.fetch_branch_commit_sha("error"))

    def test_ref_status(self):
        import urllib.error
        from unittest.mock import MagicMock

        # 200 -> "ok"
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.__enter__.return_value = mock_resp
        with patch("urllib.request.urlopen", return_value=mock_resp):
            self.assertEqual(_git_mod._ref_status("https://api.github.com/ok"), "ok")

        # 404 HTTPError -> "missing"
        err_404 = urllib.error.HTTPError("url", 404, "Not Found", {}, None)
        with patch("urllib.request.urlopen", side_effect=err_404):
            self.assertEqual(_git_mod._ref_status("https://api.github.com/missing"), "missing")

        # 500 HTTPError -> "unknown"
        err_500 = urllib.error.HTTPError("url", 500, "Server Error", {}, None)
        with patch("urllib.request.urlopen", side_effect=err_500):
            self.assertEqual(_git_mod._ref_status("https://api.github.com/500"), "unknown")

        # General Exception -> "unknown"
        with patch("urllib.request.urlopen", side_effect=Exception("error")):
            self.assertEqual(_git_mod._ref_status("https://api.github.com/err"), "unknown")

    def test_check_branch_and_release_exists(self):
        with patch.object(_git_mod, "_ref_status", return_value="ok") as mock_ref:
            # Check commit SHA routing
            sha = "1" * 40
            self.assertEqual(_git_mod.check_branch_exists(sha), "ok")
            self.assertIn(f"/commits/{sha}", mock_ref.call_args[0][0])

            # Check branch name routing
            self.assertEqual(_git_mod.check_branch_exists("feat-test"), "ok")
            self.assertIn("/branches/feat-test", mock_ref.call_args[0][0])

            # Check release tag routing
            self.assertEqual(_git_mod.check_release_exists("v0.12.0"), "ok")
            self.assertIn("/git/ref/tags/v0.12.0", mock_ref.call_args[0][0])


class TestInferenceServerPrivileges(unittest.TestCase):
    def test_request_sudo_authentication_missing_sudo(self):
        with patch("shutil.which", return_value=None), \
             patch.object(_priv_mod.console, "print"):
            self.assertFalse(_priv_mod.request_sudo_authentication())

    def test_request_sudo_authentication_already_authed(self):
        import subprocess
        mock_res = subprocess.CompletedProcess(["sudo", "-n", "-v"], returncode=0)
        with patch("shutil.which", return_value="/usr/bin/sudo"), \
             patch("subprocess.run", return_value=mock_res) as mock_run:
            self.assertTrue(_priv_mod.request_sudo_authentication(force_prompt=False))
            mock_run.assert_called_once_with(["sudo", "-n", "-v"], capture_output=True, text=True)

    def test_request_sudo_authentication_interactive_flow(self):
        import subprocess
        check_fail = subprocess.CompletedProcess(["sudo", "-n", "-v"], returncode=1)
        prompt_ok = subprocess.CompletedProcess(["sudo", "-v"], returncode=0)

        with patch("shutil.which", return_value="/usr/bin/sudo"), \
             patch("subprocess.run", side_effect=[check_fail, prompt_ok]), \
             patch.object(_priv_mod.console, "print"):
            self.assertTrue(_priv_mod.request_sudo_authentication())

    def test_request_sudo_authentication_failures(self):
        import subprocess
        check_fail = subprocess.CompletedProcess(["sudo", "-n", "-v"], returncode=1)

        # CalledProcessError 1 (bad password)
        err1 = subprocess.CalledProcessError(1, ["sudo", "-v"])
        with patch("shutil.which", return_value="/usr/bin/sudo"), \
             patch("subprocess.run", side_effect=[check_fail, err1]), \
             patch.object(_priv_mod.console, "print"):
            self.assertFalse(_priv_mod.request_sudo_authentication())

        # FileNotFoundError
        with patch("shutil.which", return_value="/usr/bin/sudo"), \
             patch("subprocess.run", side_effect=[check_fail, FileNotFoundError()]), \
             patch.object(_priv_mod.console, "print"):
            self.assertFalse(_priv_mod.request_sudo_authentication())

    def test_remove_artifact_with_sudo(self):
        with patch("os.path.exists", return_value=False):
            self.assertTrue(_priv_mod.remove_artifact_with_sudo("/fake/path"))

        with patch("os.path.exists", return_value=True), \
             patch.object(_priv_mod, "_remove_path_with_docker", return_value=True) as mock_rm, \
             patch.object(_priv_mod.console, "print"):
            self.assertTrue(_priv_mod.remove_artifact_with_sudo("/real/path"))
            mock_rm.assert_called_once_with("/real/path")


class TestInferenceServerConfig(unittest.TestCase):
    def test_quick_setup_returns_early(self):
        with patch.object(_cfg_mod, "ask") as mock_ask, \
             patch.object(_cfg_mod, "confirm") as mock_confirm:
            _cfg_mod.configure_inference_server_artifact(quick_setup=True)
            mock_ask.assert_not_called()
            mock_confirm.assert_not_called()

    def test_existing_config_kept_without_reconfigure(self):
        with patch.object(_cfg_mod, "get_env_var", side_effect=lambda k: "v0.8.0" if "VERSION" in k else None), \
             patch.object(_cfg_mod, "ask") as mock_ask, \
             patch.object(_cfg_mod.console, "print"):
            _cfg_mod.configure_inference_server_artifact(force_reconfigure=False, reconfigure_inference=False)
            mock_ask.assert_not_called()

    def test_reconfigure_prompt_declined(self):
        with patch.object(_cfg_mod, "get_env_var", side_effect=lambda k: "main" if "BRANCH" in k else None), \
             patch.object(_cfg_mod, "confirm", return_value=False) as mock_confirm, \
             patch.object(_cfg_mod, "ask") as mock_ask, \
             patch.object(_cfg_mod.console, "print"):
            _cfg_mod.configure_inference_server_artifact(force_reconfigure=True)
            mock_confirm.assert_called_once()
            mock_ask.assert_not_called()

    def test_choice_1_model_support_spec(self):
        with patch.object(_cfg_mod, "get_env_var", return_value=None), \
             patch.object(_cfg_mod, "ask", return_value="1"), \
             patch.object(_cfg_mod, "write_env_var") as mock_write, \
             patch.object(_cfg_mod.console, "print"):
            _cfg_mod.configure_inference_server_artifact()
            self.assertEqual(mock_write.call_count, 2)
            written_vars = [c[0][0] for c in mock_write.call_args_list]
            self.assertIn("TT_INFERENCE_ARTIFACT_VERSION", written_vars)
            self.assertIn("TT_INFERENCE_ARTIFACT_BRANCH", written_vars)

    def test_choice_2_release_version_happy_path_latest(self):
        with patch.object(_cfg_mod, "get_env_var", return_value=None), \
             patch.object(_cfg_mod, "ask", side_effect=["2", "latest"]), \
             patch.object(_cfg_mod, "write_env_var") as mock_write, \
             patch.object(_cfg_mod.console, "print"):
            _cfg_mod.configure_inference_server_artifact()
            mock_write.assert_called_once_with("TT_INFERENCE_ARTIFACT_VERSION", "latest", quote_value=False)

    def test_choice_2_release_version_validation_and_cleanup(self):
        with patch.object(_cfg_mod, "get_env_var", side_effect=lambda k: "v0.7.0" if "VERSION" in k else None), \
             patch.object(_cfg_mod, "confirm", return_value=True), \
             patch.object(_cfg_mod, "ask", side_effect=["2", "v.10.0", "v0.9.0", "v0.8.0"]), \
             patch.object(_cfg_mod, "check_release_exists", side_effect=["missing", "ok"]), \
             patch("os.path.exists", return_value=True), \
             patch("shutil.rmtree") as mock_rmtree, \
             patch.object(_cfg_mod, "write_env_var") as mock_write, \
             patch.object(_cfg_mod.console, "print"):
            _cfg_mod.configure_inference_server_artifact(force_reconfigure=True)
            mock_write.assert_called_once_with("TT_INFERENCE_ARTIFACT_VERSION", "v0.8.0", quote_value=False)
            mock_rmtree.assert_called_once()

    def test_choice_2_release_version_cleanup_sudo_fallback(self):
        with patch.object(_cfg_mod, "get_env_var", side_effect=lambda k: "v0.7.0" if "VERSION" in k else None), \
             patch.object(_cfg_mod, "confirm", return_value=True), \
             patch.object(_cfg_mod, "ask", side_effect=["2", "v0.8.0"]), \
             patch.object(_cfg_mod, "check_release_exists", return_value="unknown"), \
             patch("os.path.exists", return_value=True), \
             patch("shutil.rmtree", side_effect=PermissionError("denied")), \
             patch.object(_cfg_mod, "remove_artifact_with_sudo", return_value=False) as mock_sudo_rm, \
             patch.object(_cfg_mod, "write_env_var"), \
             patch.object(_cfg_mod.console, "print"):
            _cfg_mod.configure_inference_server_artifact(force_reconfigure=True)
            mock_sudo_rm.assert_called_once()

    def test_choice_3_branch_validation_and_cleanup(self):
        with patch.object(_cfg_mod, "get_env_var", side_effect=lambda k: "v0.8.0" if "VERSION" in k else "old-branch"), \
             patch.object(_cfg_mod, "confirm", return_value=True), \
             patch.object(_cfg_mod, "ask", side_effect=["3", "", "bad-branch", "feature-x"]), \
             patch.object(_cfg_mod, "check_branch_exists", side_effect=["missing", "ok"]), \
             patch("os.path.exists", return_value=True), \
             patch("shutil.rmtree", side_effect=OSError("locked")), \
             patch.object(_cfg_mod, "remove_artifact_with_sudo", return_value=True) as mock_sudo_rm, \
             patch.object(_cfg_mod, "write_env_var") as mock_write, \
             patch.object(_cfg_mod.console, "print"):
            _cfg_mod.configure_inference_server_artifact(reconfigure_inference=True)
            written = {c[0][0]: c[0][1] for c in mock_write.call_args_list}
            self.assertEqual(written.get("TT_INFERENCE_ARTIFACT_VERSION"), "")
            self.assertEqual(written.get("TT_INFERENCE_ARTIFACT_BRANCH"), "feature-x")
            mock_sudo_rm.assert_called_once()


class TestInferenceServerOrchestrator(unittest.TestCase):
    def test_is_valid_targz(self):
        import tarfile
        with tempfile.TemporaryDirectory() as d:
            # 1. Non-existent path
            self.assertFalse(_orch._is_valid_targz(os.path.join(d, "nonexistent.tar.gz")))

            # 2. Empty file (0 bytes)
            empty_file = os.path.join(d, "empty.tar.gz")
            open(empty_file, "w").close()
            self.assertFalse(_orch._is_valid_targz(empty_file))

            # 3. Corrupt file
            corrupt_file = os.path.join(d, "corrupt.tar.gz")
            with open(corrupt_file, "wb") as f:
                f.write(b"not a valid tar.gz file content")
            self.assertFalse(_orch._is_valid_targz(corrupt_file))

            # 4. Valid gzip tarball
            valid_file = os.path.join(d, "valid.tar.gz")
            dummy_content = os.path.join(d, "dummy.txt")
            with open(dummy_content, "w") as f:
                f.write("hello")
            with tarfile.open(valid_file, "w:gz") as tar:
                tar.add(dummy_content, arcname="dummy.txt")
            self.assertTrue(_orch._is_valid_targz(valid_file))

    def test_report_extract_failure_truncated_removes_bad_archive(self):
        with tempfile.TemporaryDirectory() as d:
            bad_archive = os.path.join(d, "bad.tar.gz")
            with open(bad_archive, "w") as f:
                f.write("bad")
            with patch.object(_orch.console, "print"):
                _orch._report_extract_failure(EOFError("unexpected end of file"), bad_archive)
            self.assertFalse(os.path.exists(bad_archive))

    def test_report_extract_failure_generic_error(self):
        with tempfile.TemporaryDirectory() as d:
            archive = os.path.join(d, "archive.tar.gz")
            with open(archive, "w") as f:
                f.write("data")
            with patch.object(_orch.console, "print") as mock_print:
                _orch._report_extract_failure(ValueError("some other error"), archive)
                self.assertTrue(os.path.exists(archive))
                self.assertTrue(mock_print.called)

    def test_setup_both_branch_and_version_set_choose_branch(self):
        with tempfile.TemporaryDirectory() as d:
            art_dir = os.path.join(d, "tt-inference-server")
            os.makedirs(art_dir)
            with patch.object(_orch, "TT_STUDIO_ROOT", d), \
                 patch.object(_orch, "INFERENCE_ARTIFACT_DIR", art_dir), \
                 patch.object(_orch, "get_env_var", side_effect=lambda k: "main" if "BRANCH" in k else "v0.8.0"), \
                 patch.object(_orch, "ask", return_value="1"), \
                 patch.object(_orch, "comment_out_env_var") as mock_comment, \
                 patch.object(_orch, "console"), \
                 patch.object(_orch, "_set_artifact_environment_variables"):
                # Make valid artifact directory
                wf = os.path.join(art_dir, "workflows")
                os.makedirs(wf)
                with open(os.path.join(wf, "utils.py"), "w") as f:
                    f.write("# utils")
                with open(os.path.join(art_dir, "VERSION"), "w") as f:
                    f.write("0.8.0")
                art_info_dir = os.path.join(d, ".artifacts")
                os.makedirs(art_info_dir, exist_ok=True)
                with open(os.path.join(art_info_dir, "artifact-info.txt"), "w") as f:
                    f.write("     artifact_type=branch\n     artifact_value=main\n     commit_sha=abcdef123456\n")

                with patch.object(_orch, "fetch_branch_commit_sha", return_value="abcdef123456"):
                    res = _orch.setup_tt_inference_server()
                    self.assertTrue(res)
                    mock_comment.assert_called_once_with("TT_INFERENCE_ARTIFACT_VERSION")

    def test_setup_both_branch_and_version_set_choose_version(self):
        with tempfile.TemporaryDirectory() as d:
            art_dir = os.path.join(d, "tt-inference-server")
            os.makedirs(art_dir)
            with patch.object(_orch, "TT_STUDIO_ROOT", d), \
                 patch.object(_orch, "INFERENCE_ARTIFACT_DIR", art_dir), \
                 patch.object(_orch, "get_env_var", side_effect=lambda k: "main" if "BRANCH" in k else "v0.8.0"), \
                 patch.object(_orch, "ask", return_value="2"), \
                 patch.object(_orch, "comment_out_env_var") as mock_comment, \
                 patch.object(_orch, "console"), \
                 patch.object(_orch, "_set_artifact_environment_variables"), \
                 patch.object(_orch, "get_inference_server_version", return_value="0.8.0"):
                # Make valid artifact directory
                wf = os.path.join(art_dir, "workflows")
                os.makedirs(wf)
                with open(os.path.join(wf, "utils.py"), "w") as f:
                    f.write("# utils")
                with open(os.path.join(art_dir, "VERSION"), "w") as f:
                    f.write("0.8.0")
                art_info_dir = os.path.join(d, ".artifacts")
                os.makedirs(art_info_dir, exist_ok=True)
                with open(os.path.join(art_info_dir, "artifact-info.txt"), "w") as f:
                    f.write("     artifact_type=version\n     artifact_value=v0.8.0\n")

                res = _orch.setup_tt_inference_server()
                self.assertTrue(res)
                mock_comment.assert_called_once_with("TT_INFERENCE_ARTIFACT_BRANCH")

    def test_setup_cached_version_matches(self):
        with tempfile.TemporaryDirectory() as d:
            art_dir = os.path.join(d, "tt-inference-server")
            os.makedirs(art_dir)
            with patch.object(_orch, "TT_STUDIO_ROOT", d), \
                 patch.object(_orch, "INFERENCE_ARTIFACT_DIR", art_dir), \
                 patch.object(_orch, "get_env_var", side_effect=lambda k: "v0.8.0" if "VERSION" in k else None), \
                 patch.object(_orch, "get_inference_server_version", return_value="0.8.0"), \
                 patch.object(_orch, "console"), \
                 patch.object(_orch, "_set_artifact_environment_variables") as mock_set_env:
                wf = os.path.join(art_dir, "workflows")
                os.makedirs(wf)
                with open(os.path.join(wf, "utils.py"), "w") as f:
                    f.write("# ok")
                with open(os.path.join(art_dir, "VERSION"), "w") as f:
                    f.write("0.8.0")
                art_info_dir = os.path.join(d, ".artifacts")
                os.makedirs(art_info_dir, exist_ok=True)
                with open(os.path.join(art_info_dir, "artifact-info.txt"), "w") as f:
                    f.write("     artifact_type=version\n     artifact_value=v0.8.0\n")

                res = _orch.setup_tt_inference_server()
                self.assertTrue(res)
                mock_set_env.assert_called_once_with(art_dir)




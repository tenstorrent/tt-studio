# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for the Open WebUI pre-launch check: a data volume whose accounts would
make the WEBUI_AUTH=False auto sign-in fail must be launched with sign-in on,
and the running card must tell the user why.
"""

import os
import pytest
from unittest.mock import Mock, patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")
import django

django.setup()

from model_control import marketplace_utils
from model_control.marketplace_utils import (
    OPEN_WEBUI_SIGN_IN_NOTE,
    _pre_launch_env,
    serialize_app,
)
from shared_config.marketplace_config import get_app


OPEN_WEBUI = get_app("open-webui")
PROBE_PREFIX = f"{OPEN_WEBUI.container_name}_probe_"


def _client(probe_output):
    """A docker-control client whose probe container exits with probe_output."""
    client = Mock()
    client.get_container.return_value = {"status": "exited"}
    client.tail_logs.return_value = [probe_output]
    return client


class TestOpenWebUIPreLaunchEnv:
    def test_fresh_volume_keeps_auth_off(self):
        assert _pre_launch_env(OPEN_WEBUI, _client("users=0 admin=0")) == {}

    def test_volume_with_only_the_auto_admin_keeps_auth_off(self):
        assert _pre_launch_env(OPEN_WEBUI, _client("users=1 admin=1")) == {}

    def test_auto_admin_alongside_other_accounts_keeps_auth_off(self):
        # Open WebUI signs in as admin@localhost whenever that account exists.
        assert _pre_launch_env(OPEN_WEBUI, _client("users=3 admin=1")) == {}

    def test_accounts_without_the_auto_admin_turn_sign_in_on(self):
        assert _pre_launch_env(OPEN_WEBUI, _client("users=2 admin=0")) == {"WEBUI_AUTH": "True"}

    def test_probe_runs_against_the_app_volume_and_removes_only_itself(self):
        client = _client("users=0 admin=0")
        _pre_launch_env(OPEN_WEBUI, client)
        run = client.run_container.call_args.kwargs
        assert run["name"].startswith(PROBE_PREFIX)
        assert run["image"] == OPEN_WEBUI.image
        assert run["volumes"] == dict(OPEN_WEBUI.volumes)
        removed = [c.args[0] for c in client.remove_container.call_args_list]
        assert removed == [run["name"]]

    def test_overlapping_launches_use_separate_probes(self):
        first, second = _client("users=0 admin=0"), _client("users=0 admin=0")
        _pre_launch_env(OPEN_WEBUI, first)
        _pre_launch_env(OPEN_WEBUI, second)
        assert (
            first.run_container.call_args.kwargs["name"]
            != second.run_container.call_args.kwargs["name"]
        )

    def test_unreadable_probe_output_falls_back_to_defaults(self):
        assert _pre_launch_env(OPEN_WEBUI, _client("Traceback ... no such table")) == {}

    def test_probe_failure_falls_back_to_defaults(self):
        client = _client("")
        client.run_container.side_effect = RuntimeError("docker-control unavailable")
        assert _pre_launch_env(OPEN_WEBUI, client) == {}

    def test_apps_without_a_hook_get_nothing(self):
        client = Mock()
        assert _pre_launch_env(get_app("anythingllm"), client) == {}
        client.run_container.assert_not_called()


class TestOpenWebUISignInNote:
    def _running(self, env):
        return {
            "id": "abc",
            "name": OPEN_WEBUI.container_name,
            "status": "running",
            "environment": env,
            "HostConfig": {"PortBindings": {}},
        }

    @patch.object(marketplace_utils, "get_job", return_value=None)
    @patch.object(marketplace_utils, "launch_blocked_reason", return_value=None)
    def test_note_shown_when_launched_with_sign_in(self, *_):
        payload = serialize_app(OPEN_WEBUI, [self._running(["WEBUI_AUTH=True"])])
        assert payload["status"] == "running"
        assert payload["first_run_note"] == OPEN_WEBUI_SIGN_IN_NOTE

    @patch.object(marketplace_utils, "get_job", return_value=None)
    @patch.object(marketplace_utils, "launch_blocked_reason", return_value=None)
    def test_no_note_when_auth_is_off(self, *_):
        payload = serialize_app(OPEN_WEBUI, [self._running(["WEBUI_AUTH=False"])])
        assert payload["first_run_note"] is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

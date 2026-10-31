# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for connection warmer offloading, container filtering, and negative caching."""

import asyncio
import concurrent.futures
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")
import django

django.setup()

from model_control import connection_warmer
from model_control import model_utils


class TestConnectionWarmerFilters:
    """Test that connection warmer only targets managed containers and offloads cache reads."""

    def test_ping_all_skips_unmanaged_containers(self):
        """_ping_all should only send /health pings to source='managed' containers."""
        mock_entries = {
            "c_managed": {
                "source": "managed",
                "health_url": "managed_host:8000/health",
                "jwt_secret": "sec",
            },
            "c_docker_only": {
                "source": "docker_only",
                "health_url": "discovered_host:8001/health",
            },
            "c_external_unmanaged": {
                "source": "external",
                "health_url": "unmanaged_host:8002/health",
            },
        }

        mock_client = MagicMock()
        mock_client.get = AsyncMock()

        with patch("model_control.model_utils.get_deploy_cache", return_value=mock_entries), \
             patch("model_control.model_utils._vllm_client", mock_client), \
             patch("model_control.model_utils.auth_headers", return_value={"Authorization": "Bearer test"}):
            asyncio.run(connection_warmer._ping_all())

        assert mock_client.get.call_count == 1
        call_url = mock_client.get.call_args[0][0]
        assert call_url == "http://managed_host:8000/health"

    def test_warmup_inference_all_skips_unmanaged_containers(self):
        """_warmup_inference_all should only send warmup requests to source='managed' containers."""
        mock_impl = MagicMock()
        mock_impl.hf_model_id = "test-hf-model"

        mock_entries = {
            "c_managed": {
                "source": "managed",
                "internal_url": "managed_host:8000/v1/chat/completions",
                "cached_model_name": "test-chat-model",
                "model_impl": mock_impl,
            },
            "c_docker_only": {
                "source": "docker_only",
                "internal_url": "discovered_host:8001/v1/chat/completions",
                "cached_model_name": "other-model",
                "model_impl": mock_impl,
            },
        }

        mock_client = MagicMock()
        mock_client.post = AsyncMock()

        with patch("model_control.model_utils.get_deploy_cache", return_value=mock_entries), \
             patch("model_control.model_utils._vllm_client", mock_client), \
             patch("model_control.model_utils.auth_headers", return_value={"Authorization": "Bearer test"}):
            asyncio.run(connection_warmer._warmup_inference_all())

        assert mock_client.post.call_count == 1
        call_url = mock_client.post.call_args[0][0]
        assert call_url == "http://managed_host:8000/v1/chat/completions"

    def test_warmer_tick_prevents_pileup_when_previous_ping_pending(self):
        """_warmer_tick should skip scheduling when previous ping future is still running."""
        unfinished_future = concurrent.futures.Future()
        connection_warmer._ping_future = unfinished_future

        mock_loop = MagicMock()
        mock_loop.is_running.return_value = True

        with patch("asyncio.run_coroutine_threadsafe") as mock_schedule:
            connection_warmer._warmer_tick(mock_loop)
            mock_schedule.assert_not_called()

        # Clean up
        unfinished_future.set_result(None)
        connection_warmer._ping_future = None


class TestNegativeCaching:
    """Test negative caching / failure cooldown logic in model_utils."""

    def setup_method(self):
        model_utils._probe_failures.clear()

    def teardown_method(self):
        model_utils._probe_failures.clear()

    def test_cooldown_lifecycle(self):
        """Verify recording failure, cooldown active, and clearing failure."""
        cid = "con_test_123"
        assert not model_utils.is_probe_in_cooldown(cid)

        # Record failure
        model_utils.record_probe_failure(cid)
        assert model_utils.is_probe_in_cooldown(cid)

        # Clear failure on recovery
        model_utils.clear_probe_failure(cid)
        assert not model_utils.is_probe_in_cooldown(cid)

    def test_cooldown_expiration(self):
        """Verify cooldown expires after TTL."""
        cid = "con_expire_test"
        model_utils.record_probe_failure(cid)
        # Backdate failure past cooldown TTL
        model_utils._probe_failures[cid] = (
            time.monotonic() - (model_utils._PROBE_FAILURE_COOLDOWN_SECONDS + 5.0)
        )
        assert not model_utils.is_probe_in_cooldown(cid)
        assert cid not in model_utils._probe_failures

    def test_get_deploy_cache_respects_negative_cooldown_on_failure(self):
        """When /v1/models fails once, subsequent calls skip probing."""
        cid = "frozen_con_456"
        entry = {
            "internal_url": "frozen_host:7000/v1/chat/completions",
            "model_impl": MagicMock(hf_model_id="fallback-model"),
        }
        mock_cache = MagicMock()
        mock_cache._cache = {f":version:{cid}": b"dummy_data"}

        with patch("model_control.model_utils.caches", {"deploy_cache": mock_cache}), \
             patch("model_control.model_utils.update_deploy_cache"), \
             patch("model_control.model_utils.requests.get", side_effect=Exception("Connection refused")) as mock_get:

            # Inject record into cache simulation
            with patch("model_control.model_utils.pickle.loads", return_value=dict(entry)):
                with patch.object(model_utils, "_last_deploy_cache_update", time.monotonic()):
                    # Call 1: probe fails and triggers cooldown
                    res1 = model_utils.get_deploy_cache()
                    assert mock_get.call_count == 1
                    assert model_utils.is_probe_in_cooldown(cid)
                    assert res1[cid]["cached_model_name"] == "fallback-model"

                    # Call 2: in cooldown -> 0 additional HTTP calls!
                    res2 = model_utils.get_deploy_cache()
                    assert mock_get.call_count == 1

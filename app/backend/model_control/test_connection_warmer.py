# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for connection warmer offloading, container filtering, and negative caching."""

import asyncio
import concurrent.futures
import os
import threading
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")
import django

django.setup()

from django.core.cache.backends.locmem import LocMemCache

from docker_control import docker_utils
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
        model_utils._active_probes.clear()

    def teardown_method(self):
        model_utils._probe_failures.clear()
        model_utils._active_probes.clear()

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

    def test_get_deploy_cache_sets_none_max_model_len_without_infinite_loop(self):
        """When /v1/models returns no max_model_len, it is cached as None and not re-probed."""
        cid = "con_no_len_789"
        entry = {
            "internal_url": "host:7000/v1/chat/completions",
            "model_impl": MagicMock(hf_model_id="fallback-model"),
        }
        mock_cache = MagicMock()
        mock_cache._cache = {f":version:{cid}": b"dummy_data"}

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": [{"id": "engine-model"}]}  # No max_model_len!

        with patch("model_control.model_utils.caches", {"deploy_cache": mock_cache}), \
             patch("model_control.model_utils.update_deploy_cache"), \
             patch("model_control.model_utils.requests.get", return_value=mock_resp) as mock_get:

            with patch("model_control.model_utils.pickle.loads", return_value=dict(entry)):
                with patch.object(model_utils, "_last_deploy_cache_update", time.monotonic()):
                    # Call 1: probes, gets id but None max_model_len
                    res1 = model_utils.get_deploy_cache()
                    assert mock_get.call_count == 1
                    assert res1[cid]["cached_model_name"] == "engine-model"
                    assert "max_model_len" in res1[cid]
                    assert res1[cid]["max_model_len"] is None

                    # Simulate cache.set persisting the dict with max_model_len=None
                    with patch("model_control.model_utils.pickle.loads", return_value=dict(res1[cid])):
                        # Call 2: max_model_len is in entry (as None), so 0 additional HTTP calls!
                        res2 = model_utils.get_deploy_cache()
                        assert mock_get.call_count == 1

    def test_get_deploy_cache_records_cooldown_on_empty_data(self):
        """When /v1/models returns 200 with data=[], cooldown is triggered."""
        cid = "con_empty_data_101"
        entry = {
            "internal_url": "host:7000/v1/chat/completions",
            "model_impl": MagicMock(hf_model_id="fallback-model"),
        }
        mock_cache = MagicMock()
        mock_cache._cache = {f":version:{cid}": b"dummy_data"}

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": []}

        with patch("model_control.model_utils.caches", {"deploy_cache": mock_cache}), \
             patch("model_control.model_utils.update_deploy_cache"), \
             patch("model_control.model_utils.requests.get", return_value=mock_resp) as mock_get:

            with patch("model_control.model_utils.pickle.loads", return_value=dict(entry)):
                with patch.object(model_utils, "_last_deploy_cache_update", time.monotonic()):
                    res1 = model_utils.get_deploy_cache()
                    assert mock_get.call_count == 1
                    assert model_utils.is_probe_in_cooldown(cid)
                    assert res1[cid]["cached_model_name"] == "fallback-model"

                    # Call 2: in cooldown -> 0 additional calls!
                    res2 = model_utils.get_deploy_cache()
                    assert mock_get.call_count == 1

    def test_try_start_probe_lifecycle(self):
        """try_start_probe atomically claims in-flight status and respects cooldown."""
        cid = "con_claim_test"
        assert model_utils.try_start_probe(cid)
        # Second attempt while in flight returns False
        assert not model_utils.try_start_probe(cid)

        # Release and record failure
        model_utils.record_probe_failure(cid)
        assert not model_utils.is_probe_in_flight(cid)
        assert model_utils.is_probe_in_cooldown(cid)
        # Attempt while in cooldown returns False
        assert not model_utils.try_start_probe(cid)

    def test_single_flight_deduplicates_concurrent_probes(self):
        """When two calls to get_deploy_cache happen simultaneously for the same unprobed container, only one HTTP call is made."""
        import threading
        cid = "con_concurrent_1"
        entry = {
            "internal_url": "host:7000/v1/chat/completions",
            "model_impl": MagicMock(hf_model_id="fallback-model"),
        }
        mock_cache = MagicMock()
        mock_cache._cache = {f":version:{cid}": b"dummy_data"}

        probe_started = threading.Event()
        probe_may_finish = threading.Event()

        def slow_get(*args, **kwargs):
            probe_started.set()
            probe_may_finish.wait(timeout=2.0)
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"data": [{"id": "model-1", "max_model_len": 4096}]}
            return mock_resp

        with patch("model_control.model_utils.caches", {"deploy_cache": mock_cache}), \
             patch("model_control.model_utils.update_deploy_cache"), \
             patch("model_control.model_utils.requests.get", side_effect=slow_get) as mock_get, \
             patch("model_control.model_utils.pickle.loads", return_value=dict(entry)), \
             patch.object(model_utils, "_last_deploy_cache_update", time.monotonic()):

            # Thread 1 starts probe
            t1 = threading.Thread(target=model_utils.get_deploy_cache)
            t1.start()
            probe_started.wait(timeout=2.0)

            # Thread 2 calls get_deploy_cache while Thread 1 is in-flight
            res2 = model_utils.get_deploy_cache()
            # Thread 2 should return immediately with fallback, without making an additional HTTP call
            assert res2[cid]["cached_model_name"] == "fallback-model"

            # Let Thread 1 finish
            probe_may_finish.set()
            t1.join()

            # Exactly 1 HTTP probe was made across both threads!
            assert mock_get.call_count == 1


class TestInferenceSerializerValidation:
    """Test that InferenceSerializer does not trigger synchronous get_deploy_cache when context provides it."""

    def test_serializer_uses_context_deploy_cache_without_calling_get_deploy_cache(self):
        from model_control.serializers import InferenceSerializer

        mock_cache = {"valid_deploy_1": {"name": "test_model"}}
        with patch("model_control.serializers.get_deploy_cache") as mock_get_cache:
            serializer = InferenceSerializer(
                data={"deploy_id": "valid_deploy_1"},
                context={"deploy_cache": mock_cache},
            )
            assert serializer.is_valid()
            mock_get_cache.assert_not_called()

    def test_serializer_falls_back_to_get_deploy_cache_when_context_missing(self):
        from model_control.serializers import InferenceSerializer

        mock_cache = {"valid_deploy_2": {"name": "test_model"}}
        with patch("model_control.serializers.get_deploy_cache", return_value=mock_cache) as mock_get_cache:
            serializer = InferenceSerializer(data={"deploy_id": "valid_deploy_2"})
            assert serializer.is_valid()
            mock_get_cache.assert_called_once()


class TestWorkflowHandlers:
    """Test that workflow node handlers offload blocking calls."""

    def test_handle_llm_offloads_get_deploy_cache(self):
        from workflow_control.handlers import handle_llm

        async def run():
            with patch("workflow_control.handlers.asyncio.to_thread", new_callable=AsyncMock) as mock_to_thread:
                mock_to_thread.return_value = {}
                gen = handle_llm("node_1", {}, {}, "run_1")
                events = [e async for e in gen]
                mock_to_thread.assert_called_once()
                from model_control.model_utils import get_deploy_cache
                assert mock_to_thread.call_args[0][0] == get_deploy_cache
                assert any(e.get("event") == "node_error" for e in events)

        asyncio.run(run())


def _make_locmem_cache(name: str) -> LocMemCache:
    """Create a fresh isolated Django LocMemCache matching deploy_cache settings."""
    cache = LocMemCache(name, {"KEY_PREFIX": "", "VERSION": "version"})
    cache.clear()
    return cache


def _make_blocking_probe(model_id: str, max_model_len: int):
    """Return (probe_started, probe_may_finish, side_effect) to pause requests.get mid-flight."""
    probe_started = threading.Event()
    probe_may_finish = threading.Event()

    def slow_get(*args, **kwargs):
        probe_started.set()
        probe_may_finish.wait(timeout=2.0)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [{"id": model_id, "max_model_len": max_model_len}]
        }
        return mock_resp

    return probe_started, probe_may_finish, slow_get


class TestDeployCacheConcurrency:
    """Thread-safety tests using a real Django LocMemCache instance."""

    def setup_method(self):
        model_utils._probe_failures.clear()
        model_utils._active_probes.clear()

    def teardown_method(self):
        model_utils._probe_failures.clear()
        model_utils._active_probes.clear()

    def test_concurrent_reads_gets_and_refreshes_do_not_raise_runtime_error(self):
        """Concurrent get_deploy_cache, cache.get (move_to_end), and update_deploy_cache never raise."""
        real_cache = _make_locmem_cache("test_concurrency_iter")
        impl = SimpleNamespace(hf_model_id="fallback-model")

        def make_canonical(count: int) -> dict:
            return {
                f"con_{i}": {
                    "name": f"model-{i}",
                    "source": "managed",
                    "internal_url": f"host-{i}:7000/v1/chat/completions",
                    "model_impl": impl,
                    "max_model_len": 4096,
                    "cached_model_name": f"m-{i}",
                }
                for i in range(count)
            }

        with patch("model_control.model_utils.caches", {"deploy_cache": real_cache}), \
             patch("docker_control.docker_utils.caches", {"deploy_cache": real_cache}), \
             patch.object(model_utils, "_last_deploy_cache_update", time.monotonic() + 60.0):
            docker_utils.update_deploy_cache(canonical=make_canonical(6))

            errors = []

            def run_readers():
                try:
                    for _ in range(80):
                        res = model_utils.get_deploy_cache()
                        assert isinstance(res, dict)
                except Exception as exc:
                    errors.append(exc)

            def run_cache_gets():
                try:
                    for i in range(120):
                        real_cache.get(f"con_{i % 6}")
                except Exception as exc:
                    errors.append(exc)

            def run_refreshes():
                try:
                    for i in range(60):
                        count = 6 if i % 2 == 0 else 4
                        docker_utils.update_deploy_cache(canonical=make_canonical(count))
                except Exception as exc:
                    errors.append(exc)

            threads = [
                threading.Thread(target=run_readers),
                threading.Thread(target=run_readers),
                threading.Thread(target=run_cache_gets),
                threading.Thread(target=run_refreshes),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=5.0)
                assert not t.is_alive(), f"Thread {t.name} timed out (possible deadlock)"

            assert errors == []

    def test_probe_result_survives_overlapping_update_deploy_cache(self):
        """A concurrent refresh does not overwrite fresh probe metadata, and stale probe writes keep newer canonical fields."""
        real_cache = _make_locmem_cache("test_concurrency_probe_merge")
        cid = "con_merge_1"
        impl = SimpleNamespace(hf_model_id="fallback-model")

        def make_entry(health: str) -> dict:
            return {
                "name": "llama-test",
                "source": "managed",
                "internal_url": "host:7000/v1/chat/completions",
                "model_impl": impl,
                "health": health,
            }

        probe_started, probe_may_finish, slow_get = _make_blocking_probe("engine-model", 8192)

        with patch("model_control.model_utils.caches", {"deploy_cache": real_cache}), \
             patch("docker_control.docker_utils.caches", {"deploy_cache": real_cache}), \
             patch("model_control.model_utils.requests.get", side_effect=slow_get), \
             patch.object(model_utils, "_last_deploy_cache_update", time.monotonic() + 60.0):
            docker_utils.update_deploy_cache(canonical={cid: make_entry("starting")})

            t_probe = threading.Thread(target=model_utils.get_deploy_cache)
            t_probe.start()
            assert probe_started.wait(timeout=2.0)

            # Refresh runs while /v1/models HTTP request is in flight
            docker_utils.update_deploy_cache(canonical={cid: make_entry("healthy")})

            probe_may_finish.set()
            t_probe.join(timeout=2.0)
            assert not t_probe.is_alive()

            # Subsequent refresh preserves probed fields too
            docker_utils.update_deploy_cache(canonical={cid: make_entry("healthy-v2")})

            stored = real_cache.get(cid)
            assert stored is not None
            assert stored["max_model_len"] == 8192
            assert stored["cached_model_name"] == "engine-model"
            assert stored["health"] == "healthy-v2"

    def test_stopped_container_is_not_resurrected_by_late_probe(self):
        """If update_deploy_cache deletes a stopped container mid-probe, late probe completion does not re-add it."""
        real_cache = _make_locmem_cache("test_concurrency_no_zombie")
        cid = "con_zombie_1"
        impl = SimpleNamespace(hf_model_id="fallback-model")
        canonical = {
            cid: {
                "name": "stopping-model",
                "source": "managed",
                "internal_url": "host:7000/v1/chat/completions",
                "model_impl": impl,
            }
        }

        probe_started, probe_may_finish, slow_get = _make_blocking_probe("engine-model", 4096)

        with patch("model_control.model_utils.caches", {"deploy_cache": real_cache}), \
             patch("docker_control.docker_utils.caches", {"deploy_cache": real_cache}), \
             patch("model_control.model_utils.requests.get", side_effect=slow_get), \
             patch.object(model_utils, "_last_deploy_cache_update", time.monotonic() + 60.0):
            docker_utils.update_deploy_cache(canonical=canonical)

            t_probe = threading.Thread(target=model_utils.get_deploy_cache)
            t_probe.start()
            assert probe_started.wait(timeout=2.0)

            # Container stops and gets evicted while HTTP probe is still blocked
            docker_utils.update_deploy_cache(canonical={})
            assert real_cache.get(cid) is None

            probe_may_finish.set()
            t_probe.join(timeout=2.0)
            assert not t_probe.is_alive()

            assert real_cache.get(cid) is None




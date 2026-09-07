# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for run-lock queueing (_acquire_run_lock).

run_main() mutates process globals, so deploys execute one at a time. Submitting
several at once is supported though — the Voice Agent fires LLM + Whisper + TTS
together — so a waiting job must queue rather than be refused.

Regression guard: a previous revision refused concurrent /run with 409
deploy_in_flight, which forced the Voice Agent to deploy sequentially. It must also
stay visible while queued, because an unreported wait sits at 0% and gets flagged
"stalled" after 120s, which is indistinguishable from a hung deploy.
"""

import threading
import time

import pytest


@pytest.fixture()
def api():
    module = pytest.importorskip(
        "api", reason="requires the tt-inference-server artifact on sys.path"
    )
    # Poll fast so the tests don't spend real seconds waiting.
    original = module._RUN_LOCK_POLL_SECONDS
    module._RUN_LOCK_POLL_SECONDS = 0.05
    yield module
    module._RUN_LOCK_POLL_SECONDS = original
    # Replace the lock outright: a test failing mid-way leaves a waiter thread blocked
    # in _acquire_run_lock, which would grab the old lock the instant teardown released
    # it and hang every later test. A leaked waiter polls the discarded lock instead.
    module._run_main_lock = threading.Lock()
    module._active_run_job_id = None
    module._cancelled_jobs.discard("job_queued")
    module._cancelled_jobs.discard("job_cancelled")


def _seed(api, job_id):
    with api.progress_lock:
        api.progress_store[job_id] = {
            "status": "starting", "stage": "initialization",
            "progress": 0, "message": "", "last_updated": 0.0,
        }


def test_waits_for_the_holder_instead_of_failing(api):
    """A second deploy queues and proceeds once the first finishes."""
    _seed(api, "job_queued")
    api._run_main_lock.acquire()
    api._active_run_job_id = "job_ahead"

    acquired = threading.Event()
    error: list[BaseException] = []

    def waiter():
        try:
            api._acquire_run_lock("job_queued")
            acquired.set()
        except BaseException as exc:  # noqa: BLE001 - surfaced via assertion below
            error.append(exc)

    t = threading.Thread(target=waiter, daemon=True)
    t.start()
    time.sleep(0.3)

    assert not acquired.is_set(), "should still be queued while the holder runs"
    assert api.progress_store["job_queued"]["waiting_for_job_id"] == "job_ahead"

    api._active_run_job_id = None
    api._run_main_lock.release()
    t.join(timeout=5)

    assert not error, f"queued job raised instead of proceeding: {error}"
    assert acquired.is_set(), "queued job never acquired the lock"
    api._run_main_lock.release()


def test_cancelling_a_queued_job_stops_it(api):
    """A cancelled waiter must not go on to start a container."""
    _seed(api, "job_cancelled")
    api._run_main_lock.acquire()
    api._cancelled_jobs.add("job_cancelled")
    try:
        with pytest.raises(RuntimeError, match="cancelled"):
            api._acquire_run_lock("job_cancelled")
    finally:
        api._run_main_lock.release()


def test_gives_up_if_the_holder_never_finishes(api, monkeypatch):
    """A wedged holder must not strand waiters forever."""
    _seed(api, "job_queued")
    monkeypatch.setattr(api, "_RUN_LOCK_MAX_WAIT_SECONDS", 0.1)
    api._run_main_lock.acquire()
    try:
        with pytest.raises(RuntimeError, match="gave up"):
            api._acquire_run_lock("job_queued")
    finally:
        api._run_main_lock.release()


def test_waiting_does_not_clobber_a_queued_job_s_own_progress(api):
    """A queued job keeps showing its real progress while it waits.

    Its image pull and weights monitor publish to progress_store before the lock is
    acquired, which is how Whisper and TTS show live numeric progress behind the LLM.
    A previous revision overwrote status/stage/progress/message on every poll with a
    "queued" placeholder, replacing that with "Waiting for <job id> to finish".
    """
    _seed(api, "job_queued")
    with api.progress_lock:
        api.progress_store["job_queued"].update({
            "status": "running", "stage": "pulling_image", "progress": 63,
            "message": "Pulling Docker Image... (4/7 layers)",
            "downloaded_bytes": 1234, "total_bytes": 5678,
        })
    api._run_main_lock.acquire()
    api._active_run_job_id = "job_ahead"

    done = threading.Event()
    threading.Thread(
        target=lambda: (api._acquire_run_lock("job_queued"), done.set()), daemon=True
    ).start()
    time.sleep(0.3)

    snap = dict(api.progress_store["job_queued"])
    assert snap["stage"] == "pulling_image", "real stage must survive the wait"
    assert snap["progress"] == 63, "real percentage must survive the wait"
    assert snap["message"] == "Pulling Docker Image... (4/7 layers)"
    assert snap["downloaded_bytes"] == 1234 and snap["total_bytes"] == 5678
    assert snap["waiting_for_job_id"] == "job_ahead"

    api._active_run_job_id = None
    api._run_main_lock.release()
    done.wait(timeout=5)
    api._run_main_lock.release()

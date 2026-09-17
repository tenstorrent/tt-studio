# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for _ThroughputWindow, the weights-monitor speed estimate.

With Hugging Face Xet transfer enabled, hf_xet materialises each file in multi-GB
bursts separated by 10-20 s plateaus. The previous per-poll EMA of instantaneous
rates weighted a 1 s burst poll the same as a 1 s plateau poll (and skipped the
plateaus as "stagnant"), so it displayed 220-500 MB/s against 123 MB/s measured on
the NIC. The window estimator is bytes over elapsed time, which is immune to that.
"""

import pytest


def _window(**kwargs):
    api = pytest.importorskip(
        "api", reason="requires the tt-inference-server artifact on sys.path"
    )
    return api._ThroughputWindow(**kwargs)


MB = 1_000_000

# Real 1 Hz trace captured on the QB2 test box (gigabit link) during a FLUX.1-schnell
# host download with Xet on: (seconds, bytes in the per-repo blobs dir, NIC MB/s).
REAL_XET_TRACE = [
    (0, 47123080840, 123),
    (1, 47123080840, 123),
    (2, 47123080840, 119),
    (3, 48959203215, 122),
    (4, 48959203215, 125),
    (5, 49227375544, 125),
    (6, 49227375544, 125),
    (7, 49337502194, 125),
    (8, 49337502194, 125),
    (9, 49337502194, 125),
    (10, 49337502194, 125),
    (11, 49337502194, 125),
    (12, 49337502194, 125),
    (13, 49620520780, 125),
    (14, 49620520780, 125),
    (15, 49620520780, 125),
    (16, 49620520780, 125),
    (17, 49620520780, 124),
    (18, 49620520780, 125),
    (19, 49620520780, 123),
    (20, 49620520780, 122),
    (21, 50207732897, 91),
    (22, 50475986637, 125),
    (23, 50543035417, 125),
    (24, 50543035417, 125),
    (25, 50543035417, 125),
    (26, 50543035417, 116),
    (27, 50921908778, 119),
    (28, 52208949418, 123),
    (29, 52208949418, 125),
    (30, 52208949418, 125),
    (31, 52208949418, 125),
    (32, 52208949418, 125),
    (33, 52275973578, 125),
    (34, 52275973578, 125),
    (35, 52275973578, 125),
    (36, 52275973578, 125),
    (37, 52275973578, 124),
    (38, 52275973578, 124),
    (39, 53018756859, 123),
]


class TestThroughputWindow:
    def test_no_estimate_before_min_span(self):
        w = _window(min_span_seconds=5.0)
        assert w.update(0.0, 0) is None
        assert w.update(4.0, 400 * MB) is None
        assert w.update(5.0, 500 * MB) == pytest.approx(100 * MB)

    def test_steady_stream_is_exact(self):
        w = _window()
        est = None
        for t in range(0, 91):
            est = w.update(float(t), t * 120 * MB)
        assert est == pytest.approx(120 * MB)

    def test_bursty_writes_average_to_the_wire_rate(self):
        """2.4 GB lands every 20 s (120 MB/s on the wire), sampled at 1 Hz. Every
        estimate after the first burst window stays within the bounds a user would
        read as "about 120 MB/s"; the old EMA reported ~2.4 GB/s bursts blended
        into several hundred MB/s here."""
        w = _window(window_seconds=60.0)
        estimates = {}
        downloaded = 0
        for t in range(0, 181):
            if t > 0 and t % 20 == 0:
                downloaded += 2400 * MB
            est = w.update(float(t), downloaded)
            if est is not None:
                estimates[t] = est
        steady = [estimates[t] for t in range(60, 181)]
        assert min(steady) >= 75 * MB
        assert max(steady) <= 165 * MB
        assert sum(steady) / len(steady) == pytest.approx(120 * MB, rel=0.10)

    def test_stall_decays_to_zero_within_window(self):
        w = _window(window_seconds=60.0)
        for t in range(0, 31):
            w.update(float(t), t * 100 * MB)
        est_at_stall = w.update(31.0, 3000 * MB)
        assert est_at_stall > 90 * MB
        for t in range(32, 92):
            est = w.update(float(t), 3000 * MB)
        assert est == 0.0

    def test_transient_dip_never_goes_negative(self):
        """huggingface_hub renames a finished blob a moment before it drops the
        symlink in, so the count can dip for one poll."""
        w = _window(min_span_seconds=1.0)
        w.update(0.0, 10_000 * MB)
        assert w.update(1.0, 0) == 0.0
        assert w.update(2.0, 10_000 * MB) == pytest.approx(0.0)

    def test_window_slides(self):
        w = _window(window_seconds=10.0, min_span_seconds=1.0)
        for t in range(0, 11):
            w.update(float(t), t * 100 * MB)  # 100 MB/s for 10 s
        for t in range(11, 31):
            est = w.update(float(t), 1000 * MB + (t - 10) * 10 * MB)  # then 10 MB/s
        # 20 s later the fast phase has left the window entirely.
        assert est == pytest.approx(10 * MB, rel=0.05)

    def test_real_xet_trace_tracks_nic_rate(self):
        w = _window()
        nic_mean = sum(nic for _, _, nic in REAL_XET_TRACE) / len(REAL_XET_TRACE)
        late = []
        for t, downloaded, _nic in REAL_XET_TRACE:
            est = w.update(float(t), downloaded)
            if est is not None and t >= 20:
                late.append(est / MB)
        assert late, "trace must yield estimates"
        # Every estimate in the second half of the trace is within 2x of the wire
        # rate, and the final figure is within 35% of it (the old EMA read 220-310
        # MB/s over this same window).
        assert max(late) <= 2 * nic_mean
        assert late[-1] == pytest.approx(nic_mean, rel=0.35)

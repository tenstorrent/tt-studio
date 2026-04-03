# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
#
# Metrics measurement approach adapted from the vLLM project (Apache-2.0):
# https://github.com/vllm-project/vllm/blob/main/vllm/benchmarks/lib/endpoint_request_func.py
# SPDX-FileCopyrightText: Copyright contributors to the vLLM project

"""
Backend Metrics Tracker for Inference Performance

Accurate metrics calculation following vLLM's measurement approach:
- TTFT (Time to First Token): time from request start to first content chunk
- ITL (Inter-Token Latency): list of intervals between consecutive content chunks
- TPOT (Time Per Output Token): mean of ITL
- Token counting and timing
"""

import time
from typing import Optional, Dict, List


class InferenceMetricsTracker:
    """Track inference metrics during streaming, following vLLM's measurement approach."""

    def __init__(self):
        self.start_time: float = time.perf_counter()
        self.first_token_time: Optional[float] = None
        self.most_recent_token_time: Optional[float] = None  # vLLM-style: advances per content chunk
        self.itl: List[float] = []          # inter-token latency list (seconds) — vLLM style
        self.token_times: List[float] = []  # kept for backwards compat / detailed stats
        self.num_tokens: int = 0
        self.prompt_tokens: int = 0
        self.last_token_count: int = 0

    def record_content_token(self) -> None:
        """Record arrival of a content chunk, tracking ITL exactly as vLLM does."""
        current_time = time.perf_counter()
        if self.first_token_time is None:
            self.first_token_time = current_time
        else:
            self.itl.append(current_time - self.most_recent_token_time)
        self.most_recent_token_time = current_time
        self.token_times.append(current_time)
        self.num_tokens += 1
        self.last_token_count = self.num_tokens

    def set_prompt_tokens(self, prompt_tokens: int) -> None:
        """Set prompt token count from usage data"""
        if self.prompt_tokens == 0:
            self.prompt_tokens = prompt_tokens

    def record_token(self, completion_tokens: int, prompt_tokens: int = 0) -> None:
        """
        Record token arrival from usage data (cloud path).

        Args:
            completion_tokens: Current completion token count
            prompt_tokens: Number of prompt tokens (captured once)
        """
        current_time = time.perf_counter()

        # Record first token
        if completion_tokens == 1 and self.first_token_time is None:
            self.first_token_time = current_time
            self.prompt_tokens = prompt_tokens
            self.token_times.append(current_time)
            self.num_tokens = 1
            self.last_token_count = 1

        # Record subsequent tokens
        elif completion_tokens > self.last_token_count:
            # Handle batch arrivals (e.g., token count jumps from 5 to 10)
            tokens_arrived = completion_tokens - self.last_token_count
            for _ in range(tokens_arrived):
                self.token_times.append(current_time)

            self.num_tokens = completion_tokens
            self.last_token_count = completion_tokens

    def get_ttft(self) -> float:
        """Time to first content chunk, in seconds. Returns 0 if no tokens received."""
        if self.first_token_time is None:
            return 0.0
        return self.first_token_time - self.start_time

    def get_tpot(self) -> float:
        """
        Calculate Time Per Output Token as mean of ITL — matches vLLM's approach.

        Returns:
            Mean inter-token latency in seconds, or 0 if insufficient data
        """
        if not self.itl:
            return 0.0
        return sum(self.itl) / len(self.itl)

    def get_accurate_tpot(self) -> float:
        """Median of ITL — more robust to outliers than the mean."""
        if not self.itl:
            return 0.0
        sorted_itl = sorted(self.itl)
        mid = len(sorted_itl) // 2
        if len(sorted_itl) % 2 == 0:
            return (sorted_itl[mid - 1] + sorted_itl[mid]) / 2
        return sorted_itl[mid]

    def get_stats(self) -> Dict:
        """Get final statistics in vLLM-compatible format."""
        return {
            "ttft": self.get_ttft(),
            "tpot": self.get_tpot(),
            "itl": self.itl,              # list of inter-token latencies in seconds
            "tokens_decoded": self.num_tokens,
            "tokens_prefilled": self.prompt_tokens,
            "context_length": self.prompt_tokens + self.num_tokens,
            "total_time": time.perf_counter() - self.start_time,
        }

    def get_detailed_stats(self) -> Dict:
        """Get detailed statistics with ITL percentiles."""
        basic_stats = self.get_stats()

        if self.itl:
            sorted_itl = sorted(self.itl)
            n = len(sorted_itl)
            return {
                **basic_stats,
                "tpot_median": sorted_itl[n // 2],
                "tpot_p95": sorted_itl[int(n * 0.95)],
                "tpot_p99": sorted_itl[int(n * 0.99)],
                "tpot_min": sorted_itl[0],
                "tpot_max": sorted_itl[-1],
            }

        return basic_stats

# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Backend Metrics Tracker for Inference Performance

Clean, accurate metrics calculation for:
- TTFT (Time to First Token)
- TPOT (Time Per Output Token)
- Token counting and timing
"""

import time
from typing import Optional, Dict, List


class InferenceMetricsTracker:
    """Track inference metrics during streaming"""

    def __init__(self):
        self.start_time: float = time.time()
        self.first_token_time: Optional[float] = None
        self.token_times: List[float] = []  # Timestamp of each token arrival
        self.num_tokens: int = 0
        self.prompt_tokens: int = 0
        self.last_token_count: int = 0

    def record_token(self, completion_tokens: int, prompt_tokens: int = 0) -> None:
        """
        Record token arrival from usage data

        Args:
            completion_tokens: Current completion token count
            prompt_tokens: Number of prompt tokens (captured once)
        """
        current_time = time.time()

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
        """
        Calculate Time to First Token

        Returns:
            TTFT in seconds, or 0 if no tokens received
        """
        if self.first_token_time is None:
            return 0.0
        return self.first_token_time - self.start_time

    def get_tpot(self) -> float:
        """
        Calculate Time Per Output Token (average)

        This is the average time between token arrivals.
        Formula: (total_time - ttft) / (num_tokens - 1)

        Returns:
            Average TPOT in seconds, or 0 if insufficient data
        """
        if len(self.token_times) < 2:
            return 0.0

        # Time from first token to last token
        total_generation_time = self.token_times[-1] - self.token_times[0]

        # Average across all tokens (excluding first)
        num_intervals = len(self.token_times) - 1
        if num_intervals == 0:
            return 0.0

        return total_generation_time / num_intervals

    def get_accurate_tpot(self) -> float:
        """
        Calculate TPOT using inter-token intervals (more accurate)

        This calculates the median of all inter-token intervals,
        which is more robust to outliers than a simple average.

        Returns:
            Median TPOT in seconds, or 0 if insufficient data
        """
        if len(self.token_times) < 2:
            return 0.0

        # Calculate intervals between consecutive tokens
        intervals = []
        for i in range(1, len(self.token_times)):
            interval = self.token_times[i] - self.token_times[i-1]
            # Only count non-zero intervals (filter out batch arrivals)
            if interval > 0:
                intervals.append(interval)

        if not intervals:
            return 0.0

        # Return median interval
        intervals.sort()
        mid = len(intervals) // 2
        if len(intervals) % 2 == 0:
            return (intervals[mid-1] + intervals[mid]) / 2
        return intervals[mid]

    def get_stats(self) -> Dict[str, float]:
        """
        Get final statistics

        Returns:
            Dictionary with all metrics
        """
        return {
            "ttft": self.get_ttft(),
            "tpot": self.get_tpot(),
            "tokens_decoded": self.num_tokens,
            "tokens_prefilled": self.prompt_tokens,
            "context_length": self.prompt_tokens + self.num_tokens,
            "total_time": time.time() - self.start_time,
        }

    def get_detailed_stats(self) -> Dict:
        """
        Get detailed statistics including per-token timing

        Returns:
            Dictionary with detailed metrics
        """
        basic_stats = self.get_stats()

        # Calculate inter-token intervals
        intervals = []
        if len(self.token_times) > 1:
            for i in range(1, len(self.token_times)):
                interval = self.token_times[i] - self.token_times[i-1]
                if interval > 0:
                    intervals.append(interval)

        # Calculate percentiles if we have data
        if intervals:
            intervals.sort()
            n = len(intervals)
            detailed_stats = {
                **basic_stats,
                "tpot_median": intervals[n // 2] if n > 0 else 0,
                "tpot_p95": intervals[int(n * 0.95)] if n > 0 else 0,
                "tpot_p99": intervals[int(n * 0.99)] if n > 0 else 0,
                "tpot_min": min(intervals) if intervals else 0,
                "tpot_max": max(intervals) if intervals else 0,
            }
        else:
            detailed_stats = basic_stats

        return detailed_stats

# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for reading a model server's health response.

tt-dit apps answer 200 on /health while their pipeline is still warming, and say so in
the body; reporting them healthy would send the user to a page that 503s for minutes.
"""

from unittest import TestCase
from unittest.mock import MagicMock, patch

from model_control.model_utils import health_check


def _check(status_code, body):
    response = MagicMock(status_code=status_code, content=b"x")
    response.json.return_value = body
    with patch("model_control.model_utils.requests.get", return_value=response):
        return health_check("http://model:7000/health", json_data=None)


class HealthCheckTests(TestCase):
    def test_a_plain_200_is_healthy(self):
        self.assertIs(_check(200, {})[0], True)

    def test_a_ready_body_is_healthy(self):
        # FLUX.2's server once warm, and Qwen-Image's.
        self.assertIs(_check(200, {"status": "ready", "ready": True})[0], True)
        self.assertIs(_check(200, {"status": "ok"})[0], True)

    def test_a_warming_body_is_starting(self):
        self.assertIsNone(_check(200, {"status": "loading"})[0])
        self.assertIsNone(_check(200, {"status": "initializing", "ready": False})[0])

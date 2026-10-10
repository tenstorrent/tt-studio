# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for loading community_overrides.toml.

The loader refuses an entry it would otherwise have to guess its way past: a typo
there silently changes which page drives a model, or hides one nobody meant to.
"""

import tempfile
import textwrap
import unittest
from pathlib import Path

from shared_config.community_overrides import CommunityOverrides
from shared_config.model_overrides import OverridesError
from shared_config.model_type_config import ModelTypes

SERVABLE = (ModelTypes.CHAT, ModelTypes.IMAGE_GENERATION)


def _load(body: str) -> CommunityOverrides:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "community_overrides.toml"
        path.write_text("schema_version = 1\n" + textwrap.dedent(body))
        return CommunityOverrides(servable=SERVABLE, path=path)


class ShippedFileTests(unittest.TestCase):
    def test_the_shipped_file_loads(self):
        # Loaded exactly as the app loads it, with the types it has routes for.
        from shared_config.community_model_config import OVERRIDES as overrides

        self.assertEqual(overrides.engines["vllm-plugin"].serve_as, ModelTypes.CHAT)
        self.assertEqual(overrides.served_tasks["text-to-speech"], ModelTypes.TTS)
        self.assertIsNone(overrides.engines["tt-dit-server"].serve_as)
        self.assertEqual(
            overrides.served_tasks["text-to-image"], ModelTypes.IMAGE_GENERATION
        )


class ValidationTests(unittest.TestCase):
    def test_a_type_with_no_routes_is_refused(self):
        with self.assertRaisesRegex(OverridesError, "no community route defaults"):
            _load('[[task]]\ntask = "text-to-speech"\nserve_as = "tts"\n')

    def test_an_unknown_type_is_refused(self):
        with self.assertRaisesRegex(OverridesError, "unknown model type"):
            _load('[[engine]]\nkind = "x"\nserve_as = "chatt"\n')

    def test_a_task_without_a_page_must_say_why(self):
        with self.assertRaisesRegex(OverridesError, "missing details"):
            _load('[[task]]\ntask = "robotics"\n')

    def test_duplicates_are_refused(self):
        with self.assertRaisesRegex(OverridesError, "duplicate"):
            _load(
                '[[task]]\ntask = "a"\ndetails = "x"\n'
                '[[task]]\ntask = "a"\ndetails = "y"\n'
            )

    def test_an_unknown_reason_is_refused(self):
        with self.assertRaisesRegex(OverridesError, "unknown reason"):
            _load('[[unavailable]]\nrepo = "ns/b"\nreason = "flaky"\ndetails = "x"\n')

    def test_the_schema_version_is_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "o.toml"
            path.write_text("schema_version = 2\n")
            with self.assertRaisesRegex(OverridesError, "schema_version"):
                CommunityOverrides(servable=SERVABLE, path=path)


class UnavailableMarkTests(unittest.TestCase):
    def setUp(self):
        self.overrides = _load(
            """
            [[unavailable]]
            repo = "ns/broken"
            reason = "known_broken"
            details = "Dies on boot."

            [[unavailable]]
            repo = "ns/partial"
            profile = "p150"
            reason = "known_broken"
            details = "The single-chip mesh hangs."
            """
        )

    def test_a_bundle_wide_mark_covers_every_profile(self):
        self.assertEqual(
            self.overrides.unavailable_mark("ns/broken", "any")[0], "known_broken"
        )
        self.assertIsNotNone(self.overrides.unavailable_mark("ns/broken"))

    def test_a_profile_mark_covers_only_that_profile(self):
        self.assertIsNotNone(self.overrides.unavailable_mark("ns/partial", "p150"))
        self.assertIsNone(self.overrides.unavailable_mark("ns/partial", "p300"))
        self.assertIsNone(self.overrides.unavailable_mark("ns/partial"))

    def test_an_unmarked_bundle_is_offered(self):
        self.assertIsNone(self.overrides.unavailable_mark("ns/fine", "p150"))

# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for how a community bundle is described in the model list.

The listing decides two things the deploy UI cannot recover from: how many chips a
bundle needs, and whether it runs on this board at all. Getting either wrong either
hides a deployable model or offers a device configuration the deploy then refuses.
"""

from django.test import TestCase

from docker_control.views import _community_fit, _preferred_community_profile
from shared_config.community_model_config import devices_for_hardware

BOARD = "P300x2"
SLOTS = 4


def _profile(name, hardware, chips):
    return {"name": name, "hardware": hardware, "chips_required": chips}


class CommunityFitTests(TestCase):
    def _fit(self, hardware, chips, board=BOARD, slots=SLOTS):
        return _community_fit(devices_for_hardware(hardware), chips, board, slots)

    def test_a_single_chip_bundle_fits_a_multi_chip_board(self):
        self.assertIs(self._fit("p150", 1), True)

    def test_a_card_sized_bundle_fits_the_board_holding_that_card(self):
        self.assertIs(self._fit("p300", 2), True)

    def test_a_mesh_larger_than_the_board_never_fits(self):
        # The case a label-only check misses: p150x8 maps to a real device, just not
        # one that fits in four slots.
        self.assertIs(self._fit("p150x8", 8), False)

    def test_the_other_four_chip_blackhole_mesh_is_accepted(self):
        # Same equivalence the catalog grants a vLLM model; every community bundle
        # TT Studio serves is vLLM.
        self.assertIs(self._fit("p150x4", 4), True)

    def test_an_unknown_board_is_undecided(self):
        self.assertIsNone(self._fit("p150", 1, board="unknown"))

    def test_an_unrecognised_hardware_label_is_undecided(self):
        # Undecided, not incompatible: a label this build cannot map must not hide a
        # bundle that may well run.
        self.assertIsNone(self._fit("p150x2", 2))


class PreferredProfileTests(TestCase):
    def _pick(self, profiles, default):
        detail = {"profiles": profiles, "default_profile": default}
        return _preferred_community_profile(detail, BOARD, SLOTS)

    def test_the_authors_default_is_kept_when_it_fits(self):
        profiles = [_profile("p300x2", "p300x2", 4), _profile("p150", "p150", 1)]
        self.assertEqual(self._pick(profiles, "p300x2"), "p300x2")

    def test_a_fitting_profile_is_chosen_over_an_unusable_default(self):
        # The regression this guards: judging the row by its default alone marked the
        # whole bundle incompatible and hid it, despite a profile built for this board.
        profiles = [_profile("p150x8", "p150x8", 8), _profile("p300x2", "p300x2", 4)]
        self.assertEqual(self._pick(profiles, "p150x8"), "p300x2")

    def test_the_largest_fitting_mesh_wins(self):
        # Closest runnable thing to what the author recommended.
        profiles = [
            _profile("p150", "p150", 1),
            _profile("p300", "p300", 2),
            _profile("p150x8", "p150x8", 8),
        ]
        self.assertEqual(self._pick(profiles, "p150x8"), "p300")

    def test_an_undecided_profile_counts_as_runnable(self):
        profiles = [_profile("p150x8", "p150x8", 8), _profile("p150x2", "p150x2", 2)]
        self.assertEqual(self._pick(profiles, "p150x8"), "p150x2")

    def test_nothing_fitting_falls_back_to_the_default(self):
        # None leaves the caller on the default, so the row still reports a mesh and
        # still reads incompatible — which it is.
        profiles = [_profile("p150x8", "p150x8", 8)]
        self.assertIsNone(self._pick(profiles, "p150x8"))

    def test_no_profiles_at_all_is_handled(self):
        self.assertIsNone(self._pick([], "default"))

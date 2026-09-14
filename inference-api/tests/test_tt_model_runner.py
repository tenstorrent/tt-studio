# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the tt-model-manager bridge's chip accounting.

No tt_kernel and no docker. This is the calculation that decides how many chip slots
a community deployment reserves, and a wrong answer there either blocks the board or
lets a second model land on devices already in use.
"""

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import tt_model_runner as runner  # noqa: E402


@pytest.fixture
def fake_tt_kernel(monkeypatch):
    """Install a stub tt_kernel, which is absent from this venv by design.

    The runner reaches tt_kernel only through late imports, so stubbing the modules is
    enough to exercise the chip-count and device-pin paths without the artifact.
    """
    calls = {"picked": None, "ensured": None}

    container = types.SimpleNamespace(
        pick_free_devices=lambda count: calls.__setitem__("picked", count) or [0, 1][:count],
        ensure_devices_free=lambda ids: calls.__setitem__("ensured", list(ids)),
    )
    container_cli = types.SimpleNamespace(
        parse_device_id=lambda raw, *, chip_count, profile_name: (
            None if raw is None else [int(x) for x in raw.split(",")]
        )
    )
    manifest = types.ModuleType("tt_kernel.container_manifest")
    manifest.hardware_chip_count = lambda hardware: {"p150": 1, "p300": 2, "p300x2": 4}.get(
        hardware.strip().lower()
    )

    launchers = types.ModuleType("tt_kernel.launchers")
    launchers.KINDS = {"vllm-plugin": object(), "vllm-fork": object(), "tt-dit-server": object()}

    package = types.ModuleType("tt_kernel")
    package.container = container
    package.container_cli = container_cli
    monkeypatch.setitem(sys.modules, "tt_kernel", package)
    monkeypatch.setitem(sys.modules, "tt_kernel.container_manifest", manifest)
    monkeypatch.setitem(sys.modules, "tt_kernel.launchers", launchers)
    return calls


class TestTagReading:
    """Repo tags are the fallback description for a bundle whose manifest won't load.

    Both readers ask tt_kernel rather than carrying their own list of board names or
    engines, so a new board or launcher needs no change here.
    """

    TAGS = [
        "blackhole", "p300x2", "tt-model-cache", "tt-model-container",
        "vllm-plugin", "license:other", "region:us",
    ]

    def test_finds_the_board_among_the_noise(self, fake_tt_kernel):
        assert runner._hardware_from_tags(self.TAGS) == "p300x2"

    def test_finds_the_engine_among_the_noise(self, fake_tt_kernel):
        assert runner._kind_from_tags(self.TAGS) == "vllm-plugin"

    def test_an_unsupported_engine_is_still_named(self, fake_tt_kernel):
        # Naming it is what lets the listing drop it instead of offering an LLM that
        # cannot be served.
        assert runner._kind_from_tags(["blackhole", "tt-dit-server"]) == "tt-dit-server"

    def test_no_board_tag_reads_as_unknown(self, fake_tt_kernel):
        # Not as one chip: an untagged bundle must not look single-device.
        assert runner._hardware_from_tags(["blackhole", "vllm-plugin"]) is None

    def test_no_engine_tag_reads_as_unknown(self, fake_tt_kernel):
        assert runner._kind_from_tags(["blackhole", "p150"]) is None


class TestAnnotateFromManifests:
    """The manifest overrides the tags, because a repo carries only one hardware tag
    while a bundle may declare several profiles with different meshes."""

    def _rows(self):
        return [
            {"repo_id": "ns/tagged", "hardware": "p150x4", "chips_required": 4,
             "kind": "vllm-plugin", "supported": True, "profiles": []},
            {"repo_id": "ns/unreadable", "hardware": "p150", "chips_required": 1,
             "kind": "vllm-plugin", "supported": True, "profiles": []},
        ]

    def test_manifest_wins_over_a_disagreeing_tag(self, monkeypatch):
        detail = {
            "arch": "blackhole",
            "kind": "vllm-plugin",
            "supported": True,
            "weights_repo": "org/weights",
            "default_profile": "p300x2",
            "profiles": [{"name": "p300x2", "hardware": "p300x2", "chips_required": 4},
                         {"name": "p150x4", "hardware": "p150x4", "chips_required": 4}],
            "hardware": "p300x2",
            "chips_required": 4,
        }
        monkeypatch.setattr(
            runner, "_catalog_entry",
            lambda repo_id: detail if repo_id == "ns/tagged" else None,
        )
        rows = self._rows()
        runner._annotate_from_manifests(rows)
        assert rows[0]["hardware"] == "p300x2"
        assert rows[0]["default_profile"] == "p300x2"
        assert len(rows[0]["profiles"]) == 2

    def test_an_unreadable_manifest_leaves_the_tag_reading(self, monkeypatch):
        monkeypatch.setattr(runner, "_catalog_entry", lambda repo_id: None)
        rows = self._rows()
        runner._annotate_from_manifests(rows)
        assert rows[1]["hardware"] == "p150"
        assert rows[1]["chips_required"] == 1
        assert rows[1]["profiles"] == []


class TestChipsFor:
    def test_mesh_grid_wins_over_label(self):
        # A p300x2 bundle opens a (4, 1) mesh: four chips, whatever the label says.
        assert runner._chips_for("(4, 1)", "p300x2") == 4

    def test_mesh_label_form(self):
        assert runner._chips_for("P150x4", None) == 4

    def test_falls_back_to_hardware_label(self):
        assert runner._chips_for(None, "p150x4") == 4

    def test_single_chip_default(self):
        assert runner._chips_for(None, "p150") == 1

    def test_unparseable_never_reports_zero(self):
        # Zero would make the allocator reserve nothing at all.
        assert runner._chips_for("nonsense", None) == 1
        assert runner._chips_for(None, None) == 1

    def test_a_two_chip_board_label_is_not_read_as_one(self, fake_tt_kernel):
        # "p300" carries no xN multiplier but is two chips. Reading it as one would
        # under-size the pin, and tt_kernel then refuses the serve outright.
        assert runner._chips_for("P300", "p300") == 2

    def test_tt_kernel_is_preferred_over_the_local_fallback(self, fake_tt_kernel):
        assert runner._chips_for(None, "p300x2") == 4

    def test_an_unknown_label_still_falls_back(self, fake_tt_kernel):
        # hardware_chip_count returns None here, so the mesh grid decides.
        assert runner._chips_for("(4, 1)", "zz99") == 4


class TestResolveDeviceIds:
    def test_a_pin_is_validated_against_the_host(self, fake_tt_kernel):
        assert runner._resolve_device_ids("2,3", 2, "default") == [2, 3]
        # Checked for real rather than trusted: the chips must still be free.
        assert fake_tt_kernel["ensured"] == [2, 3]
        assert fake_tt_kernel["picked"] is None

    def test_no_pin_picks_the_lowest_free_chips(self, fake_tt_kernel):
        assert runner._resolve_device_ids(None, 1, "default") == [0]
        assert fake_tt_kernel["picked"] == 1
        assert fake_tt_kernel["ensured"] is None

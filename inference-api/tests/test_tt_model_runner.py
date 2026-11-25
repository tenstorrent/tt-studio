# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the tt-model-manager bridge's chip accounting.

No tt_kernel and no docker. This is the calculation that decides how many chip slots
a community deployment reserves, and a wrong answer there either blocks the board or
lets a second model land on devices already in use.
"""

import json
import os
import signal
import subprocess
import sys
import time
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
        ),
        ensure_weights=lambda manifest, target, **kw: calls.__setitem__("weights", target),
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


class TestVerifiedCatalog:
    """tt-cli's community_catalog.json is the whole community listing: nothing is
    discovered by Hub search until the Hub has a verification process."""

    ROWS = [
        {"repo": "ns/chat", "arch": "blackhole", "engine": "vllm-plugin",
         "hardware": ["p150", "p300x2"], "validated_on": "2026-09-25"},
        {"repo": "ns/image", "arch": "blackhole", "engine": "tt-dit-server",
         "hardware": ["p300x2"]},
        {"repo": "ns/wormhole", "arch": "wormhole", "engine": "vllm-plugin",
         "hardware": ["n300"]},
    ]

    @pytest.fixture
    def catalog(self, tmp_path):
        path = tmp_path / "community_catalog.json"
        path.write_text(json.dumps({"schema_version": 1, "bundles": self.ROWS}))
        return str(path)

    def test_filters_by_arch(self, catalog):
        rows = runner._verified_bundles(catalog, "blackhole", None, 100)
        assert [r["repo"] for r in rows] == ["ns/chat", "ns/image"]

    def test_query_matches_a_repo_substring(self, catalog):
        assert [r["repo"] for r in runner._verified_bundles(catalog, None, "IMA", 100)] == [
            "ns/image"
        ]

    def test_limit_caps_the_listing(self, catalog):
        assert len(runner._verified_bundles(catalog, None, None, 1)) == 1

    def test_an_unknown_schema_is_refused(self, tmp_path):
        path = tmp_path / "c.json"
        path.write_text(json.dumps({"schema_version": 2, "bundles": []}))
        with pytest.raises(ValueError):
            runner._verified_bundles(str(path), None, None, 100)

    def _catalog_rows(self, monkeypatch, fake_tt_kernel, path):
        localdb = types.SimpleNamespace(
            all_entries=lambda: [{"repo_id": "ns/chat", "arch": "blackhole", "profile": "p150"}]
        )
        sys.modules["tt_kernel"].localdb = localdb
        events = []
        monkeypatch.setattr(runner, "emit", lambda event, **f: events.append((event, f)))
        args = types.SimpleNamespace(catalog=path, arch="blackhole", query=None, limit=100)
        assert runner.cmd_catalog(args) == 0
        return events

    def test_rows_carry_the_verified_boards(self, monkeypatch, fake_tt_kernel, catalog):
        [(event, fields)] = self._catalog_rows(monkeypatch, fake_tt_kernel, catalog)
        assert event == "catalog"
        chat, image = fields["bundles"]
        assert chat["installed"] and chat["default_profile"] == "p150"
        assert chat["validated_hardware"] == ["p150", "p300x2"]
        # The smallest verified board stands in until the manifest is read.
        assert (chat["hardware"], chat["chips_required"]) == ("p150", 1)
        assert (image["kind"], image["supported"]) == ("tt-dit-server", True)

    def test_a_row_with_a_manifest_uses_it(self, monkeypatch, fake_tt_kernel, tmp_path):
        rows = [{**self.ROWS[0], "manifest": {"hardware": "p300x2", "chips_required": 4}}, self.ROWS[1]]
        path = tmp_path / "enriched.json"
        path.write_text(json.dumps({"schema_version": 1, "bundles": rows}))
        [(_, fields)] = self._catalog_rows(monkeypatch, fake_tt_kernel, str(path))
        chat, image = fields["bundles"]
        assert (chat["hardware"], chat["chips_required"]) == ("p300x2", 4)
        assert image["profiles"] == []

    def _enrich(self, monkeypatch, catalog, out, fetched, previous=None):
        monkeypatch.setattr(runner, "_fetch_manifests", lambda ids: fetched)
        events = []
        monkeypatch.setattr(runner, "emit", lambda event, **f: events.append((event, f)))
        args = types.SimpleNamespace(catalog=catalog, out=str(out), previous=previous)
        assert runner.cmd_enrich(args) == 0
        return {r["repo"]: r.get("manifest") for r in json.loads(out.read_text())["bundles"]}, events

    def test_enrich_attaches_each_manifest(self, monkeypatch, catalog, tmp_path):
        got, events = self._enrich(monkeypatch, catalog, tmp_path / "out.json", {"ns/chat": {"hardware": "p300x2"}})
        assert got["ns/chat"] == {"hardware": "p300x2"}
        assert got["ns/image"] is None
        assert events[-1][1] == {"total": 3, "fetched": 1, "stored": 1}

    def test_enrich_keeps_stored_manifests_when_the_hub_fails(self, monkeypatch, catalog, tmp_path):
        out = tmp_path / "out.json"
        bundled = tmp_path / "bundled.json"
        out.write_text(json.dumps({"schema_version": 1, "bundles": [{**self.ROWS[0], "manifest": {"v": "out"}}]}))
        bundled.write_text(json.dumps({"schema_version": 1, "bundles": [
            {**self.ROWS[0], "manifest": {"v": "bundled"}}, {**self.ROWS[1], "manifest": {"v": "bundled"}}]}))
        got, _ = self._enrich(monkeypatch, catalog, out, {}, previous=[str(bundled)])
        assert got["ns/chat"] == {"v": "out"}
        assert got["ns/image"] == {"v": "bundled"}

    def test_enriched_catalog_is_a_valid_catalog(self, monkeypatch, catalog, tmp_path):
        out = tmp_path / "out.json"
        self._enrich(monkeypatch, catalog, out, {"ns/chat": {"hardware": "p300x2"}})
        assert [r["repo"] for r in runner._verified_bundles(str(out), "blackhole", None, 100)] == ["ns/chat", "ns/image"]

    def test_a_missing_catalog_lists_nothing(self, monkeypatch, fake_tt_kernel, tmp_path):
        events = self._catalog_rows(monkeypatch, fake_tt_kernel, str(tmp_path / "nope.json"))
        assert [e for e, _ in events] == ["warning", "catalog"]
        assert events[-1][1]["bundles"] == []


class TestTask:
    """The Hub task that decides which page drives a tt-dit-server bundle."""

    @pytest.fixture
    def hub(self, monkeypatch):
        tags = {
            "ns/bundle": None,
            "org/weights": "text-to-image",
            "ns/tagged": "robotics",
        }
        asked = []

        def model_info(repo):
            asked.append(repo)
            if repo not in tags:
                raise RuntimeError("not found")
            return types.SimpleNamespace(pipeline_tag=tags[repo])

        module = types.ModuleType("huggingface_hub")
        module.HfApi = lambda: types.SimpleNamespace(model_info=model_info)
        monkeypatch.setitem(sys.modules, "huggingface_hub", module)
        return asked

    def test_vllm_bundles_need_no_lookup(self, hub):
        assert runner._task("vllm-plugin", "ns/bundle", "org/weights") is None
        assert hub == []

    def test_an_untagged_bundle_falls_back_to_its_weights(self, hub):
        task = runner._task("tt-dit-server", "ns/bundle", "org/weights")
        assert task == "text-to-image"

    def test_the_bundles_own_tag_wins(self, hub):
        assert runner._task("tt-dit-server", "ns/tagged", "org/weights") == "robotics"

    def test_an_unreachable_repo_is_skipped(self, hub):
        task = runner._task("tt-dit-server", "ns/missing", "org/weights")
        assert task == "text-to-image"
        assert runner._task("tt-dit-server", "ns/missing", None) is None


class TestFetchManifests:
    def test_unreadable_bundles_are_omitted(self, monkeypatch):
        monkeypatch.setattr(
            runner, "_catalog_entry",
            lambda repo_id: {"hardware": "p300x2"} if repo_id == "ns/tagged" else None,
        )
        assert runner._fetch_manifests(["ns/tagged", "ns/unreadable"]) == {"ns/tagged": {"hardware": "p300x2"}}


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


class TestEnsureWeights:
    """Weights are fetched by tt-model-manager; the runner only asks."""

    class _Manifest:
        def __init__(self, repo_id="org/weights"):
            self.weights = types.SimpleNamespace(repo_id=repo_id, revision=None)

    def test_delegates_to_tt_model_manager(self, fake_tt_kernel):
        runner._ensure_weights("ns/bundle", self._Manifest(), no_weights=False)
        assert fake_tt_kernel["weights"] == "ns/bundle"

    def test_a_bundle_with_no_weights_is_a_no_op(self, fake_tt_kernel):
        runner._ensure_weights("ns/bundle", types.SimpleNamespace(weights=None),
                               no_weights=False)
        assert "weights" not in fake_tt_kernel

    def test_no_weights_skips_the_fetch(self, fake_tt_kernel):
        runner._ensure_weights("ns/bundle", self._Manifest(), no_weights=True)
        assert "weights" not in fake_tt_kernel


class TestEnsureInstalled:
    """A reinstall must use the manifest of the snapshot it downloads."""

    @pytest.fixture
    def kernel(self, monkeypatch):
        state = {"loaded": set(), "pulled_with": None}
        hub_manifest = types.SimpleNamespace(image="tt-model/m:new")

        def pull_container(repo_id, revision, manifest, *, no_weights):
            state["pulled_with"] = manifest
            # Without skopeo, docker load keeps the tag the snapshot itself carries.
            state["loaded"].add(hub_manifest.image)

        container = types.SimpleNamespace(
            image_ref=lambda m: m.image,
            image_present=lambda ref: ref in state["loaded"],
        )
        container_cli = types.SimpleNamespace(
            pull_container=pull_container, load_pulled=lambda repo_id: state["pulled_with"]
        )
        hub = types.SimpleNamespace(fetch_manifest=lambda repo_id, revision: hub_manifest)
        package = types.ModuleType("tt_kernel")
        package.container, package.container_cli, package.hub = container, container_cli, hub
        monkeypatch.setitem(sys.modules, "tt_kernel", package)
        monkeypatch.setattr(runner, "emit", lambda event, **f: None)
        return state, hub_manifest

    def test_a_loaded_image_skips_the_install(self, kernel):
        state, _ = kernel
        state["loaded"].add("tt-model/m:old")
        installed = types.SimpleNamespace(image="tt-model/m:old")
        assert runner._ensure_installed("ns/m", installed, True, no_weights=False) is installed
        assert state["pulled_with"] is None

    def test_a_stale_record_is_replaced_by_the_hub_manifest(self, kernel):
        state, hub_manifest = kernel
        stale = types.SimpleNamespace(image="tt-model/m:old")
        assert runner._ensure_installed("ns/m", stale, True, no_weights=False) is hub_manifest
        assert state["pulled_with"] is hub_manifest

    def test_an_image_that_did_not_load_is_reported(self, kernel):
        state, _ = kernel
        fresh = types.SimpleNamespace(image="tt-model/m:other")
        with pytest.raises(RuntimeError, match="did not load its image tt-model/m:other"):
            runner._ensure_installed("ns/m", fresh, False, no_weights=False)


class TestHubErrorClassification:
    """Only a failure from talking to the Hub is reworded as one.

    ``classify_hub_error`` labels anything "the Hub request failed", which hid docker
    and device errors behind a dead end.
    """

    def _error_event(self, tmp_path, body):
        script = tmp_path / "boom.py"
        script.write_text(
            f"import sys\nsys.path.insert(0, {str(Path(runner.__file__).parent)!r})\n"
            "import tt_model_runner as runner\n"
            f"{body}\n"
            "sys.exit(runner.main(['inspect', 'ns/bundle']))\n"
        )
        done = subprocess.run([sys.executable, str(script)], capture_output=True, text=True)
        events = [json.loads(line) for line in done.stdout.splitlines() if line.strip()]
        return next(e for e in events if e["event"] == "error")

    def test_a_local_failure_keeps_its_wording(self, tmp_path):
        event = self._error_event(
            tmp_path,
            "runner.cmd_inspect = lambda args: (_ for _ in ()).throw("
            "RuntimeError('host is not ready: hugepages (absent)'))",
        )
        assert event["message"] == "host is not ready: hugepages (absent)"
        assert event["kind"] == "RuntimeError"

    @staticmethod
    def _hub_exception():
        return type("RepositoryNotFoundError", (Exception,),
                    {"__module__": "huggingface_hub.errors"})("404")

    def test_a_hub_exception_is_one(self):
        assert runner._is_hub_error(self._hub_exception())

    def test_a_wrapped_hub_exception_is_one(self):
        try:
            try:
                raise self._hub_exception()
            except Exception as inner:
                raise RuntimeError("fetch failed") from inner
        except RuntimeError as outer:
            assert runner._is_hub_error(outer)

    def test_a_local_exception_is_not(self):
        assert not runner._is_hub_error(RuntimeError("docker run failed"))


class TestDownloadProgress:
    """Bytes on disk against the pin's Hub sizes, in the shape the deploy UI renders."""

    def test_cached_bytes_counts_complete_and_partial_blobs_of_the_pin(self, tmp_path):
        (tmp_path / "aaa").write_bytes(b"x" * 10)
        (tmp_path / "bbb.1234.incomplete").write_bytes(b"x" * 4)
        (tmp_path / "other-revision").write_bytes(b"x" * 99)
        files = [("aaa", 10), ("bbb", 8), ("ccc", 5)]
        assert runner._cached_bytes(tmp_path, files) == 14

    def test_growth_sets_speed_and_eta(self):
        sizes = iter([0, 500])
        download = runner._Download("model_preparation", "org/w", 1000, lambda: next(sizes))
        assert download.sample()
        fields = download.fields(expects_weights=True)
        assert fields["downloaded_bytes"] == 500
        assert fields["total_bytes"] == 1000
        assert fields["speed_bps"] > 0
        assert fields["eta_seconds"] > 0
        assert fields["message"].startswith("Downloading weights: 500 B / 1.00 KB")

    def test_bytes_already_on_disk_are_not_reported_as_speed(self):
        download = runner._Download("model_preparation", "org/w", 1000, lambda: 700)
        assert not download.sample()
        assert download.speed is None

    def test_a_count_past_the_total_is_capped(self):
        sizes = iter([0, 1500])
        download = runner._Download("pulling_image", "img:tag", 1000, lambda: next(sizes))
        download.sample()
        fields = download.fields(expects_weights=False)
        assert fields["downloaded_bytes"] == 1000
        assert fields["message"] == "Loading image into Docker…"
        assert fields["expects_weights"] is False

    def test_tempfile_is_redirected_only_inside_the_block(self, monkeypatch):
        monkeypatch.setattr(runner, "_DownloadMonitor", _IdleMonitor)
        before = runner.tempfile.tempdir
        with runner._download_progress("ns/bundle", object()):
            staging = Path(runner.tempfile.gettempdir())
            assert staging.name.startswith("tt-studio-bundle-")
        assert runner.tempfile.tempdir == before
        assert not staging.exists()


class _IdleMonitor:
    def __init__(self, *args):
        pass

    def start(self):
        pass

    def stop(self):
        pass


class TestQuietTtKernel:
    """Nothing tt_kernel prints may reach stdout, which carries the NDJSON.

    Run as a subprocess because the guarantee is about fd 1 itself.
    """

    SCRIPT = r"""
import os, sys
sys.path.insert(0, {runner_dir!r})
import tt_model_runner as runner
with runner._quiet_tt_kernel():
    os.write(1, b"raw fd write from tt_kernel\n")
    print("python-level print from tt_kernel")
    runner.emit("log", level="INFO", message="event from inside the muted block")
runner.emit("result", status="success")
"""

    def test_events_get_out_and_everything_else_does_not(self, tmp_path):
        script = tmp_path / "probe.py"
        script.write_text(self.SCRIPT.format(runner_dir=str(Path(runner.__file__).parent)))
        done = subprocess.run([sys.executable, str(script)], capture_output=True, text=True)

        assert done.returncode == 0, done.stderr
        lines = [line for line in done.stdout.splitlines() if line.strip()]
        # Every stdout line must parse: a single stray line breaks the reader.
        events = [json.loads(line) for line in lines]
        assert [e["event"] for e in events] == ["log", "result"]
        # The muted output is not lost, just moved off the protocol stream.
        assert "raw fd write from tt_kernel" in done.stderr
        assert "python-level print from tt_kernel" in done.stderr

    def test_stdout_is_restored_afterwards(self, tmp_path):
        script = tmp_path / "probe2.py"
        script.write_text(
            f"import sys\nsys.path.insert(0, {str(Path(runner.__file__).parent)!r})\n"
            "import tt_model_runner as runner\n"
            "with runner._quiet_tt_kernel():\n    pass\n"
            "print('visible again')\n"
        )
        done = subprocess.run([sys.executable, str(script)], capture_output=True, text=True)
        assert done.returncode == 0, done.stderr
        assert "visible again" in done.stdout


@pytest.mark.parametrize("argv", [
    ["serve", "-x"],
    ["serve", "--profile=p300"],
    ["serve", "owner/model;rm"],
    ["serve", "owner/model", "--profile", "--port=1"],
    ["serve", "owner/model", "--profile=-p"],
    ["stop", "../model"],
    ["inspect", "model"],
])
def test_parser_rejects_names_that_could_read_as_flags(argv):
    with pytest.raises(SystemExit):
        runner.build_parser().parse_args(argv)


def test_parser_accepts_hub_names():
    args = runner.build_parser().parse_args(
        ["serve", "tt-hous/gemma-4-26B-A4B-it_p150_p150x2_p150x4", "--profile", "p300x2-longctx"]
    )
    assert (args.repo_id, args.profile) == ("tt-hous/gemma-4-26B-A4B-it_p150_p150x2_p150x4", "p300x2-longctx")


def test_serve_joins_studio_network_at_creation():
    argv = runner._on_studio_network(["docker", "run", "--detach", "image"])
    assert argv == ["docker", "run", "--network", runner.STUDIO_NETWORK, "--detach", "image"]


class TestCancelStagingCleanup:
    """Cancelling a serve mid-pull kills the download child and deletes /tmp staging."""

    @staticmethod
    def _write_stub_tt_kernel(root: Path, *, mode: str) -> Path:
        pkg = root / "tt_kernel"
        pkg.mkdir(parents=True)
        (pkg / "__init__.py").write_text("")
        (pkg / "manifest.py").write_text(
            "import json\n"
            "from types import SimpleNamespace\n"
            "class Manifest:\n"
            "    def __init__(self, data=None):\n"
            "        self.name = 'bundle'\n"
            "        self.arch = 'blackhole'\n"
            "        self.weights = None\n"
            "        self.is_container = True\n"
            "        self.container = SimpleNamespace(\n"
            "            kind='vllm-plugin',\n"
            "            resolve_profile=lambda name=None: SimpleNamespace(\n"
            "                name=name or 'default', hardware='p150', mesh_device='P150',\n"
            "                port=8000, model_copy=lambda update=None: SimpleNamespace(\n"
            "                    name=name or 'default', hardware='p150', mesh_device='P150',\n"
            "                    port=(update or {}).get('port', 8000),\n"
            "                ),\n"
            "            ),\n"
            "        )\n"
            "    def to_json(self):\n"
            "        return json.dumps({'name': self.name})\n"
            "    @classmethod\n"
            "    def from_json(cls, raw):\n"
            "        return cls(json.loads(raw))\n"
        )
        (pkg / "container_manifest.py").write_text(
            "hardware_chip_count = lambda hw: 1\n"
        )
        (pkg / "launchers.py").write_text(
            "KINDS = {'vllm-plugin': object()}\n"
        )
        (pkg / "container.py").write_text(
            "from pathlib import Path\n"
            "import os\n"
            "preflight = lambda need_devices=True: []\n"
            "pick_free_devices = lambda count: [0]\n"
            "ensure_devices_free = lambda ids: None\n"
            "image_ref = lambda m: 'tt-model/bundle:tag'\n"
            "image_present = lambda ref: False\n"
            "hf_home = lambda: Path(os.environ['TMPDIR']) / 'hf'\n"
        )
        (pkg / "hub.py").write_text(
            "from .manifest import Manifest\n"
            "_REPO_TYPE = 'model'\n"
            "fetch_manifest = lambda repo_id, rev=None: Manifest()\n"
            "def classify_hub_error(exc, repo_id):\n"
            "    return {\n"
            "        'cause': 'gated repo',\n"
            "        'detail': 'request access',\n"
            "        'evidence': '403',\n"
            "        'actions': ['accept terms'],\n"
            "    }\n"
        )
        if mode == "hang":
            pull_body = (
                "    with ThreadPoolExecutor(max_workers=2) as pool:\n"
                "        def _worker():\n"
                "            pid_file = os.environ.get('STUB_PULL_PID_FILE')\n"
                "            if pid_file:\n"
                "                Path(pid_file).write_text(str(os.getpid()))\n"
                "            part = Path(tempfile.gettempdir()) / 'nested' / 'partial.bin'\n"
                "            part.parent.mkdir(parents=True, exist_ok=True)\n"
                "            part.write_bytes(b'x' * 1024)\n"
                "            for _ in range(600):\n"
                "                time.sleep(0.05)\n"
                "        fut = pool.submit(_worker)\n"
                "        fut.result()\n"
            )
        else:
            pull_body = (
                "    err = type('GatedRepoError', (Exception,), "
                "{'__module__': 'huggingface_hub.errors'})('403')\n"
                "    raise err\n"
            )
        (pkg / "container_cli.py").write_text(
            "import os, tempfile, time\n"
            "from concurrent.futures import ThreadPoolExecutor\n"
            "from pathlib import Path\n"
            "parse_device_id = lambda raw, *, chip_count, profile_name: None\n"
            "load_pulled = lambda repo_id: None\n"
            "def pull_container(repo_id, rev, manifest, *, no_weights=False):\n"
            + pull_body
        )
        return root

    @staticmethod
    def _spawn_serve(stub_root: Path, tmp_root: Path, *, extra_env=None):
        env = os.environ.copy()
        env["PYTHONPATH"] = str(stub_root)
        env["TMPDIR"] = str(tmp_root)
        env["TEMP"] = str(tmp_root)
        env["TMP"] = str(tmp_root)
        if extra_env:
            env.update(extra_env)
        return subprocess.Popen(
            [sys.executable, str(runner.__file__), "serve", "ns/bundle"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            start_new_session=True,
        )

    @staticmethod
    def _wait_for_staging(proc: subprocess.Popen, *, require_file: bool = True):
        staging: Path | None = None
        events = []
        deadline = time.monotonic() + 10
        assert proc.stdout is not None
        while time.monotonic() < deadline:
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                continue
            event = json.loads(line)
            events.append(event)
            if event.get("event") == "staging":
                staging = Path(event["path"])
                if not require_file:
                    return staging, events
                break
        assert staging is not None, f"staging event missing; events={events}"
        part = staging / "nested" / "partial.bin"
        while time.monotonic() < deadline:
            if part.exists():
                return staging, events
            assert proc.poll() is None, "serve exited prematurely while waiting for partial.bin"
            time.sleep(0.02)
        raise AssertionError(f"{part} was not created before deadline")

    def test_sigterm_process_group_cleans_staging_without_waiting_on_threads(self, tmp_path):
        stub_root = self._write_stub_tt_kernel(tmp_path / "stubs", mode="hang")
        tmp_root = tmp_path / "tmp"
        tmp_root.mkdir()
        proc = self._spawn_serve(stub_root, tmp_root)
        try:
            staging, events = self._wait_for_staging(proc)
            assert staging.parent == tmp_root
            assert staging.name.startswith("tt-studio-bundle-")

            os.killpg(proc.pid, signal.SIGTERM)
            rc = proc.wait(timeout=5)
            remaining = [json.loads(ln) for ln in proc.stdout.read().splitlines() if ln.strip()]
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()

        assert rc == 128 + signal.SIGTERM
        assert not staging.exists()
        assert list(tmp_root.glob("tt-studio-bundle-*")) == []
        assert not any(e.get("event") == "error" for e in events + remaining)

    def test_sigterm_parent_pid_terminates_pull_child_and_cleans_staging(self, tmp_path):
        stub_root = self._write_stub_tt_kernel(tmp_path / "stubs", mode="hang")
        tmp_root = tmp_path / "tmp"
        tmp_root.mkdir()
        pid_file = tmp_path / "pull.pid"
        proc = self._spawn_serve(
            stub_root, tmp_root, extra_env={"STUB_PULL_PID_FILE": str(pid_file)}
        )
        try:
            staging, _ = self._wait_for_staging(proc)
            child_pid = int(pid_file.read_text())

            proc.terminate()
            rc = proc.wait(timeout=5)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()

        assert rc == 128 + signal.SIGTERM
        assert not staging.exists()
        with pytest.raises(ProcessLookupError):
            os.kill(child_pid, 0)

    def test_pull_subprocess_preserves_classified_hub_error_and_cleans_staging(self, tmp_path):
        stub_root = self._write_stub_tt_kernel(tmp_path / "stubs", mode="hub_error")
        tmp_root = tmp_path / "tmp"
        tmp_root.mkdir()
        proc = self._spawn_serve(stub_root, tmp_root)
        try:
            stdout, stderr = proc.communicate(timeout=10)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()

        assert proc.returncode == 1, stderr
        events = [json.loads(ln) for ln in stdout.splitlines() if ln.strip()]
        staging_event = next(e for e in events if e.get("event") == "staging")
        error_event = next(e for e in events if e.get("event") == "error")
        assert error_event["message"] == "gated repo"
        assert error_event["detail"] == "request access"
        assert error_event["actions"] == ["accept terms"]
        assert not Path(staging_event["path"]).exists()

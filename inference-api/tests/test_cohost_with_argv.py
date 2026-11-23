# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""/run's cohost_with becomes run.py --cohost-with: several models on the same chips.

An artifact whose run.py predates the option is refused up front, because run.py
itself would only report "unrecognized arguments" from inside the deploy job.
"""

import pytest


@pytest.fixture()
def api():
    return pytest.importorskip(
        "api", reason="requires the tt-inference-server artifact on sys.path"
    )


def _run_py(tmp_path, text):
    path = tmp_path / "run.py"
    path.write_text(text)
    return path


def test_no_members_adds_nothing(api, tmp_path):
    assert api.cohost_with_argv(None, tmp_path / "missing.py") == []
    assert api.cohost_with_argv([], tmp_path / "missing.py") == []


def test_members_become_one_flag(api, tmp_path):
    run_py = _run_py(tmp_path, 'parser.add_argument("--cohost-with")')
    assert api.cohost_with_argv(["Qwen3-32B", "Llama-3.1-8B-Instruct"], run_py) == [
        "--cohost-with",
        "Qwen3-32B,Llama-3.1-8B-Instruct",
    ]


def test_artifact_without_the_option_is_refused(api, tmp_path):
    run_py = _run_py(tmp_path, 'parser.add_argument("--model")')
    with pytest.raises(ValueError, match="has no --cohost-with"):
        api.cohost_with_argv(["Qwen3-32B"], run_py)


@pytest.mark.parametrize("name", ["", "--dev-mode", "a,b"])
def test_names_that_are_not_models_are_refused(api, tmp_path, name):
    run_py = _run_py(tmp_path, "--cohost-with")
    with pytest.raises(ValueError, match="is not a model name"):
        api.cohost_with_argv([name], run_py)


def test_run_request_carries_the_members(api):
    request = api.RunRequest(
        model="Llama-3.1-8B-Instruct",
        workflow="server",
        device="p300x2",
        cohost_with=["Qwen3-32B"],
    )
    assert request.cohost_with == ["Qwen3-32B"]
    assert api.RunRequest(model="m", workflow="server", device="n150").cohost_with is None

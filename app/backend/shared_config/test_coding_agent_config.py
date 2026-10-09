# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Coding-agent parsers and thinking variants come from the catalog."""

from django.test import SimpleTestCase
from docker_control.tt_inference_client import tool_calling_launch_flags

from shared_config.coding_agent_config import (
    CODING_AGENT_ELIGIBLE_MODELS,
    get_gateway_model_names,
    has_thinking_toggle,
    resolve_thinking_variant,
)
from shared_config.model_config import model_implmentations


def _catalog_impl(model_name):
    return next(
        (
            i
            for i in model_implmentations.values()
            if i.model_name == model_name and i.tool_call_parser
        ),
        None,
    )


class CatalogParserTests(SimpleTestCase):
    def test_every_eligible_catalog_model_has_a_tool_call_parser(self):
        """Losing one silently disables coding-agent tool calling on deploy."""
        catalog_names = {i.model_name for i in model_implmentations.values()}
        missing = [
            name
            for name in CODING_AGENT_ELIGIBLE_MODELS & catalog_names
            if _catalog_impl(name) is None
        ]
        self.assertEqual(missing, [])

    def test_launch_flags_match_by_hf_repo(self):
        impl = _catalog_impl("Qwen3-32B")
        flags = tool_calling_launch_flags("some-served-name", impl.hf_model_id)
        self.assertIn(f"--tool-call-parser {impl.tool_call_parser}", flags)
        self.assertIn(f"--reasoning-parser {impl.reasoning_parser}", flags)

    def test_unknown_model_has_no_launch_flags(self):
        self.assertIsNone(tool_calling_launch_flags("not-a-model", "org/not-a-model"))


class ThinkingToggleTests(SimpleTestCase):
    def test_eligible_reasoning_model_gets_a_thinking_variant(self):
        self.assertTrue(has_thinking_toggle("Qwen3-32B"))
        self.assertEqual(
            get_gateway_model_names("Qwen3-32B"), ["Qwen3-32B", "Qwen3-32B-thinking"]
        )
        self.assertEqual(
            resolve_thinking_variant("Qwen3-32B-thinking"), ("Qwen3-32B", True)
        )
        self.assertEqual(resolve_thinking_variant("Qwen3-32B"), ("Qwen3-32B", False))

    def test_eligible_model_without_reasoning_parser_has_none(self):
        self.assertFalse(has_thinking_toggle("Llama-3.3-70B-Instruct"))
        self.assertEqual(
            resolve_thinking_variant("Llama-3.3-70B-Instruct"),
            ("Llama-3.3-70B-Instruct", None),
        )

    def test_ineligible_reasoning_model_has_none(self):
        """A reasoning parser alone (e.g. QwQ's deepseek_r1) is not a per-request toggle."""
        self.assertFalse(has_thinking_toggle("QwQ-32B"))

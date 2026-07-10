# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Value predicates: placeholder detection + boolean env parsing."""

from tt_setup.constants import *


def is_placeholder(value):
    """Check for common placeholder or empty values."""
    if not value or str(value).strip() == "":
        return True

    placeholder_patterns = [
        'django-insecure-default', 'tvly-xxx', 'hf_***',
        'tt-studio-rag-admin-password', 'cloud llama chat ui url',
        'cloud llama chat ui auth token', 'test-456',
        'sk-tt-studio-local-change-me', 'sk-tt-studio-REPLACE-ME', 'change-me-internal',
        '<PATH_TO_ROOT_OF_REPO>'
    ]

    value_str = str(value).strip().strip('"\'')
    return value_str in placeholder_patterns


def parse_boolean_env(raw_value):
    """Parse boolean values from .env file"""
    return str(raw_value).lower().strip().strip('"\'') in ['true', '1', 't', 'y', 'yes']


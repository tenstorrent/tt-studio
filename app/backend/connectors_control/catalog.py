# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Catalog of connectors users can enable through the chat "+" menu.

Each entry maps a user-facing connector slug to a Composio toolkit and the
env var that holds its `auth_config_id` (created once by an admin on the
Composio dashboard). Slack/Discord/etc. are added by appending entries.
"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ConnectorSpec:
    slug: str
    name: str
    description: str
    icon_url: str
    composio_toolkit: str  # Composio toolkit slug, e.g. "NOTION"
    auth_config_env: str   # env var holding the auth_config_id

    def auth_config_id(self) -> str | None:
        value = os.environ.get(self.auth_config_env, "").strip()
        return value or None

    def to_dict(self) -> dict:
        return {
            "slug": self.slug,
            "name": self.name,
            "description": self.description,
            "icon_url": self.icon_url,
            "composio_toolkit": self.composio_toolkit,
            "configured": self.auth_config_id() is not None,
        }


AVAILABLE_CONNECTORS: list[ConnectorSpec] = [
    ConnectorSpec(
        slug="notion",
        name="Notion",
        description="Search pages, create pages, and update databases in your Notion workspace.",
        icon_url="https://www.notion.so/images/favicon.ico",
        composio_toolkit="NOTION",
        auth_config_env="COMPOSIO_AUTH_CONFIG_NOTION",
    ),
]


def get_connector(slug: str) -> ConnectorSpec | None:
    for spec in AVAILABLE_CONNECTORS:
        if spec.slug == slug:
            return spec
    return None

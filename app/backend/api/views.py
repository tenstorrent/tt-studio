# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from rest_framework.views import APIView
from rest_framework.response import Response

from shared_config.user_config import (
    load_user_config,
    save_user_config,
    get_jwt_secret,
    get_tavily_api_key,
)


class UpStatusView(APIView):
    def get(self, request, *args, **kwargs):
        return Response(status=200)


def _mask(value):
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}****{value[-4:]}"


class SettingsView(APIView):
    """Manage user-editable secrets stored in the persistent volume."""

    def get(self, request, *args, **kwargs):
        cfg = load_user_config()
        jwt_value = get_jwt_secret()
        tavily_value = get_tavily_api_key()
        return Response({
            "jwt_secret": {
                "set": bool(jwt_value),
                "masked": _mask(jwt_value),
                "source": "user_config" if cfg.get("jwt_secret") else ("env" if jwt_value else None),
            },
            "tavily_api_key": {
                "set": bool(tavily_value),
                "masked": _mask(tavily_value),
                "source": "user_config" if cfg.get("tavily_api_key") else ("env" if tavily_value else None),
            },
        })

    def post(self, request, *args, **kwargs):
        data = request.data or {}
        if "jwt_secret" in data:
            return Response(
                {"error": "jwt_secret is auto-managed and cannot be set via the UI."},
                status=400,
            )

        updates = {}
        if "tavily_api_key" in data:
            updates["tavily_api_key"] = (data.get("tavily_api_key") or "").strip()

        if not updates:
            return Response({"error": "No supported fields provided"}, status=400)

        save_user_config(updates)
        return Response({
            "ok": True,
            "requires_redeploy": False,
            "updated": list(updates.keys()),
        })

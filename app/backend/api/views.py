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
    get_hf_token,
    get_tts_api_key,
    get_artifact_info,
    is_setup_complete,
)
from api.hf_access import check_hf_access, HF_GATED_MODELS


class UpStatusView(APIView):
    def get(self, request, *args, **kwargs):
        return Response(status=200)


def _mask(value):
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}****{value[-4:]}"


def _field(cfg, key, value, editable=True):
    return {
        "set": bool(value),
        "masked": _mask(value),
        "source": "user_config" if cfg.get(key) else ("env" if value else None),
        "editable": editable,
    }


_EDITABLE_FIELDS = ("tavily_api_key", "hf_token", "tts_api_key")
_ARTIFACT_DESCRIPTION = (
    "Pins which tt-inference-server release TT Studio is built against. "
    "Changing it requires a redeploy; editing here is intentionally disabled."
)


class SettingsView(APIView):
    """Manage user-editable secrets stored in the persistent volume."""

    def get(self, request, *args, **kwargs):
        cfg = load_user_config()
        artifact = get_artifact_info()
        return Response({
            "setup_complete": is_setup_complete(),
            "jwt_secret": _field(cfg, "jwt_secret", get_jwt_secret(), editable=False),
            "tavily_api_key": _field(cfg, "tavily_api_key", get_tavily_api_key()),
            "hf_token": _field(cfg, "hf_token", get_hf_token()),
            "tts_api_key": _field(cfg, "tts_api_key", get_tts_api_key()),
            "artifact": {
                "branch": artifact["branch"],
                "version": artifact["version"],
                "editable": False,
                "description": _ARTIFACT_DESCRIPTION,
            },
        })

    def post(self, request, *args, **kwargs):
        data = request.data or {}
        if "jwt_secret" in data:
            return Response(
                {"error": "jwt_secret is auto-managed and cannot be set via the UI."},
                status=400,
            )
        if "artifact" in data or "tt_inference_artifact_branch" in data or "tt_inference_artifact_version" in data:
            return Response(
                {"error": "Artifact branch/version is read-only in this release."},
                status=400,
            )

        updates = {}
        for key in _EDITABLE_FIELDS:
            if key in data:
                updates[key] = (data.get(key) or "").strip()
        if data.get("setup_complete") is True:
            updates["setup_complete"] = True

        if not updates:
            return Response({"error": "No supported fields provided"}, status=400)

        save_user_config(updates)
        return Response({
            "ok": True,
            "requires_redeploy": False,
            "updated": list(updates.keys()),
        })


class HfCheckView(APIView):
    """Run Hugging Face access checks for the gated models TT Studio needs.

    Accepts an optional `hf_token` in the body; if absent, uses the stored token.
    Does not persist the token (the Settings endpoint owns persistence).
    """

    def post(self, request, *args, **kwargs):
        data = request.data or {}
        token = (data.get("hf_token") or "").strip() or get_hf_token()
        if not token:
            return Response(
                {
                    "ok": False,
                    "error": "No HF token provided or saved.",
                    "results": [
                        {
                            "label": label,
                            "repo": repo,
                            "status": "no_token",
                            "url": f"https://huggingface.co/{repo}",
                        }
                        for repo, label in HF_GATED_MODELS
                    ],
                },
                status=200,
            )
        results = check_hf_access(token)
        ok = all(r["status"] == "granted" for r in results)
        return Response({"ok": ok, "results": results})

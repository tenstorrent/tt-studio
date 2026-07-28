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
    """Mask a secret for display. Only reveal edge characters when the value is
    long enough that the revealed portion is a small fraction of the whole;
    shorter secrets are fully masked so we never expose most of a short token."""
    if not value:
        return None
    if len(value) <= 12:
        return "*" * len(value)
    return f"{value[:4]}****{value[-4:]}"


def _field(cfg, key, value, editable=True):
    return {
        "set": bool(value),
        "masked": _mask(value),
        # Editable secrets are returned in plaintext so the UI can pre-fill
        # them and reveal on the eye toggle. The JWT secret stays masked-only.
        "value": (value or None) if editable else None,
        "source": "user_config" if cfg.get(key) else ("env" if value else None),
        "editable": editable,
    }


_EDITABLE_FIELDS = ("tavily_api_key", "hf_token")
_ARTIFACT_DESCRIPTION = (
    "Pins which tt-inference-server release TT Studio is built against. "
    "Changing it requires a redeploy; editing here is intentionally disabled."
)


class SettingsView(APIView):
    """Manage user-editable secrets stored in the persistent volume."""

    def get(self, request, *args, **kwargs):
        artifact = get_artifact_info()
        # Resolve the JWT first — get_jwt_secret() auto-generates and persists one
        # on first call. Reload the config afterwards so the "source" label
        # reflects the freshly persisted value instead of mislabeling an
        # auto-generated secret as coming from the environment.
        jwt_value = get_jwt_secret()
        cfg = load_user_config()
        return Response({
            "setup_complete": is_setup_complete(),
            "jwt_secret": _field(cfg, "jwt_secret", jwt_value, editable=False),
            "tavily_api_key": _field(cfg, "tavily_api_key", get_tavily_api_key()),
            "hf_token": _field(cfg, "hf_token", get_hf_token()),
            "tts_api_key": _field(cfg, "tts_api_key", get_tts_api_key(), editable=False),
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
        if "tts_api_key" in data:
            return Response(
                {"error": "tts_api_key is auto-managed and cannot be set via the UI."},
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
            # Nothing to change — treat as a successful no-op rather than an
            # error so a blank Save (or a re-save with no edits) isn't confusing.
            return Response({"ok": True, "requires_redeploy": False, "updated": []})

        save_user_config(updates)
        # Only the HF token is baked into a model container at deploy time
        # (tt_inference_client.py), so an already-running model keeps its old
        # token until redeployed. The other secrets are resolved per request.
        return Response({
            "ok": True,
            "requires_redeploy": "hf_token" in updates,
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
                        for repo, label, _filename in HF_GATED_MODELS
                    ],
                },
                status=200,
            )
        results = check_hf_access(token)
        ok = all(r["status"] == "granted" for r in results)
        return Response({"ok": ok, "results": results})

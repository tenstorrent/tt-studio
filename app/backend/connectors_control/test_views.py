# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Smoke tests for the connectors_control endpoints. Composio calls are mocked;
no network or API key required.
"""

from unittest.mock import patch

import pytest
from rest_framework import status
from rest_framework.test import APIRequestFactory

from connectors_control.composio_client import ComposioError, ComposioNotConfigured
from connectors_control.views import (
    AvailableConnectorsView,
    ConnectionsView,
    ConnectView,
    DisconnectView,
    OAuthCallbackView,
)

SESSION = "session-abc-123"


def _req_with_session(factory_method, path, **kwargs):
    factory = APIRequestFactory()
    return factory_method(path, HTTP_X_SESSION_ID=SESSION, **kwargs)


def test_available_returns_catalog():
    factory = APIRequestFactory()
    request = factory.get("/connectors-api/available/")
    response = AvailableConnectorsView.as_view()(request)
    assert response.status_code == status.HTTP_200_OK
    slugs = [c["slug"] for c in response.data["connectors"]]
    assert "notion" in slugs


def test_connections_requires_session_header():
    factory = APIRequestFactory()
    request = factory.get("/connectors-api/connections/")
    response = ConnectionsView.as_view()(request)
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "X-Session-Id" in response.data["error"]


@patch("connectors_control.views.list_connections")
def test_connections_lists_for_session(mock_list):
    mock_list.return_value = [
        {"id": "ca_1", "status": "ACTIVE", "toolkit_slug": "NOTION"},
    ]
    request = _req_with_session(APIRequestFactory().get, "/connectors-api/connections/")
    response = ConnectionsView.as_view()(request)
    assert response.status_code == status.HTTP_200_OK
    mock_list.assert_called_once_with(SESSION)
    assert response.data["connections"][0]["provider"] == "notion"
    assert response.data["connections"][0]["status"] == "ACTIVE"


@patch("connectors_control.views.list_connections")
def test_connections_returns_503_when_unconfigured(mock_list):
    mock_list.side_effect = ComposioNotConfigured("missing key")
    request = _req_with_session(APIRequestFactory().get, "/connectors-api/connections/")
    response = ConnectionsView.as_view()(request)
    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE


def test_connect_unknown_provider_returns_404():
    request = _req_with_session(
        APIRequestFactory().post, "/connectors-api/connect/bogus/"
    )
    response = ConnectView.as_view()(request, provider="bogus")
    assert response.status_code == status.HTTP_404_NOT_FOUND


@patch.dict("os.environ", {"COMPOSIO_AUTH_CONFIG_NOTION": ""}, clear=False)
def test_connect_returns_503_when_auth_config_missing():
    request = _req_with_session(
        APIRequestFactory().post, "/connectors-api/connect/notion/"
    )
    response = ConnectView.as_view()(request, provider="notion")
    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert "not configured" in response.data["error"].lower()


@patch.dict("os.environ", {"COMPOSIO_AUTH_CONFIG_NOTION": "ac_xyz"}, clear=False)
@patch("connectors_control.views.initiate_oauth")
def test_connect_returns_auth_url(mock_initiate):
    mock_initiate.return_value = {
        "id": "ca_42",
        "redirect_url": "https://composio/oauth/start?...",
        "status": "INITIATED",
    }
    request = _req_with_session(
        APIRequestFactory().post, "/connectors-api/connect/notion/"
    )
    response = ConnectView.as_view()(request, provider="notion")
    assert response.status_code == status.HTTP_200_OK
    assert response.data["connection_id"] == "ca_42"
    assert response.data["auth_url"].startswith("https://composio/")
    args, kwargs = mock_initiate.call_args
    assert kwargs["user_id"] == SESSION
    assert kwargs["auth_config_id"] == "ac_xyz"
    assert "session_id=" + SESSION in kwargs["callback_url"]


@patch("connectors_control.views.delete_connection")
@patch("connectors_control.views.list_connections")
def test_disconnect_deletes_all_provider_connections(mock_list, mock_delete):
    mock_list.return_value = [
        {"id": "ca_1", "status": "ACTIVE", "toolkit_slug": "NOTION"},
        {"id": "ca_2", "status": "ACTIVE", "toolkit_slug": "NOTION"},
    ]
    factory = APIRequestFactory()
    request = factory.delete(
        "/connectors-api/connections/notion/", HTTP_X_SESSION_ID=SESSION
    )
    response = DisconnectView.as_view()(request, provider="notion")
    assert response.status_code == status.HTTP_200_OK
    assert response.data["deleted"] == 2
    assert mock_delete.call_count == 2


def test_oauth_callback_redirects_to_frontend():
    factory = APIRequestFactory()
    request = factory.get(
        "/connectors-api/oauth/callback/?provider=notion&status=success"
    )
    response = OAuthCallbackView.as_view()(request)
    assert response.status_code in (302, 301)
    assert response["Location"].startswith("/connectors/callback")
    assert "provider=notion" in response["Location"]
    assert "status=success" in response["Location"]


@pytest.mark.parametrize(
    "missing_key",
    [
        "",
        "composio-api-key-not-configured",
    ],
)
def test_composio_client_raises_not_configured(missing_key, monkeypatch):
    from connectors_control import composio_client

    composio_client._client.cache_clear()
    monkeypatch.setenv("COMPOSIO_API_KEY", missing_key)
    with pytest.raises(ComposioNotConfigured):
        composio_client._client()

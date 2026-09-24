import json
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth import get_user_model
from django.test import Client, override_settings

from identity.models import FeishuIdentity
from recruitment.models import Membership, Organization

pytestmark = pytest.mark.django_db

FEISHU_SETTINGS = {
    "FEISHU_APP_ID": "cli_test_application",
    "FEISHU_APP_SECRET": "test-secret-not-a-real-credential",
    "FEISHU_REDIRECT_URI": "http://localhost:5173/api/v1/auth/login/",
    "FEISHU_LOGIN_SUCCESS_URL": "http://localhost:5174/#today",
    "FEISHU_APP_ACCESS_TOKEN_URL": "https://accounts.example.test/app-access-token",
}


class FeishuResponse:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.body


def create_bound_identity():
    user = get_user_model().objects.create_user("feishu_hr", password="unused-password")
    organization = Organization.objects.create(name="飞书测试组织")
    Membership.objects.create(user=user, organization=organization)
    return FeishuIdentity.objects.create(
        user=user,
        app_id=FEISHU_SETTINGS["FEISHU_APP_ID"],
        open_id="ou_test_user",
    )


def login_state(client):
    response = client.get("/api/v1/auth/login/")
    assert response.status_code == 302
    query = parse_qs(urlparse(response["Location"]).query)
    assert query["app_id"] == [FEISHU_SETTINGS["FEISHU_APP_ID"]]
    assert query["redirect_uri"] == [FEISHU_SETTINGS["FEISHU_REDIRECT_URI"]]
    return query["state"][0]


@override_settings(**FEISHU_SETTINGS)
def test_feishu_login_exchanges_code_and_uses_existing_membership():
    identity = create_bound_identity()
    client = Client()
    state = login_state(client)
    responses = [
        FeishuResponse({"code": 0, "app_access_token": "test-app-token"}),
        FeishuResponse({"code": 0, "data": {"access_token": "test-token"}}),
        FeishuResponse(
            {
                "code": 0,
                "data": {
                    "open_id": identity.open_id,
                    "union_id": "on_test_user",
                    "name": "飞书 HR",
                    "email": "hr@example.test",
                },
            }
        ),
    ]
    with patch("recruitment.auth.urlrequest.urlopen", side_effect=responses) as request_mock:
        response = client.get("/api/v1/auth/login/", {"code": "authorization-code", "state": state})

    assert response.status_code == 302
    assert response["Location"] == FEISHU_SETTINGS["FEISHU_LOGIN_SUCCESS_URL"]
    assert request_mock.call_count == 3
    app_token_request, user_token_request, _ = [
        call.args[0] for call in request_mock.call_args_list
    ]
    assert app_token_request.full_url == FEISHU_SETTINGS["FEISHU_APP_ACCESS_TOKEN_URL"]
    assert json.loads(app_token_request.data) == {
        "app_id": FEISHU_SETTINGS["FEISHU_APP_ID"],
        "app_secret": FEISHU_SETTINGS["FEISHU_APP_SECRET"],
    }
    assert json.loads(user_token_request.data) == {
        "grant_type": "authorization_code",
        "code": "authorization-code",
    }
    assert user_token_request.headers["Authorization"] == "Bearer test-app-token"
    identity.refresh_from_db()
    assert identity.display_name == "飞书 HR"
    assert identity.union_id == "on_test_user"
    assert identity.last_authenticated_at is not None
    assert client.get("/api/v1/me/").status_code == 200


@override_settings(**FEISHU_SETTINGS)
def test_feishu_login_rejects_invalid_state_before_calling_feishu():
    with patch("recruitment.auth.urlrequest.urlopen") as request_mock:
        response = Client().get(
            "/api/v1/auth/login/", {"code": "authorization-code", "state": "wrong-state"}
        )

    assert response.status_code == 400
    assert "已失效" in response.json()["errors"]["detail"]
    request_mock.assert_not_called()


@override_settings(**FEISHU_SETTINGS)
def test_feishu_login_does_not_grant_unbound_account_access():
    client = Client()
    state = login_state(client)
    responses = [
        FeishuResponse({"code": 0, "app_access_token": "test-app-token"}),
        FeishuResponse({"code": 0, "data": {"access_token": "test-token"}}),
        FeishuResponse({"code": 0, "data": {"open_id": "ou_unbound"}}),
    ]
    with patch("recruitment.auth.urlrequest.urlopen", side_effect=responses):
        response = client.get("/api/v1/auth/login/", {"code": "authorization-code", "state": state})

    assert response.status_code == 403
    assert "尚未获得" in response.json()["errors"]["detail"]
    assert "_auth_user_id" not in client.session

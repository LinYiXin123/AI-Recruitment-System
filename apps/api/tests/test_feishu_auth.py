import json
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth import get_user_model
from django.test import Client, override_settings

from identity.models import FeishuIdentity
from recruitment.models import Department, DepartmentRole, Membership, Organization

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
    membership = create_hr_membership("feishu_hr")
    return FeishuIdentity.objects.create(
        user=membership.user,
        app_id=FEISHU_SETTINGS["FEISHU_APP_ID"],
        open_id="ou_test_user",
    )


def create_hr_membership(username="local_hr"):
    user = get_user_model().objects.create_user(username, password="unused-password")
    organization = Organization.objects.create(name="飞书 HR 测试组织")
    department = Department.objects.create(organization=organization, name="招聘部")
    membership = Membership.objects.create(user=user, organization=organization)
    DepartmentRole.objects.create(membership=membership, department=department, role="hr")
    return membership


def login_state(client):
    response = client.get(
        "/api/v1/auth/login/",
        HTTP_HOST=urlparse(FEISHU_SETTINGS["FEISHU_REDIRECT_URI"]).netloc,
    )
    assert response.status_code == 302
    query = parse_qs(urlparse(response["Location"]).query)
    assert query["app_id"] == [FEISHU_SETTINGS["FEISHU_APP_ID"]]
    assert query["redirect_uri"] == [FEISHU_SETTINGS["FEISHU_REDIRECT_URI"]]
    return query["state"][0]


@pytest.mark.parametrize(
    "host, secure",
    [("127.0.0.1:5173", False), ("localhost:5174", False), ("localhost:5173", True)],
)
@override_settings(**FEISHU_SETTINGS)
def test_feishu_login_sets_state_only_at_configured_callback_origin(host, secure):
    client = Client()
    response = client.get(
        "/api/v1/auth/login/?next=https://other.example.test/",
        HTTP_HOST=host,
        secure=secure,
    )
    assert response.status_code == 302
    assert response["Location"] == FEISHU_SETTINGS["FEISHU_REDIRECT_URI"]
    assert not client.cookies
    state = login_state(client)
    assert state == client.session["feishu_login_state"]
    assert "_auth_user_id" not in client.session


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
                    "avatar_url": "https://avatar.example.test/hr.png",
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
    assert identity.avatar_url == "https://avatar.example.test/hr.png"
    profile = client.get("/api/v1/me/").json()
    assert profile["name"] == "飞书 HR"
    assert profile["avatar_url"] == identity.avatar_url
    assert profile["auth_source"] == "feishu"
    assert profile["roles"] == ["hr"]
    assert "open_id" not in profile and "email" not in profile
    assert client.session["feishu_identity_id"] == identity.id


@override_settings(
    **FEISHU_SETTINGS,
    DEBUG=True,
    FEISHU_LOCAL_BOOTSTRAP_HR_USERNAME="local_hr",
)
def test_local_debug_bootstraps_first_feishu_account_as_hr():
    membership = create_hr_membership()
    client = Client()
    state = login_state(client)
    responses = [
        FeishuResponse({"code": 0, "app_access_token": "test-app-token"}),
        FeishuResponse({"code": 0, "data": {"access_token": "test-token"}}),
        FeishuResponse({"code": 0, "data": {"open_id": "ou_first_hr"}}),
    ]
    with patch("recruitment.auth.urlrequest.urlopen", side_effect=responses):
        response = client.get("/api/v1/auth/login/", {"code": "authorization-code", "state": state})

    assert response.status_code == 302
    identity = FeishuIdentity.objects.get(app_id=FEISHU_SETTINGS["FEISHU_APP_ID"])
    assert identity.open_id == "ou_first_hr"
    assert identity.user_id == membership.user_id


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


@pytest.mark.parametrize(
    "avatar",
    [
        None,
        "",
        "http://avatar.example.test/hr.png",
        "javascript:alert(1)",
        "https://user:secret@avatar.example.test/hr.png",
        "https://avatar.example.test/" + "a" * 2048,
    ],
)
@override_settings(**FEISHU_SETTINGS)
def test_missing_or_unsafe_avatar_does_not_block_login(avatar):
    identity = create_bound_identity()
    identity.avatar_url = "https://avatar.example.test/old.png"
    identity.save()
    client = Client()
    state = login_state(client)
    responses = [
        FeishuResponse({"code": 0, "app_access_token": "test-app-token"}),
        FeishuResponse({"code": 0, "data": {"access_token": "test-token"}}),
        FeishuResponse({"code": 0, "data": {"open_id": identity.open_id, "avatar_url": avatar}}),
    ]
    with patch("recruitment.auth.urlrequest.urlopen", side_effect=responses):
        response = client.get("/api/v1/auth/login/", {"code": "test-code", "state": state})
    assert response.status_code == 302
    profile = client.get("/api/v1/me/").json()
    assert profile["avatar_url"] == ""
    assert profile["name"] == "feishu_hr"
    assert profile["roles"] == ["hr"]


@override_settings(**FEISHU_SETTINGS)
def test_local_login_does_not_display_bound_feishu_identity():
    identity = create_bound_identity()
    identity.display_name = "飞书身份"
    identity.avatar_url = "https://avatar.example.test/hr.png"
    identity.save()
    client = Client()
    client.force_login(identity.user)
    session = client.session
    session["membership_id"] = Membership.objects.get(user=identity.user).id
    session["feishu_identity_id"] = identity.id
    session.save()
    assert client.get("/api/v1/me/").json()["name"] == "飞书身份"
    response = client.post(
        "/api/v1/auth/login/",
        {"username": "feishu_hr", "password": "unused-password"},
        content_type="application/json",
    )
    assert response.status_code == 200
    profile = client.get("/api/v1/me/").json()
    assert profile["name"] == "feishu_hr"
    assert profile["avatar_url"] == ""
    assert profile["auth_source"] == "local"
    assert "feishu_identity_id" not in client.session


@pytest.mark.parametrize("mismatch", ["user", "app"])
@override_settings(**FEISHU_SETTINGS)
def test_profile_identity_must_match_current_user_and_app(mismatch):
    identity = create_bound_identity()
    membership = Membership.objects.get(user=identity.user)
    if mismatch == "user":
        membership = create_hr_membership("different_user")
    else:
        identity.app_id = "another_app"
        identity.save()
    client = Client()
    client.force_login(membership.user)
    session = client.session
    session["membership_id"] = membership.id
    session["feishu_identity_id"] = identity.id
    session.save()
    profile = client.get("/api/v1/me/").json()
    assert profile["auth_source"] == "local"
    assert profile["avatar_url"] == ""


@override_settings(PUBLIC_HOME_URL="http://localhost:5173/")
def test_logout_clears_session_and_returns_configured_home_with_csrf_protection():
    membership = create_hr_membership()
    client = Client(enforce_csrf_checks=True)
    client.force_login(membership.user)
    session = client.session
    session["membership_id"] = membership.id
    session["feishu_identity_id"] = 1
    session.save()
    config = client.get("/api/v1/auth/csrf/").json()
    assert config["home_url"] == "http://localhost:5173/"
    assert client.post("/api/v1/auth/logout/").status_code == 403
    assert client.get("/api/v1/me/").status_code == 200
    response = client.post(
        "/api/v1/auth/logout/?next=https://other.example.test/",
        HTTP_X_CSRFTOKEN=config["csrfToken"],
    )
    assert response.status_code == 200
    assert response.json()["redirect_url"] == "http://localhost:5173/"
    assert "_auth_user_id" not in client.session
    assert "feishu_identity_id" not in client.session
    assert client.get("/api/v1/me/").status_code == 403

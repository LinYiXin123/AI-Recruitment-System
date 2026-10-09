import hashlib
import json
import secrets
from datetime import timedelta
from urllib import error, parse
from urllib import request as urlrequest

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.exceptions import ValidationError
from django.core.validators import URLValidator
from django.db import transaction
from django.http import HttpResponseRedirect, JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from identity.models import FeishuIdentity

from .models import LoginRate, Membership

EXPERIENCE_ACCOUNTS = {
    "hr": ("local_hr", "hr"),
    "manager": ("local_manager", "manager"),
}
EXPERIENCE_ORGANIZATION = "知遇体验团队（虚构）"


@require_GET
def csrf(request):
    return JsonResponse(
        {
            "csrfToken": get_token(request),
            "local_environment": settings.DEBUG,
            "home_url": settings.PUBLIC_HOME_URL,
        }
    )


def csrf_failure(request, reason=""):
    return JsonResponse({"errors": {"detail": "页面安全凭证已过期，请刷新后重试。"}}, status=403)


def _feishu_configured():
    return all(
        [
            settings.FEISHU_APP_ID,
            settings.FEISHU_APP_SECRET,
            settings.FEISHU_REDIRECT_URI,
            settings.FEISHU_LOGIN_SUCCESS_URL,
        ]
    )


def _feishu_error(message, status=400):
    return JsonResponse({"errors": {"detail": message}}, status=status)


def safe_avatar_url(value):
    try:
        if not isinstance(value, str) or len(value) > 2048:
            raise ValidationError("无效的头像地址")
        URLValidator(schemes=["https"])(value)
        if parse.urlsplit(value).username is not None:
            raise ValidationError("头像地址不应包含凭据")
    except ValidationError:
        return ""
    return value


def _request_feishu_json(url, *, data=None, headers=None):
    payload = json.dumps(data).encode() if data is not None else None
    request_headers = {"Accept": "application/json"}
    if data is not None:
        request_headers["Content-Type"] = "application/json; charset=utf-8"
    if headers:
        request_headers.update(headers)
    try:
        with urlrequest.urlopen(
            urlrequest.Request(url, data=payload, headers=request_headers), timeout=10
        ) as response:
            parsed = json.loads(response.read().decode())
    except (error.URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _begin_feishu_login(request):
    if not _feishu_configured():
        return _feishu_error("飞书登录尚未完成本机配置，请联系系统管理员。", status=503)
    request_url = parse.urlsplit(request.build_absolute_uri())
    callback_url = parse.urlsplit(settings.FEISHU_REDIRECT_URI)
    if (request_url.scheme, request_url.netloc) != (callback_url.scheme, callback_url.netloc):
        return HttpResponseRedirect(settings.FEISHU_REDIRECT_URI)
    state = secrets.token_urlsafe(32)
    request.session["feishu_login_state"] = state
    query = parse.urlencode(
        {
            "app_id": settings.FEISHU_APP_ID,
            "redirect_uri": settings.FEISHU_REDIRECT_URI,
            "state": state,
        }
    )
    return HttpResponseRedirect(f"{settings.FEISHU_AUTHORIZE_URL}?{query}")


def _get_feishu_app_access_token():
    result = _request_feishu_json(
        settings.FEISHU_APP_ACCESS_TOKEN_URL,
        data={
            "app_id": settings.FEISHU_APP_ID,
            "app_secret": settings.FEISHU_APP_SECRET,
        },
    )
    if not result or result.get("code") != 0:
        return None
    access_token = result.get("app_access_token")
    return access_token if isinstance(access_token, str) and access_token else None


def _bootstrap_local_hr_identity(open_id):
    """仅允许本机开发环境的首个飞书账号绑定到显式指定的体验 HR。"""
    username = settings.FEISHU_LOCAL_BOOTSTRAP_HR_USERNAME
    if not settings.DEBUG or not username:
        return None
    with transaction.atomic():
        membership = (
            Membership.objects.select_for_update()
            .select_related("user")
            .filter(
                user__username=username,
                user__is_active=True,
                active=True,
                roles__role="hr",
            )
            .order_by("id")
            .first()
        )
        if not membership or FeishuIdentity.objects.filter(app_id=settings.FEISHU_APP_ID).exists():
            return None
        return FeishuIdentity.objects.create(
            user=membership.user,
            app_id=settings.FEISHU_APP_ID,
            open_id=open_id,
        )


def _finish_feishu_login(request):
    expected_state = request.session.pop("feishu_login_state", None)
    state = request.GET.get("state")
    code = request.GET.get("code")
    if not expected_state or not state or not secrets.compare_digest(expected_state, state):
        return _feishu_error("飞书登录已失效，请从首页重新开始。")
    if not code or len(code) > 4096:
        return _feishu_error("飞书未返回有效登录凭证，请重新开始。")
    app_access_token = _get_feishu_app_access_token()
    if not app_access_token:
        return _feishu_error("飞书应用验证失败，请检查本机应用凭证后重试。", status=502)
    token_result = _request_feishu_json(
        settings.FEISHU_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
        },
        headers={"Authorization": f"Bearer {app_access_token}"},
    )
    token_data = (
        token_result.get("data") if token_result and token_result.get("code") == 0 else None
    )
    access_token = token_data.get("access_token") if isinstance(token_data, dict) else None
    if not isinstance(access_token, str) or not access_token:
        return _feishu_error("飞书授权凭证验证失败，请从首页重新开始。", status=502)
    user_result = _request_feishu_json(
        settings.FEISHU_USER_INFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    user_data = user_result.get("data") if user_result and user_result.get("code") == 0 else None
    open_id = user_data.get("open_id") if isinstance(user_data, dict) else None
    if not isinstance(open_id, str) or not open_id:
        return _feishu_error("未能读取飞书账号信息，请确认应用已开通登录所需权限。", status=502)
    identity = (
        FeishuIdentity.objects.select_related("user")
        .filter(app_id=settings.FEISHU_APP_ID, open_id=open_id, user__is_active=True)
        .first()
    )
    if not identity:
        identity = _bootstrap_local_hr_identity(open_id)
    membership = (
        Membership.objects.filter(user=identity.user, active=True).order_by("id").first()
        if identity
        else None
    )
    if not membership:
        return _feishu_error("该飞书账号尚未获得招聘工作台权限，请联系管理员开通。", status=403)
    identity.union_id = str(user_data.get("union_id") or "")[:128]
    identity.display_name = str(user_data.get("name") or "")[:100]
    identity.avatar_url = safe_avatar_url(user_data.get("avatar_url"))
    identity.email = str(user_data.get("email") or "")[:254]
    identity.last_authenticated_at = timezone.now()
    identity.save(
        update_fields=[
            "union_id",
            "display_name",
            "avatar_url",
            "email",
            "last_authenticated_at",
            "updated_at",
        ]
    )
    login(request, identity.user)
    request.session["membership_id"] = membership.id
    request.session["feishu_identity_id"] = identity.id
    return HttpResponseRedirect(settings.FEISHU_LOGIN_SUCCESS_URL)


@require_http_methods(["GET", "POST"])
def sign_in(request):
    """GET 执行飞书 OAuth，保留 POST 本地账号入口供现有受控开发测试使用。"""
    if request.method == "GET":
        if request.GET.get("error"):
            return _feishu_error("你已取消或拒绝飞书登录，请重新开始。")
        return (
            _finish_feishu_login(request)
            if request.GET.get("code")
            else _begin_feishu_login(request)
        )
    return _password_sign_in(request)


@csrf_protect
def _password_sign_in(request):
    try:
        data = json.loads(request.body)
        username, password = data["username"], data["password"]
        if not isinstance(username, str) or not isinstance(password, str):
            raise ValueError
        if len(username) > 150 or len(password) > 1024:
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return JsonResponse({"errors": {"detail": "请填写账号和密码。"}}, status=400)
    now = timezone.now()
    # 同时限制来源及账号；对不存在的账号使用相同响应，避免枚举。
    for value in [request.META.get("REMOTE_ADDR", ""), "account:" + username.casefold()]:
        key = hashlib.sha256((settings.SECRET_KEY + value).encode()).hexdigest()
        with transaction.atomic():
            LoginRate.objects.get_or_create(key=key, defaults={"started_at": now})
            rate = LoginRate.objects.select_for_update().get(key=key)
            if now - rate.started_at >= timedelta(minutes=5):
                rate.attempts, rate.started_at = 0, now
            rate.attempts += 1
            rate.save()
            if rate.attempts > 30:
                return JsonResponse(
                    {"errors": {"detail": "尝试次数较多，请五分钟后再试。"}}, status=429
                )
    LoginRate.objects.filter(started_at__lt=now - timedelta(days=1)).delete()
    user = authenticate(request, username=username, password=password)
    membership = (
        Membership.objects.filter(user=user, active=True).order_by("id").first() if user else None
    )
    if not membership:
        return JsonResponse(
            {"errors": {"detail": "账号或密码不正确，或尚未获得工作台权限。"}}, status=400
        )
    login(request, user)
    request.session["membership_id"] = membership.id
    request.session.pop("feishu_identity_id", None)
    return JsonResponse({"csrfToken": get_token(request)})


@require_POST
@csrf_protect
def start_local_experience(request):
    """仅为本机产品演示建立固定虚构成员的会话。

    客户端选择的是体验身份，而不是可任意写入会话的权限；正式环境没有这个入口。
    """
    if not settings.DEBUG or not settings.LOCAL_EXPERIENCE_ENABLED:
        return JsonResponse({"errors": {"detail": "未找到此服务。"}}, status=404)
    try:
        role = json.loads(request.body)["role"]
        username, required_role = EXPERIENCE_ACCOUNTS[role]
    except (KeyError, TypeError, ValueError):
        return JsonResponse({"errors": {"detail": "请选择可用的体验身份。"}}, status=400)

    membership = (
        Membership.objects.select_related("user")
        .filter(
            user__username=username,
            user__is_active=True,
            active=True,
            organization__name=EXPERIENCE_ORGANIZATION,
            roles__role=required_role,
        )
        .order_by("id")
        .first()
    )
    if not membership:
        return JsonResponse(
            {"errors": {"detail": "本地体验账号尚未准备，请先启动体验服务后重试。"}},
            status=503,
        )
    login(request, membership.user)
    request.session["membership_id"] = membership.id
    request.session.pop("feishu_identity_id", None)
    return JsonResponse({"csrfToken": get_token(request), "role": role})


@require_POST
@csrf_protect
def sign_out(request):
    logout(request)
    return JsonResponse({"csrfToken": get_token(request), "redirect_url": settings.PUBLIC_HOME_URL})

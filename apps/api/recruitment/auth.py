import hashlib
import json
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.db import transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST

from .models import LoginRate, Membership


@require_GET
def csrf(request):
    return JsonResponse({"csrfToken": get_token(request), "local_environment": settings.DEBUG})


def csrf_failure(request, reason=""):
    return JsonResponse({"errors": {"detail": "页面安全凭证已过期，请刷新后重试。"}}, status=403)


@require_POST
@csrf_protect
def sign_in(request):
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
    return JsonResponse({"csrfToken": get_token(request)})


@require_POST
@csrf_protect
def sign_out(request):
    logout(request)
    return JsonResponse({"csrfToken": get_token(request)})

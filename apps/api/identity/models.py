from django.conf import settings
from django.db import models


class FeishuIdentity(models.Model):
    """将飞书应用内的用户标识绑定到系统中已获授权的账号。"""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    app_id = models.CharField(max_length=64)
    open_id = models.CharField(max_length=128)
    union_id = models.CharField(max_length=128, blank=True)
    display_name = models.CharField(max_length=100, blank=True)
    email = models.EmailField(blank=True)
    last_authenticated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["app_id", "open_id"], name="one_feishu_app_identity")
        ]

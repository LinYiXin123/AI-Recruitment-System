import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from recruitment.models import Department, DepartmentRole, Membership, Organization


class Command(BaseCommand):
    help = "仅本地开发环境创建标记为虚构的体验账号，不创建招聘业务记录。"

    @transaction.atomic
    def handle(self, *args, **options):
        password = os.environ.get("LOCAL_ACCOUNT_PASSWORD", "")
        if not settings.DEBUG or len(password) < 12:
            raise CommandError("仅 DEBUG 本地环境可用，且需提供至少 12 位 LOCAL_ACCOUNT_PASSWORD。")
        org, _ = Organization.objects.get_or_create(name="知遇体验团队（虚构）")
        d, _ = Department.objects.get_or_create(organization=org, name="产品研发部（虚构）")
        for username, name, role in [
            ("local_hr", "体验 HR", "hr"),
            ("local_manager", "体验负责人", "manager"),
            ("local_other_hr", "另一位 HR", "hr"),
        ]:
            user, created = get_user_model().objects.get_or_create(username=username)
            if created:
                user.first_name = name
                user.set_password(password)
                user.save()
            membership, _ = Membership.objects.get_or_create(user=user, organization=org)
            DepartmentRole.objects.get_or_create(membership=membership, department=d, role=role)
        self.stdout.write("本地体验账号已准备；已有账号密码未改动，未创建任何职位或候选人。")

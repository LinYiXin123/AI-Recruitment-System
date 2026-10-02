import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("recruitment", "0014_profile_ai_drafts")]

    operations = [
        migrations.AddField(
            model_name="job",
            name="enterprise",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="jobs",
                to="recruitment.enterprise",
            ),
        ),
        migrations.AddField(
            model_name="aiscreening",
            name="enterprise_snapshot",
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="EnterpriseIssue",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("request_key", models.UUIDField()),
                ("request_digest", models.CharField(max_length=64)),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("company_introduction", "公司简介"),
                            ("culture", "企业文化"),
                            ("benefits", "福利待遇"),
                            ("team", "团队介绍"),
                            ("office", "办公环境"),
                            ("history", "发展历程"),
                            ("recruiting", "招聘宣传"),
                        ],
                        max_length=32,
                    ),
                ),
                ("question", models.TextField(max_length=2000)),
                ("source_reference", models.CharField(blank=True, max_length=500)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "待核实"),
                            ("answered", "待反馈"),
                            ("closed", "已完成"),
                        ],
                        default="pending",
                        max_length=12,
                    ),
                ),
                ("answer", models.TextField(blank=True, max_length=4000)),
                ("answered_at", models.DateTimeField(blank=True, null=True)),
                ("follow_up_note", models.TextField(blank=True, max_length=2000)),
                ("closed_at", models.DateTimeField(blank=True, null=True)),
                ("version", models.PositiveIntegerField(default=1)),
                ("endorsement_snapshot", models.JSONField(blank=True, null=True)),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="recruitment.organization"
                    ),
                ),
                (
                    "enterprise",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="issues",
                        to="recruitment.enterprise",
                    ),
                ),
                (
                    "requester",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="recruitment.membership",
                    ),
                ),
                (
                    "assignee",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="recruitment.membership",
                    ),
                ),
                (
                    "endorsement",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="recruitment.enterpriseendorsement",
                    ),
                ),
            ],
            options={
                "ordering": ["-updated_at", "-id"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("organization", "requester", "request_key"),
                        name="one_enterprise_issue_request",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(version__gte=1), name="positive_issue_version"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(status__in=["pending", "answered", "closed"]),
                        name="valid_enterprise_issue_status",
                    ),
                ],
            },
        ),
    ]

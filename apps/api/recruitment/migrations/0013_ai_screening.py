import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("recruitment", "0012_question_bank")]

    operations = [
        migrations.CreateModel(
            name="AIScreening",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("candidate_name", models.CharField(blank=True, max_length=120)),
                ("job_title", models.CharField(blank=True, max_length=120)),
                ("enterprise_name", models.CharField(blank=True, max_length=100)),
                ("request_key", models.UUIDField()),
                ("input_digest", models.CharField(max_length=64)),
                ("result", models.JSONField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                (
                    "application",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        to="recruitment.application",
                    ),
                ),
                (
                    "creator",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="recruitment.membership"
                    ),
                ),
                (
                    "enterprise",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        to="recruitment.enterprise",
                    ),
                ),
                (
                    "job",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        to="recruitment.job",
                    ),
                ),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="recruitment.organization"
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(
                        fields=["organization", "creator", "deleted_at"], name="ai_screening_owner"
                    )
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("organization", "creator", "request_key"),
                        name="one_ai_screening_request",
                    )
                ],
            },
        ),
    ]

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("recruitment", "0015_enterprise_coordination")]

    operations = [
        migrations.AddField(
            model_name="aiscreening",
            name="source_context",
            field=models.JSONField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="aiscreening",
            name="profile",
            field=models.ForeignKey(
                to="recruitment.profileversion",
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.PROTECT,
            ),
        ),
        migrations.AddField(
            model_name="aiscreening",
            name="resume_parse",
            field=models.ForeignKey(
                to="recruitment.resumeparse",
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.PROTECT,
            ),
        ),
        migrations.CreateModel(
            name="AIScreeningVerification",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("question_index", models.PositiveSmallIntegerField()),
                ("version", models.PositiveIntegerField()),
                (
                    "status",
                    models.CharField(
                        max_length=16,
                        choices=[
                            ("pending", "待核实"),
                            ("supported", "有证据支持"),
                            ("contradicted", "存在矛盾"),
                            ("unresolved", "仍待补充"),
                            ("withdrawn", "已撤回采用"),
                        ],
                    ),
                ),
                ("answer", models.TextField(max_length=5000, blank=True)),
                ("evidence", models.TextField(max_length=3000, blank=True)),
                ("next_step", models.CharField(max_length=1000, blank=True)),
                ("contact_name", models.CharField(max_length=120, blank=True)),
                ("due_on", models.DateField(null=True, blank=True)),
                ("recorder_name", models.CharField(max_length=120)),
                ("request_key", models.UUIDField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "recorder",
                    models.ForeignKey(
                        to="recruitment.membership", on_delete=django.db.models.deletion.PROTECT
                    ),
                ),
                (
                    "screening",
                    models.ForeignKey(
                        to="recruitment.aiscreening",
                        related_name="verifications",
                        on_delete=django.db.models.deletion.PROTECT,
                    ),
                ),
            ],
            options={
                "ordering": ["question_index", "-version"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=["screening", "question_index", "version"],
                        name="screening_question_revision",
                    ),
                    models.UniqueConstraint(
                        fields=["screening", "request_key"], name="screening_verification_request"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(version__gte=1, question_index__lt=5),
                        name="screening_verification_index",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            status__in=[
                                "pending",
                                "supported",
                                "contradicted",
                                "unresolved",
                                "withdrawn",
                            ]
                        ),
                        name="screening_verification_status",
                    ),
                ],
            },
        ),
    ]

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("recruitment", "0020_candidate_deletion")]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="feishu_app_id",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
        migrations.AddConstraint(
            model_name="organization",
            constraint=models.UniqueConstraint(
                fields=("feishu_app_id",),
                condition=~models.Q(feishu_app_id=""),
                name="one_organization_per_feishu_app",
            ),
        ),
        migrations.AddField(
            model_name="department",
            name="feishu_open_department_id",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
        migrations.AddField(
            model_name="department",
            name="parent",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="children",
                to="recruitment.department",
            ),
        ),
        migrations.RemoveConstraint(model_name="department", name="department_name"),
        migrations.AddConstraint(
            model_name="department",
            constraint=models.UniqueConstraint(
                fields=("organization", "name"),
                condition=models.Q(feishu_open_department_id=""),
                name="department_name",
            ),
        ),
        migrations.AddConstraint(
            model_name="department",
            constraint=models.UniqueConstraint(
                fields=("organization", "feishu_open_department_id"),
                condition=~models.Q(feishu_open_department_id=""),
                name="one_feishu_department_per_org",
            ),
        ),
    ]

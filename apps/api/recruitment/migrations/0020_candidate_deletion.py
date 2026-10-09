import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("recruitment", "0019_job_recruitment_sites")]

    operations = [
        migrations.AddField(
            model_name="candidate",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="candidate",
            name="deleted_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="deleted_candidates",
                to="recruitment.membership",
            ),
        ),
    ]

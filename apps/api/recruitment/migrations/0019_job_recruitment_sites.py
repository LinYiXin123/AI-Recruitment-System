from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("recruitment", "0018_candidate_resume_preview"),
    ]

    operations = [
        migrations.AddField(
            model_name="job",
            name="recruitment_sites",
            field=models.JSONField(blank=True, default=list),
        ),
    ]

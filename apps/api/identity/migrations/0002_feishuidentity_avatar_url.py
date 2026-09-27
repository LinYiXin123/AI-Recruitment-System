from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("identity", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="feishuidentity",
            name="avatar_url",
            field=models.URLField(blank=True, max_length=2048),
        ),
    ]

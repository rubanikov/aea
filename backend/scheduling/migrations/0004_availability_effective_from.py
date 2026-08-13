"""Adds `Availability.effective_from` -- the calendar date a schedule
generation takes effect (see the field's comment in models.py).

Deliberately no data backfill: every existing row keeps NULL, which marks
the baseline generation, so slot computation and the availability API
behave exactly as before until a provider saves a dated schedule change.
The `nulls_first` ordering and the (provider, effective_from, day_of_week)
index land here so generation lookups are cheap from day one.
"""

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('scheduling', '0003_fixed_60_minute_duration'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='availability',
            options={'ordering': [models.OrderBy(models.F('effective_from'), nulls_first=True), 'day_of_week', 'start_time']},
        ),
        migrations.AddField(
            model_name='availability',
            name='effective_from',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name='availability',
            index=models.Index(fields=['provider', 'effective_from', 'day_of_week'], name='availability_provider_gen_idx'),
        ),
    ]

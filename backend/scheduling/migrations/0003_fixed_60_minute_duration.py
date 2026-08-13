"""Every appointment is now a fixed 60-minute slot (product decision --
"let's make all appointments 1 hour"). `AppointmentType` stays as a
name-only category; only its duration stops being configurable.

Order matters: existing rows (e.g. the `seed_demo` cohort's 10-60 minute
types in a local dev database) are normalized to 60 *before* the
`CheckConstraint` lands, so adding the constraint never fails against
pre-existing data.

Existing `Booking` rows are deliberately left untouched: a booking stores
its own independent `start_time`/`end_time` span (derived from the type's
duration *at creation time* -- see `bookings/models.py`), so old rows are
historical facts made under the old rules. Stretching them to 60 minutes
here could manufacture overlaps between neighbouring bookings on a
provider's day (the DB only guards identical start times, not overlapping
spans), which is strictly worse than a short historical booking under a
now-60-minute type.
"""

from django.db import migrations, models
from django.db.models import Q


def normalize_durations_to_60(apps, schema_editor):
    AppointmentType = apps.get_model("scheduling", "AppointmentType")
    AppointmentType.objects.exclude(duration_minutes=60).update(duration_minutes=60)


class Migration(migrations.Migration):
    dependencies = [
        ("scheduling", "0002_blockedtime"),
    ]

    operations = [
        # Reverse is a no-op: the pre-normalization durations are gone once
        # overwritten, and 60 is a valid value under the old schema anyway.
        migrations.RunPython(normalize_durations_to_60, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="appointmenttype",
            name="duration_minutes",
            field=models.PositiveIntegerField(default=60),
        ),
        migrations.AddConstraint(
            model_name="appointmenttype",
            constraint=models.CheckConstraint(
                condition=Q(duration_minutes=60),
                name="appointment_type_duration_is_60",
            ),
        ),
    ]

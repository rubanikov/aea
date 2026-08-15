"""Providers may now choose an appointment type's slot length: 30 or 60
minutes (exactly those two choices -- a product decision loosening
0003_fixed_60_minute_duration's single fixed value). The 60-only
`CheckConstraint` is swapped for a two-value one; the default stays 60.

No data migration is needed in either direction: every existing row is 60
(0003 normalized them and its constraint kept them there), and 60 is a
valid value under both the old and new constraint. Existing `Booking` rows
are untouched for the same reason 0003 left them alone -- a booking stores
its own `start_time`/`end_time` span derived at creation time.

The mixed-duration double-booking gap this opens (a 60-minute booking at
09:00 and a 30-minute one at 09:30 overlap without sharing a start_time,
so the partial unique constraints alone no longer backstop the race) is
closed by `bookings/migrations/0005_no_overlapping_active_bookings.py`'s
exclusion constraints -- which is why that migration lands alongside this
one.
"""

from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ("scheduling", "0004_availability_effective_from"),
        # The overlap gap must be closed *before* the first 30-minute type
        # can exist: the exclusion constraints land first, then durations
        # open up.
        ("bookings", "0005_no_overlapping_active_bookings"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="appointmenttype",
            name="appointment_type_duration_is_60",
        ),
        migrations.AddConstraint(
            model_name="appointmenttype",
            constraint=models.CheckConstraint(
                condition=Q(duration_minutes__in=[30, 60]),
                name="appointment_type_duration_in_30_60",
            ),
        ),
    ]

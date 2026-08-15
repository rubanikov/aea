"""Close the mixed-duration double-booking gap before
`scheduling/migrations/0005_duration_choice_30_or_60.py` (which depends on
this migration) opens it.

With a single 60-minute duration on an aligned grid, any true overlap
between two bookings implied an identical `start_time`, so the partial
unique constraints (0001, 0004) fully backstopped the `select_for_update`
race -- two brand-new rows, nothing committed yet to lock, still couldn't
both land. With 30- and 60-minute types coexisting that is no longer true:
a 60-minute booking at 09:00 and a 30-minute one at 09:30 overlap without
sharing a start_time, and two such inserts racing would slip past both
existing guards. Postgres exclusion constraints over
`TSTZRANGE(start_time, end_time)` (btree_gist for the equality column)
refuse the second overlapping active insert on each axis -- provider and
patient -- whatever the two spans' shapes.

The data migration first cancels any active booking that overlaps an
earlier-starting active one on either axis (keeping the earliest row, same
keep-the-earliest rule as 0004's dedup), so the constraints can be created
against existing demo/seed data. Under the guards that produced that data
no such overlap should exist; this is belt-and-braces for hand-edited
local databases.

`BtreeGistExtension` needs database privileges to `CREATE EXTENSION`; the
project's dev/CI Postgres runs as a superuser (see `.env.example` /
`.github/workflows/ci.yml`), matching how this is normally deployed.
"""

from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import RangeOperators
from django.contrib.postgres.operations import BtreeGistExtension
from django.db import migrations
from django.db.models import Q

import bookings.models

ACTIVE = ("requested", "confirmed")


def cancel_overlapping_active_bookings(apps, schema_editor):
    Booking = apps.get_model("bookings", "Booking")
    for axis in ("provider_id", "patient_id"):
        covered_until = {}
        for booking in Booking.objects.filter(status__in=ACTIVE).order_by(
            axis, "start_time", "id"
        ):
            key = getattr(booking, axis)
            frontier = covered_until.get(key)
            if frontier is not None and booking.start_time < frontier:
                booking.status = "cancelled"
                booking.save(update_fields=["status"])
                continue
            covered_until[key] = booking.end_time


class Migration(migrations.Migration):
    dependencies = [
        ("bookings", "0004_unique_active_booking_per_patient_slot"),
    ]

    operations = [
        BtreeGistExtension(),
        # Reverse is a no-op, same reasoning as 0004: the cancelled rows'
        # prior statuses are gone once overwritten, and "cancelled" is a
        # valid status under the old schema anyway.
        migrations.RunPython(cancel_overlapping_active_bookings, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="booking",
            constraint=ExclusionConstraint(
                condition=Q(status__in=["requested", "confirmed"]),
                expressions=[
                    (
                        bookings.models.TsTzRange("start_time", "end_time"),
                        RangeOperators.OVERLAPS,
                    ),
                    ("provider", RangeOperators.EQUAL),
                ],
                name="no_overlapping_active_booking_per_provider",
            ),
        ),
        migrations.AddConstraint(
            model_name="booking",
            constraint=ExclusionConstraint(
                condition=Q(status__in=["requested", "confirmed"]),
                expressions=[
                    (
                        bookings.models.TsTzRange("start_time", "end_time"),
                        RangeOperators.OVERLAPS,
                    ),
                    ("patient", RangeOperators.EQUAL),
                ],
                name="no_overlapping_active_booking_per_patient",
            ),
        ),
    ]

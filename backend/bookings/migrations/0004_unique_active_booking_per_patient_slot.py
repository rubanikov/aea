from django.db import migrations, models
from django.db.models import Count, Q

ACTIVE = ("requested", "confirmed")


def cancel_duplicate_patient_hour_bookings(apps, schema_editor):
    """Keep the earliest active booking per (patient, start_time) and
    cancel the rest so the unique index below can be created against
    existing demo/seed rows that stacked the same hour across providers.
    """
    Booking = apps.get_model("bookings", "Booking")
    duplicates = (
        Booking.objects.filter(status__in=ACTIVE)
        .values("patient_id", "start_time")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
    )
    for row in duplicates:
        ids = list(
            Booking.objects.filter(
                patient_id=row["patient_id"],
                start_time=row["start_time"],
                status__in=ACTIVE,
            )
            .order_by("id")
            .values_list("id", flat=True)
        )
        Booking.objects.filter(pk__in=ids[1:]).update(status="cancelled")


class Migration(migrations.Migration):

    dependencies = [
        ("bookings", "0003_cancellationnotificationlog"),
    ]

    operations = [
        migrations.RunPython(cancel_duplicate_patient_hour_bookings, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="booking",
            constraint=models.UniqueConstraint(
                condition=Q(status__in=["requested", "confirmed"]),
                fields=("patient", "start_time"),
                name="unique_active_booking_per_patient_slot",
            ),
        ),
    ]

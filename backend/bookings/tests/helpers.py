from datetime import timedelta

from bookings.models import Booking
from scheduling.models import AppointmentType, Availability
from scheduling.tests.helpers import SchedulingAPITestCase

__all__ = ["BookingsAPITestCase"]


class BookingsAPITestCase(SchedulingAPITestCase):
    """API-seam test base for the `bookings` app. Reuses
    `SchedulingAPITestCase`'s provider/patient creation, `login_as`, and
    `post_json` helpers rather than duplicating them -- a booking always
    needs a provider with configured availability and an appointment type,
    exactly what `scheduling`'s own tests already set up.
    """

    def setup_bookable_provider(self, *, timezone="UTC", duration_minutes=60, **overrides):
        provider = self.create_provider(timezone=timezone, **overrides)
        Availability.objects.create(
            provider=provider, day_of_week=0, start_time="09:00", end_time="17:00"
        )
        appointment_type = AppointmentType.objects.create(
            provider=provider, name="Follow-up", duration_minutes=duration_minutes
        )
        return provider, appointment_type

    def make_booking(
        self, *, provider, patient, appointment_type, start_time, status=Booking.Status.CONFIRMED
    ):
        """Creates a `Booking` row directly, bypassing
        `bookings.services.create_booking`'s open-slot re-validation --
        for tests (TICKET-08's transition/status-API tests) that need a
        fixture booking in an arbitrary status/start_time, e.g. a
        past-dated `confirmed` booking for `no_show` timing rules, which
        the real creation flow would reject outright (`SlotNotOpen`, a
        start_time in the past). Not a substitute for
        `test_booking_creation_api.py`'s tests of that flow itself.
        """
        return Booking.objects.create(
            provider=provider,
            patient=patient,
            appointment_type=appointment_type,
            start_time=start_time,
            end_time=start_time + timedelta(minutes=appointment_type.duration_minutes),
            status=status,
        )

    def post_booking(self, *, provider, appointment_type, start_time, idempotency_key=None):
        extra = {}
        if idempotency_key is not None:
            extra["HTTP_IDEMPOTENCY_KEY"] = idempotency_key
        return self.post_json(
            "/bookings",
            {
                "provider_id": provider.id,
                "appointment_type_id": appointment_type.id,
                "start_time": start_time,
            },
            **extra,
        )

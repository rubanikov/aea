from datetime import datetime
from datetime import timezone as dt_timezone

from scheduling.tests.helpers import SchedulingAPITestCase

__all__ = ["RemindersTestCase", "utc"]


def utc(*args):
    return datetime(*args, tzinfo=dt_timezone.utc)


class RemindersTestCase(SchedulingAPITestCase):
    """Test base for the `reminders` app. Reuses `SchedulingAPITestCase`'s
    provider/patient/booking creation (a reminder always needs an existing
    `Booking` row) -- exactly what `scheduling`'s and `bookings`' own tests
    already build fixtures with, via that base class's `create_booking`
    (bypasses `bookings.services.create_booking`'s open-slot
    re-validation, same as `bookings.tests.helpers.BookingsAPITestCase
    .make_booking` -- these tests only need a booking row in a given
    status/start_time, not to re-exercise booking creation itself).
    """

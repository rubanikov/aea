from django.contrib.admin.sites import AdminSite
from django.test import TestCase

from bookings.admin import BookingAdmin
from bookings.models import Booking


class BookingAdminIsReadOnlyTests(TestCase):
    def setUp(self):
        self.admin = BookingAdmin(Booking, AdminSite())

    def test_add_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_add_permission(request=None))

    def test_change_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_change_permission(request=None))

    def test_delete_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_delete_permission(request=None))

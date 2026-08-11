from django.contrib.admin.sites import AdminSite
from django.test import TestCase

from scheduling.admin import AppointmentTypeAdmin, AvailabilityAdmin, BlockedTimeAdmin
from scheduling.models import AppointmentType, Availability, BlockedTime


class AvailabilityAdminIsReadOnlyTests(TestCase):
    def setUp(self):
        self.admin = AvailabilityAdmin(Availability, AdminSite())

    def test_add_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_add_permission(request=None))

    def test_change_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_change_permission(request=None))

    def test_delete_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_delete_permission(request=None))


class AppointmentTypeAdminIsReadOnlyTests(TestCase):
    def setUp(self):
        self.admin = AppointmentTypeAdmin(AppointmentType, AdminSite())

    def test_add_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_add_permission(request=None))

    def test_change_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_change_permission(request=None))

    def test_delete_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_delete_permission(request=None))


class BlockedTimeAdminIsReadOnlyTests(TestCase):
    def setUp(self):
        self.admin = BlockedTimeAdmin(BlockedTime, AdminSite())

    def test_add_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_add_permission(request=None))

    def test_change_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_change_permission(request=None))

    def test_delete_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_delete_permission(request=None))

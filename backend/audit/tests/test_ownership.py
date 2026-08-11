from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase

from audit.models import AuditLog
from audit.ownership import resource_owner, target_type_for, user_owns_or_is_admin

from .dummy_resources import DummyAvailability, DummyBooking, DummyUnconfigured

User = get_user_model()


class UserOwnsOrIsAdminTests(TestCase):
    """`user_owns_or_is_admin` is the plain-function half of the
    ownership-check utility (for non-DRF-view callers) -- `IsOwnerOrAdmin`
    (see test_permissions.py) is a thin DRF adapter around this same
    function, so its ownership/admin/reject decisions are unit-tested
    here once."""

    def setUp(self):
        self.owner = User.objects.create_user(
            email="owner@example.com", password="x", role=User.Role.PATIENT
        )
        self.stranger = User.objects.create_user(
            email="stranger@example.com", password="x", role=User.Role.PATIENT
        )
        self.admin = User.objects.create_user(
            email="admin@example.com", password="x", role=User.Role.ADMIN
        )

    def test_allows_the_owner_and_writes_no_audit_entry(self):
        booking = DummyBooking(pk=1, owner=self.owner)

        allowed = user_owns_or_is_admin(self.owner, booking, action="view_booking")

        self.assertTrue(allowed)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_allows_the_owner_via_the_owner_field_name_convention(self):
        availability = DummyAvailability(pk=1, provider=self.owner)

        allowed = user_owns_or_is_admin(self.owner, availability, action="view_availability")

        self.assertTrue(allowed)

    def test_denies_a_non_owner_non_admin_and_writes_no_audit_entry(self):
        booking = DummyBooking(pk=1, owner=self.owner)

        allowed = user_owns_or_is_admin(self.stranger, booking, action="view_booking")

        self.assertFalse(allowed)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_allows_an_admin_who_is_not_the_owner_and_logs_the_bypass(self):
        booking = DummyBooking(pk=42, owner=self.owner)

        allowed = user_owns_or_is_admin(self.admin, booking, action="view_booking")

        self.assertTrue(allowed)
        entry = AuditLog.objects.get()
        self.assertEqual(entry.actor, self.admin)
        self.assertEqual(entry.action, "admin_bypass:view_booking")
        self.assertEqual(entry.target_type, "booking")
        self.assertEqual(entry.target_id, "42")

    def test_an_admin_accessing_their_own_resource_is_not_logged_as_a_bypass(self):
        booking = DummyBooking(pk=1, owner=self.admin)

        allowed = user_owns_or_is_admin(self.admin, booking, action="view_booking")

        self.assertTrue(allowed)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_raises_if_the_resource_implements_neither_ownership_convention(self):
        unconfigured = DummyUnconfigured(pk=1)

        with self.assertRaises(ImproperlyConfigured):
            user_owns_or_is_admin(self.stranger, unconfigured, action="view_thing")


class ResourceOwnerTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="owner2@example.com", password="x")

    def test_prefers_get_owner_when_both_conventions_are_present(self):
        class Both:
            owner_field_name = "wrong_field"

            def get_owner(self_inner):
                return self.owner

        self.assertEqual(resource_owner(Both()), self.owner)


class TargetTypeForTests(TestCase):
    def test_defaults_to_the_lowercased_class_name(self):
        class Widget:
            pk = 1

        self.assertEqual(target_type_for(Widget()), "widget")

    def test_uses_an_explicit_audit_target_type_when_set(self):
        booking = DummyBooking(pk=1, owner=None)

        self.assertEqual(target_type_for(booking), "booking")

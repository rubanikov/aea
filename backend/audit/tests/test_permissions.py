from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase

from audit.models import AuditLog
from audit.permissions import IsOwnerOrAdmin

from .dummy_resources import DummyBooking

User = get_user_model()


class AnonymousUser:
    is_authenticated = False


def _request(user, method="GET"):
    return SimpleNamespace(user=user, method=method)


class IsOwnerOrAdminTests(TestCase):
    """DRF-seam counterpart to test_ownership.py -- `IsOwnerOrAdmin` is a
    thin adapter over `audit.ownership.user_owns_or_is_admin`, exercised
    here as a real `rest_framework.permissions.BasePermission` the way a
    view would use it."""

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
        self.permission = IsOwnerOrAdmin()

    def test_has_permission_denies_an_unauthenticated_user(self):
        self.assertFalse(self.permission.has_permission(_request(AnonymousUser()), None))

    def test_has_permission_allows_any_authenticated_user_through_to_the_object_check(self):
        self.assertTrue(self.permission.has_permission(_request(self.stranger), None))

    def test_has_object_permission_allows_the_owner(self):
        booking = DummyBooking(pk=1, owner=self.owner)

        allowed = self.permission.has_object_permission(_request(self.owner), None, booking)

        self.assertTrue(allowed)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_has_object_permission_denies_a_non_owner_non_admin(self):
        booking = DummyBooking(pk=1, owner=self.owner)

        allowed = self.permission.has_object_permission(_request(self.stranger), None, booking)

        self.assertFalse(allowed)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_has_object_permission_allows_an_admin_and_logs_the_bypass(self):
        booking = DummyBooking(pk=7, owner=self.owner)

        allowed = self.permission.has_object_permission(
            _request(self.admin, method="GET"), None, booking
        )

        self.assertTrue(allowed)
        entry = AuditLog.objects.get()
        self.assertEqual(entry.actor, self.admin)
        self.assertEqual(entry.action, "admin_bypass:get:booking")
        self.assertEqual(entry.target_type, "booking")
        self.assertEqual(entry.target_id, "7")

    def test_uses_the_views_audit_action_when_it_sets_one(self):
        booking = DummyBooking(pk=7, owner=self.owner)
        view = SimpleNamespace(audit_action="cancel")

        self.permission.has_object_permission(
            _request(self.admin, method="POST"), view, booking
        )

        entry = AuditLog.objects.get()
        self.assertEqual(entry.action, "admin_bypass:cancel:booking")

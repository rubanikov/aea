from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.permissions import HasRole

User = get_user_model()


def _request_for(user):
    return SimpleNamespace(user=user)


class AnonymousUser:
    is_authenticated = False


class HasRoleTests(TestCase):
    """`HasRole` is the reusable role-check primitive (TICKET-03 builds
    row-level ownership on top of it); these are unit tests directly against
    it since this ticket has no role-restricted resource yet to exercise it
    through the HTTP seam."""

    def setUp(self):
        self.patient = User.objects.create_user(
            email="patient@example.com", password="x", role=User.Role.PATIENT
        )
        self.provider = User.objects.create_user(
            email="provider@example.com", password="x", role=User.Role.PROVIDER
        )
        self.admin = User.objects.create_user(
            email="admin@example.com", password="x", role=User.Role.ADMIN
        )

    def test_allows_a_user_with_a_matching_role(self):
        permission = HasRole(User.Role.PROVIDER)

        self.assertTrue(permission.has_permission(_request_for(self.provider), None))

    def test_denies_a_user_with_a_non_matching_role(self):
        permission = HasRole(User.Role.PROVIDER)

        self.assertFalse(permission.has_permission(_request_for(self.patient), None))

    def test_accepts_multiple_allowed_roles(self):
        permission = HasRole(User.Role.PROVIDER, User.Role.ADMIN)

        self.assertTrue(permission.has_permission(_request_for(self.provider), None))
        self.assertTrue(permission.has_permission(_request_for(self.admin), None))
        self.assertFalse(permission.has_permission(_request_for(self.patient), None))

    def test_denies_an_unauthenticated_user(self):
        permission = HasRole(User.Role.PATIENT)

        self.assertFalse(permission.has_permission(_request_for(AnonymousUser()), None))

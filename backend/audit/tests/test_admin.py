from django.contrib.admin.sites import AdminSite
from django.test import TestCase

from audit.admin import AuditLogAdmin
from audit.models import AuditLog


class AuditLogAdminIsReadOnlyTests(TestCase):
    def setUp(self):
        self.admin = AuditLogAdmin(AuditLog, AdminSite())

    def test_add_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_add_permission(request=None))

    def test_change_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_change_permission(request=None))

    def test_delete_permission_is_always_denied(self):
        self.assertFalse(self.admin.has_delete_permission(request=None))

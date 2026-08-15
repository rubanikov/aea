from datetime import datetime
from datetime import timezone as dt_timezone
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from audit.models import AuditLog

from .helpers import AJAX_HEADERS, login_as

User = get_user_model()


def _at(iso_string):
    return datetime.fromisoformat(iso_string).replace(tzinfo=dt_timezone.utc)


class AuditLogListViewAccessTests(TestCase):
    """`GET /audit-log` -- admin-only, per this ticket's accept criteria
    ("non-admin cannot access it at all")."""

    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@example.com", password="x", role=User.Role.ADMIN
        )
        self.patient = User.objects.create_user(
            email="patient@example.com", password="x", role=User.Role.PATIENT
        )

    def test_anonymous_request_is_rejected(self):
        response = self.client.get("/audit-log")

        self.assertEqual(response.status_code, 401)

    def test_non_admin_request_is_rejected(self):
        login_as(self.client, self.patient)

        response = self.client.get("/audit-log")

        self.assertEqual(response.status_code, 403)

    def test_admin_request_succeeds(self):
        login_as(self.client, self.admin)

        response = self.client.get("/audit-log")

        self.assertEqual(response.status_code, 200)

    def test_no_update_or_delete_route_is_registered(self):
        login_as(self.client, self.admin)

        patch_response = self.client.patch(
            "/audit-log", {}, content_type="application/json", **AJAX_HEADERS
        )
        delete_response = self.client.delete("/audit-log", **AJAX_HEADERS)
        put_response = self.client.put(
            "/audit-log", {}, content_type="application/json", **AJAX_HEADERS
        )

        self.assertEqual(patch_response.status_code, 405)
        self.assertEqual(delete_response.status_code, 405)
        self.assertEqual(put_response.status_code, 405)


class AuditLogListViewResponseShapeTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin2@example.com", password="x", role=User.Role.ADMIN
        )
        login_as(self.client, self.admin)
        self.entry = AuditLog.objects.create(
            actor=self.admin,
            action="status:requested->confirmed",
            target_type="booking",
            target_id="123",
            metadata={"previous_status": "requested"},
        )

    def test_response_matches_the_frontends_paginated_shape(self):
        response = self.client.get("/audit-log")

        body = response.json()
        self.assertEqual(set(body.keys()), {"results", "count", "page", "page_size"})
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["page"], 1)

    def test_entry_shape_is_id_only_with_no_nested_actor_details(self):
        response = self.client.get("/audit-log")

        row = response.json()["results"][0]
        self.assertEqual(
            set(row.keys()),
            {"id", "actor", "action", "target_type", "target_id", "timestamp", "metadata"},
        )
        self.assertEqual(row["actor"], str(self.admin.pk))
        self.assertEqual(row["target_id"], "123")
        self.assertIsInstance(row["id"], str)

    def test_null_actor_serializes_as_null_not_a_missing_field(self):
        AuditLog.objects.create(
            actor=None, action="system:x", target_type="booking", target_id="9"
        )

        response = self.client.get("/audit-log", {"target_type": "booking", "action": "system"})

        row = response.json()["results"][0]
        self.assertIsNone(row["actor"])


class AuditLogListViewFilteringTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin3@example.com", password="x", role=User.Role.ADMIN
        )
        self.other_actor = User.objects.create_user(
            email="provider@example.com", password="x", role=User.Role.PROVIDER
        )
        login_as(self.client, self.admin)

        self.booking_entry = AuditLog.objects.create(
            actor=self.admin,
            action="status:requested->confirmed",
            target_type="booking",
            target_id="1",
        )
        # Backdate one entry so date-range filters have something to
        # separate from "today". `timestamp` is `auto_now_add` (it reads
        # `timezone.now()` at insert) and `AuditLog` is enforced
        # append-only (`AuditLogIsAppendOnly` -- no post-hoc
        # `.update()`), so the row has to be *born* in the past rather
        # than rewritten into it.
        with mock.patch("django.utils.timezone.now", return_value=_at("2020-01-01T00:00:00")):
            self.availability_entry = AuditLog.objects.create(
                actor=self.other_actor,
                action="availability:updated",
                target_type="availability",
                target_id="2",
            )

    def _ids(self, response):
        return {row["id"] for row in response.json()["results"]}

    def test_filters_by_actor(self):
        response = self.client.get("/audit-log", {"actor": self.admin.pk})

        self.assertEqual(self._ids(response), {str(self.booking_entry.pk)})

    def test_rejects_a_non_integer_actor_filter(self):
        response = self.client.get("/audit-log", {"actor": "not-an-id"})

        self.assertEqual(response.status_code, 400)

    def test_filters_by_action_substring(self):
        response = self.client.get("/audit-log", {"action": "requested"})

        self.assertEqual(self._ids(response), {str(self.booking_entry.pk)})

    def test_filters_by_target_type(self):
        response = self.client.get("/audit-log", {"target_type": "availability"})

        self.assertEqual(self._ids(response), {str(self.availability_entry.pk)})

    def test_filters_by_date_range_excludes_entries_outside_it(self):
        response = self.client.get(
            "/audit-log", {"date_from": "2026-01-01", "date_to": "2026-12-31"}
        )

        self.assertEqual(self._ids(response), {str(self.booking_entry.pk)})

    def test_date_range_is_inclusive_of_the_whole_named_day(self):
        backdated_day = self.availability_entry
        backdated_day.refresh_from_db()
        day = backdated_day.timestamp.date().isoformat()

        response = self.client.get("/audit-log", {"date_from": day, "date_to": day})

        self.assertEqual(self._ids(response), {str(self.availability_entry.pk)})

    def test_rejects_an_unparseable_date_filter(self):
        response = self.client.get("/audit-log", {"date_from": "not-a-date"})

        self.assertEqual(response.status_code, 400)

    def test_combining_filters_narrows_further(self):
        response = self.client.get(
            "/audit-log", {"target_type": "booking", "actor": self.other_actor.pk}
        )

        self.assertEqual(self._ids(response), set())


class AuditLogReadIsItselfAuditedTests(TestCase):
    """Security-audit finding: reads of the audit trail itself must leave
    a trace -- every successful `GET /audit-log` writes one
    `read:audit_log` entry (see `AuditLogListView.list`), and a rejected
    request writes nothing."""

    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin4@example.com", password="x", role=User.Role.ADMIN
        )
        self.patient = User.objects.create_user(
            email="patient4@example.com", password="x", role=User.Role.PATIENT
        )

    def test_an_admin_read_writes_a_read_audit_log_entry(self):
        login_as(self.client, self.admin)

        response = self.client.get("/audit-log")

        self.assertEqual(response.status_code, 200)
        entry = AuditLog.objects.get(action="read:audit_log")
        self.assertEqual(entry.actor_id, self.admin.pk)
        self.assertEqual(entry.target_type, "audit_log")
        self.assertEqual(entry.target_id, "*")
        self.assertIsNone(entry.metadata)

    def test_the_read_entry_is_not_included_in_its_own_response(self):
        login_as(self.client, self.admin)

        response = self.client.get("/audit-log")

        self.assertEqual(response.json()["count"], 0)
        # ... but a *subsequent* read sees the previous one's entry.
        second = self.client.get("/audit-log")
        self.assertEqual(second.json()["count"], 1)
        self.assertEqual(second.json()["results"][0]["action"], "read:audit_log")

    def test_a_rejected_read_writes_no_entry(self):
        login_as(self.client, self.patient)

        response = self.client.get("/audit-log")

        self.assertEqual(response.status_code, 403)
        self.assertFalse(AuditLog.objects.filter(action="read:audit_log").exists())

    def test_a_read_with_an_invalid_filter_writes_no_entry(self):
        login_as(self.client, self.admin)

        response = self.client.get("/audit-log", {"actor": "not-an-id"})

        self.assertEqual(response.status_code, 400)
        self.assertFalse(AuditLog.objects.filter(action="read:audit_log").exists())

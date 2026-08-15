from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken

from audit.models import AuditLog

from .helpers import TEST_PASSWORD, AuthAPITestCase

User = get_user_model()


class AccountDeletionTests(AuthAPITestCase):
    """`POST /profile/delete-account` — TICKET-14. Scrubs PHI in place
    (never a hard delete — see `accounts.models.User.deleted_at`), requires
    the current password as server-side proof of intent, and logs the
    acting session out the same way `POST /auth/logout` does."""

    def setUp(self):
        self.register()
        self.login()
        self.user = User.objects.get(email="patient@example.com")

    def test_scrubs_phi_fields_sets_deleted_at_and_unusable_password(self):
        # Give the account every optional contact field so the scrub has
        # something real to clear, including the SMS carrier that pairs
        # with `phone` for the cancellation-notice gateway.
        self.user.phone = "+1 555 010 0100"
        self.user.sms_carrier = User.Carrier.VERIZON
        self.user.save(update_fields=["phone", "sms_carrier"])

        response = self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.name, "")
        self.assertEqual(self.user.phone, "")
        self.assertEqual(self.user.sms_carrier, "")
        self.assertEqual(self.user.email, f"deleted-user-{self.user.id}@deleted.invalid")
        self.assertFalse(self.user.is_active)
        self.assertFalse(self.user.has_usable_password())
        self.assertIsNotNone(self.user.deleted_at)

    def test_response_reports_zero_cancelled_appointments_when_there_are_none(self):
        # This fixture's patient has no bookings at all -- see
        # `bookings.tests.test_acceptance_journey
        # .AccountDeletionCancelsUpcomingAppointmentsTests` for the
        # companion case of a patient who actually has an upcoming
        # booking to cancel.
        response = self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"cancelled_appointments_count": 0})

    def test_rejects_wrong_password_without_scrubbing_anything(self):
        response = self.post_json(
            "/profile/delete-account", {"password": "totally-wrong-password"}
        )

        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "patient@example.com")
        self.assertTrue(self.user.is_active)
        self.assertIsNone(self.user.deleted_at)

    def test_unauthenticated_request_is_rejected(self):
        self.client.cookies.clear()

        response = self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})

        self.assertEqual(response.status_code, 401)

    def test_records_an_audit_event_that_still_resolves_after_the_scrub(self):
        original_id = self.user.id

        self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})

        entry = AuditLog.objects.get(action="account:deletion_requested")
        self.assertEqual(entry.target_type, "user")
        self.assertEqual(entry.target_id, str(original_id))
        self.assertEqual(entry.metadata, {"role": "patient"})
        # The row wasn't hard-deleted, so the FK still resolves by id -- to
        # the same, now-scrubbed, row.
        self.assertEqual(entry.actor_id, original_id)
        entry.actor.refresh_from_db()
        self.assertEqual(entry.actor.id, original_id)
        self.assertNotEqual(entry.actor.email, "patient@example.com")

    def test_logs_the_session_out(self):
        self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})

        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_post_scrub_login_with_the_original_credentials_fails(self):
        self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})
        self.client.cookies.clear()

        response = self.login()

        self.assertEqual(response.status_code, 400)

    def test_post_scrub_a_previously_issued_access_token_is_rejected(self):
        stale_access_token = self.client.cookies["access_token"].value

        self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})

        self.client.cookies.clear()
        self.client.cookies["access_token"] = stale_access_token
        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_post_scrub_a_freshly_minted_token_for_the_same_user_id_is_still_rejected(self):
        """Belt-and-suspenders on top of the previous test: even a token
        minted *after* the scrub, correctly matching the scrubbed
        password's revoke claim, is rejected -- `is_active=False` is
        checked independently on every request, not only as a side effect
        of the password having changed."""
        self.post_json("/profile/delete-account", {"password": TEST_PASSWORD})
        self.user.refresh_from_db()

        fresh_token = AccessToken.for_user(self.user)
        self.client.cookies.clear()
        self.client.cookies["access_token"] = str(fresh_token)
        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)

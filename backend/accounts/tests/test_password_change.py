from django.contrib.auth import get_user_model

from .helpers import TEST_PASSWORD, AuthAPITestCase

User = get_user_model()

NEW_PASSWORD = "an-even-stronger-passphrase-77"


class PasswordChangeTests(AuthAPITestCase):
    def setUp(self):
        self.register()
        self.login()

    def test_changes_password_with_correct_current_password(self):
        response = self.post_json(
            "/profile/password",
            {"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )

        self.assertEqual(response.status_code, 204)
        user = User.objects.get(email="patient@example.com")
        self.assertTrue(user.check_password(NEW_PASSWORD))

    def test_can_log_in_with_the_new_password_afterwards(self):
        self.post_json(
            "/profile/password",
            {"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )
        self.client.cookies.clear()

        response = self.login(password=NEW_PASSWORD)

        self.assertEqual(response.status_code, 200)

    def test_rejects_wrong_current_password(self):
        response = self.post_json(
            "/profile/password",
            {"current_password": "totally-wrong-password", "new_password": NEW_PASSWORD},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("current_password", response.json())
        user = User.objects.get(email="patient@example.com")
        self.assertTrue(user.check_password(TEST_PASSWORD))

    def test_rejects_weak_new_password(self):
        response = self.post_json(
            "/profile/password", {"current_password": TEST_PASSWORD, "new_password": "weak"}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("new_password", response.json())

    def test_stays_logged_in_as_the_acting_session_after_change(self):
        self.post_json(
            "/profile/password",
            {"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )

        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 200)

    def test_other_outstanding_access_tokens_are_invalidated_by_a_password_change(self):
        stale_access_token = self.client.cookies["access_token"].value

        self.post_json(
            "/profile/password",
            {"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )

        self.client.cookies["access_token"] = stale_access_token
        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_unauthenticated_request_is_rejected(self):
        self.client.cookies.clear()

        response = self.post_json(
            "/profile/password",
            {"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )

        self.assertEqual(response.status_code, 401)

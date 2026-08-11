from .helpers import TEST_PASSWORD, AuthAPITestCase


class LoginTests(AuthAPITestCase):
    def setUp(self):
        self.register()

    def test_logs_in_with_correct_credentials(self):
        response = self.login()

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["email"], "patient@example.com")
        self.assertEqual(body["role"], "patient")
        self.assertIn("access_token", response.cookies)
        self.assertIn("refresh_token", response.cookies)

    def test_rejects_wrong_password_with_a_generic_message(self):
        response = self.login(password="the-wrong-password-entirely")

        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access_token", response.cookies)

    def test_rejects_unknown_email_with_the_same_generic_message_as_wrong_password(self):
        wrong_password_response = self.login(password="the-wrong-password-entirely")
        unknown_email_response = self.login(email="nobody@example.com")

        # Same status/shape either way -- doesn't reveal whether the email
        # is registered.
        self.assertEqual(wrong_password_response.status_code, unknown_email_response.status_code)
        self.assertEqual(
            wrong_password_response.json().keys(), unknown_email_response.json().keys()
        )

    def test_login_is_case_insensitive_on_email(self):
        response = self.login(email="PATIENT@EXAMPLE.COM")

        self.assertEqual(response.status_code, 200)

    def test_rejects_login_without_the_required_client_header(self):
        response = self.client.post(
            "/auth/login",
            {"email": "patient@example.com", "password": TEST_PASSWORD},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)

from django.contrib.auth import get_user_model

from .helpers import TEST_PASSWORD, AuthAPITestCase

User = get_user_model()

VALID_PAYLOAD = {
    "email": "new.patient@example.com",
    "password": TEST_PASSWORD,
    "name": "New Patient",
}


class RegistrationTests(AuthAPITestCase):
    def test_registers_a_new_patient_and_logs_them_in(self):
        response = self.post_json("/auth/register", VALID_PAYLOAD)

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["email"], VALID_PAYLOAD["email"])
        self.assertEqual(body["name"], VALID_PAYLOAD["name"])
        self.assertEqual(body["role"], "patient")
        self.assertNotIn("password", body)

    def test_sets_httponly_access_and_refresh_cookies(self):
        response = self.post_json("/auth/register", VALID_PAYLOAD)

        access_cookie = response.cookies["access_token"]
        refresh_cookie = response.cookies["refresh_token"]
        self.assertTrue(access_cookie["httponly"])
        self.assertTrue(refresh_cookie["httponly"])
        self.assertEqual(access_cookie["samesite"], "Strict")
        self.assertEqual(refresh_cookie["path"], "/auth")

    def test_password_is_hashed_not_stored_plaintext(self):
        self.post_json("/auth/register", VALID_PAYLOAD)

        user = User.objects.get(email=VALID_PAYLOAD["email"])
        self.assertNotEqual(user.password, VALID_PAYLOAD["password"])
        self.assertTrue(user.password.startswith("pbkdf2_"))
        self.assertTrue(user.check_password(VALID_PAYLOAD["password"]))

    def test_role_field_in_payload_is_ignored_new_signups_are_always_patient(self):
        payload = {**VALID_PAYLOAD, "role": "admin"}

        response = self.post_json("/auth/register", payload)

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(email=VALID_PAYLOAD["email"])
        self.assertEqual(user.role, User.Role.PATIENT)

    def test_rejects_duplicate_email_with_a_clean_400_not_a_500(self):
        self.post_json("/auth/register", VALID_PAYLOAD)

        response = self.post_json("/auth/register", VALID_PAYLOAD)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["email"], ["An account with this email already exists."]
        )

    def test_duplicate_email_check_is_case_insensitive(self):
        self.post_json("/auth/register", VALID_PAYLOAD)

        response = self.post_json(
            "/auth/register", {**VALID_PAYLOAD, "email": VALID_PAYLOAD["email"].upper()}
        )

        self.assertEqual(response.status_code, 400)

    def test_rejects_malformed_email(self):
        response = self.post_json("/auth/register", {**VALID_PAYLOAD, "email": "not-an-email"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.json())

    def test_rejects_weak_password_with_a_specific_message(self):
        response = self.post_json("/auth/register", {**VALID_PAYLOAD, "password": "short"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.json())

    def test_rejects_missing_required_fields(self):
        response = self.post_json("/auth/register", {})

        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertIn("email", body)
        self.assertIn("password", body)

    def test_rejects_register_without_the_required_client_header(self):
        response = self.client.post(
            "/auth/register", VALID_PAYLOAD, content_type="application/json"
        )

        self.assertEqual(response.status_code, 403)

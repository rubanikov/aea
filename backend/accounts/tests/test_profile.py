from django.contrib.auth import get_user_model

from .helpers import AuthAPITestCase

User = get_user_model()


class ProfileTests(AuthAPITestCase):
    def setUp(self):
        self.register()
        self.login()

    def test_views_own_profile(self):
        response = self.client.get("/profile")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["email"], "patient@example.com")
        self.assertEqual(body["name"], "Pat Patient")
        self.assertEqual(body["role"], "patient")
        self.assertEqual(body["phone"], "")
        self.assertEqual(body["timezone"], "UTC")

    def test_updates_name_phone_and_timezone(self):
        response = self.patch_json(
            "/profile",
            {
                "name": "Patricia Patient",
                "phone": "+1 (555) 123-4567",
                "timezone": "America/Chicago",
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["name"], "Patricia Patient")
        self.assertEqual(body["phone"], "+1 (555) 123-4567")
        self.assertEqual(body["timezone"], "America/Chicago")

    def test_updates_email(self):
        response = self.patch_json("/profile", {"email": "new-address@example.com"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], "new-address@example.com")

    def test_cannot_change_role_via_profile_update(self):
        response = self.patch_json("/profile", {"role": "admin"})

        self.assertEqual(response.status_code, 200)
        user = User.objects.get(email="patient@example.com")
        self.assertEqual(user.role, User.Role.PATIENT)

    def test_rejects_email_already_used_by_another_account(self):
        User.objects.create_user(email="taken@example.com", password="another-passphrase-99")

        response = self.patch_json("/profile", {"email": "taken@example.com"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["email"], ["An account with this email already exists."]
        )

    def test_rejects_invalid_timezone(self):
        response = self.patch_json("/profile", {"timezone": "Not/AZone"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("timezone", response.json())

    def test_rejects_malformed_phone(self):
        response = self.patch_json("/profile", {"phone": "not a phone number!!"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("phone", response.json())

    def test_unauthenticated_patch_is_rejected(self):
        self.client.cookies.clear()

        response = self.patch_json("/profile", {"name": "Someone Else"})

        self.assertEqual(response.status_code, 401)

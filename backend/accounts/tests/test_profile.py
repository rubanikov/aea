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


class SmsCarrierTests(AuthAPITestCase):
    """TICKET-04: `User.sms_carrier`, readable/writable only via `/profile`.
    TICKET-05 (SMS sending) consumes the field; nothing here sends SMS."""

    def setUp(self):
        self.register()
        self.login()

    def test_profile_returns_empty_sms_carrier_by_default(self):
        response = self.client.get("/profile")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sms_carrier"], "")

    def test_sets_sms_carrier(self):
        response = self.patch_json("/profile", {"sms_carrier": "verizon"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sms_carrier"], "verizon")
        # Persisted, not just echoed back by the PATCH response.
        self.assertEqual(self.client.get("/profile").json()["sms_carrier"], "verizon")

    def test_rejects_unrecognized_carrier(self):
        self.patch_json("/profile", {"sms_carrier": "verizon"})

        response = self.patch_json("/profile", {"sms_carrier": "not_a_real_carrier"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("sms_carrier", response.json())
        user = User.objects.get(email="patient@example.com")
        self.assertEqual(user.sms_carrier, "verizon")  # nothing saved

    def test_clears_sms_carrier_with_empty_string(self):
        self.patch_json("/profile", {"sms_carrier": "att"})

        response = self.patch_json("/profile", {"sms_carrier": ""})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sms_carrier"], "")
        user = User.objects.get(email="patient@example.com")
        self.assertEqual(user.sms_carrier, "")

    def test_role_remains_read_only(self):
        response = self.patch_json("/profile", {"role": "admin", "sms_carrier": "tmobile"})

        self.assertEqual(response.status_code, 200)
        user = User.objects.get(email="patient@example.com")
        self.assertEqual(user.role, User.Role.PATIENT)
        self.assertEqual(user.sms_carrier, "tmobile")

    def test_cannot_touch_another_users_sms_carrier(self):
        """`/profile` operates only on `request.user` and takes no user-id
        parameter -- this locks in that boundary. The other user's session
        writes its own row; the first user's row is untouched, and id-suffixed
        URL shapes don't exist (404, never a cross-user write)."""
        other_register = self.register(email="other@example.com")
        other_id = other_register.json()["id"]
        # `register` logs the new user in (sets fresh auth cookies), so this
        # client is now acting as other@example.com.
        response = self.patch_json("/profile", {"sms_carrier": "sprint"})

        self.assertEqual(response.status_code, 200)
        first_user = User.objects.get(email="patient@example.com")
        self.assertEqual(first_user.sms_carrier, "")
        other_user = User.objects.get(pk=other_id)
        self.assertEqual(other_user.sms_carrier, "sprint")

        # No id-addressable variant of the endpoint exists at all.
        first_user_id = first_user.id
        self.assertEqual(self.client.get(f"/profile/{first_user_id}").status_code, 404)
        self.assertEqual(
            self.patch_json(f"/profile/{first_user_id}", {"sms_carrier": "boost"}).status_code,
            404,
        )

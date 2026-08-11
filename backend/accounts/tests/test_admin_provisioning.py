from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

User = get_user_model()


class AdminProvisioningTests(TestCase):
    """Provider/admin accounts are provisioned through Django admin rather
    than a public endpoint (see accounts/admin.py) -- this exercises that
    path end to end, the same way a staff user actually would."""

    def setUp(self):
        self.staff_user = User.objects.create_superuser(
            email="staff@example.com", password="a-strong-unique-passphrase-42"
        )
        self.client.force_login(self.staff_user)

    def test_staff_user_can_provision_a_provider_account(self):
        response = self.client.post(
            reverse("admin:accounts_user_add"),
            {
                "email": "new.provider@example.com",
                "name": "Dr. New Provider",
                "role": User.Role.PROVIDER,
                "password1": "a-different-strong-passphrase-11",
                "password2": "a-different-strong-passphrase-11",
            },
        )

        self.assertEqual(response.status_code, 302)
        provider = User.objects.get(email="new.provider@example.com")
        self.assertEqual(provider.role, User.Role.PROVIDER)
        self.assertTrue(provider.check_password("a-different-strong-passphrase-11"))

    def test_non_staff_user_cannot_reach_the_admin_site(self):
        patient = User.objects.create_user(email="patient@example.com", password="x")
        self.client.force_login(patient)

        response = self.client.get(reverse("admin:accounts_user_changelist"))

        self.assertEqual(response.status_code, 302)  # redirected to admin login

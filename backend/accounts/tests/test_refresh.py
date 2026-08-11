from .helpers import AuthAPITestCase


class RefreshTests(AuthAPITestCase):
    """`POST /auth/refresh` -- an addition beyond the ticket's literal
    endpoint list, added because a 15-minute access token with no way to
    renew it silently would force a re-login every 15 minutes (see
    accounts/views.py's RefreshView docstring)."""

    def setUp(self):
        self.register()

    def test_issues_a_new_access_token_from_a_valid_refresh_cookie(self):
        old_access_token = self.client.cookies["access_token"].value

        response = self.post_json("/auth/refresh")

        self.assertEqual(response.status_code, 204)
        self.assertNotEqual(response.cookies["access_token"].value, old_access_token)

    def test_new_access_token_works_against_a_protected_endpoint(self):
        self.post_json("/auth/refresh")

        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 200)

    def test_rotates_the_refresh_token_and_blacklists_the_old_one(self):
        old_refresh_token = self.client.cookies["refresh_token"].value

        response = self.post_json("/auth/refresh")

        new_refresh_token = response.cookies["refresh_token"].value
        self.assertNotEqual(new_refresh_token, old_refresh_token)

        # Reusing the old (now-rotated-out) refresh token must fail.
        self.client.cookies["refresh_token"] = old_refresh_token
        reuse_response = self.post_json("/auth/refresh")
        self.assertEqual(reuse_response.status_code, 401)

    def test_missing_refresh_cookie_is_rejected(self):
        self.client.cookies.clear()

        response = self.post_json("/auth/refresh")

        self.assertEqual(response.status_code, 401)

    def test_rejects_refresh_without_the_required_client_header(self):
        response = self.client.post("/auth/refresh", content_type="application/json")

        self.assertEqual(response.status_code, 403)

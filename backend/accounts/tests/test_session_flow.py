from .helpers import AuthAPITestCase


class SessionFlowTests(AuthAPITestCase):
    """The ticket's headline acceptance path: register -> login -> access a
    protected endpoint -> logout -> confirm the now-invalidated session is
    rejected."""

    def test_full_session_lifecycle(self):
        register_response = self.register()
        self.assertEqual(register_response.status_code, 201)

        login_response = self.login()
        self.assertEqual(login_response.status_code, 200)

        me_response = self.client.get("/auth/me")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["email"], "patient@example.com")

        logout_response = self.post_json("/auth/logout")
        self.assertEqual(logout_response.status_code, 204)

        rejected_response = self.client.get("/auth/me")
        self.assertEqual(rejected_response.status_code, 401)

    def test_unauthenticated_request_to_a_protected_resource_is_rejected(self):
        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_unauthenticated_profile_request_is_rejected(self):
        response = self.client.get("/profile")

        self.assertEqual(response.status_code, 401)

    def test_expired_access_token_is_rejected_even_with_a_present_cookie(self):
        self.register()

        # Directly forge an already-expired token onto the client's cookie
        # jar rather than depending on real clock time passing -- this is
        # exercising the same validation path a naturally-expired token
        # hits.
        from datetime import timedelta

        from rest_framework_simplejwt.tokens import AccessToken

        expired = AccessToken()
        expired.set_exp(lifetime=timedelta(seconds=-1))
        self.client.cookies["access_token"] = str(expired)

        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)

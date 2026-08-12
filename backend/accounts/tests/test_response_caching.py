from .helpers import AuthAPITestCase


class SessionScopedResponseCachingTests(AuthAPITestCase):
    """`GET /auth/me` is the app's identity oracle: `proxy.ts` calls it on
    every gated navigation to decide the visitor's role, and it answers with
    the caller's name and email. Two different sessions hitting the same URL
    must never be able to share a cached answer -- a role served from
    another user's cached response is both a wrong "access denied" and a PHI
    leak.

    Neither directive is redundant. `no-store` keeps the response out of
    caches that would otherwise apply heuristic freshness to a 200 with no
    explicit lifetime; `Vary: Cookie` is what keys the entry on the session
    for any cache that stores it anyway (a CDN or corporate proxy overriding
    origin headers, for instance).
    """

    def setUp(self):
        self.register()
        self.login()

    def test_auth_me_is_never_stored_by_a_cache(self):
        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers.get("Cache-Control", ""))

    def test_auth_me_varies_on_the_session_cookie(self):
        response = self.client.get("/auth/me")

        vary = response.headers.get("Vary", "")
        self.assertIn("cookie", vary.lower())

    def test_profile_reads_are_not_cacheable_either(self):
        response = self.client.get("/profile")

        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers.get("Cache-Control", ""))
        self.assertIn("cookie", response.headers.get("Vary", "").lower())

    def test_an_unauthenticated_rejection_is_also_uncacheable(self):
        # A cached 401 served to a visitor who *does* have a session is the
        # same failure wearing a different hat.
        self.client.cookies.clear()

        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)
        self.assertIn("no-store", response.headers.get("Cache-Control", ""))

from datetime import timedelta

from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

from accounts.models import RefreshTokenRotation
from accounts.tokens import rotate_refresh_token

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
        self.assertTrue(
            RefreshTokenRotation.objects.filter(issued_refresh_token=new_refresh_token).exists()
        )

    def test_missing_refresh_cookie_is_rejected(self):
        self.client.cookies.clear()

        response = self.post_json("/auth/refresh")

        self.assertEqual(response.status_code, 401)

    def test_rejects_refresh_without_the_required_client_header(self):
        response = self.client.post("/auth/refresh", content_type="application/json")

        self.assertEqual(response.status_code, 403)


class RefreshRaceTests(AuthAPITestCase):
    """Two tabs open on the same account both hit `POST /auth/refresh` when
    their shared 15-minute access token expires. The second one arrives
    holding a refresh token the first one has already rotated out, which
    looks exactly like refresh-token reuse -- except for the timing.

    See `accounts/tokens.py`: inside the grace window that's a benign race
    and the already-issued pair is replayed; outside it, it's treated as
    genuine reuse and every session for the account is revoked.
    """

    def setUp(self):
        self.register()
        self.shared_refresh_token = self.client.cookies["refresh_token"].value

    def refresh(self):
        """Posts to `/auth/refresh` and returns `(status, cookies)`.

        The cookie values are copied out eagerly on purpose: Django's test
        client keeps the very same `Morsel` objects the response was read
        from, so a later `self.client.cookies[...] = ...` in a test would
        rewrite an earlier response's cookies in place.
        """
        response = self.post_json("/auth/refresh")
        return response.status_code, {
            name: morsel.value for name, morsel in response.cookies.items()
        }

    def present(self, refresh_token):
        """Hands the server a refresh token the client isn't holding any
        more -- what the second tab does when the first tab has already
        rotated the token they were sharing."""
        self.client.cookies["refresh_token"] = refresh_token
        return self.refresh()

    def age_rotation_records(self, age):
        """Backdates every recorded rotation, standing in for wall-clock time
        passing between a token being rotated out and presented again."""
        RefreshTokenRotation.objects.update(rotated_at=timezone.now() - age)

    def test_second_tab_racing_the_first_gets_the_same_pair_instead_of_a_logout(self):
        first_tab_status, first_tab = self.refresh()
        self.assertEqual(first_tab_status, 204)

        second_tab_status, second_tab = self.present(self.shared_refresh_token)

        self.assertEqual(second_tab_status, 204)
        self.assertEqual(second_tab["access_token"], first_tab["access_token"])
        self.assertEqual(second_tab["refresh_token"], first_tab["refresh_token"])

    def test_the_pair_the_second_tab_gets_back_is_usable(self):
        self.refresh()

        self.present(self.shared_refresh_token)

        self.assertEqual(self.client.get("/auth/me").status_code, 200)
        self.assertEqual(self.refresh()[0], 204)

    def test_the_grace_window_covers_a_slow_round_trip_but_not_a_later_replay(self):
        self.refresh()

        self.age_rotation_records(timedelta(seconds=9))
        self.assertEqual(self.present(self.shared_refresh_token)[0], 204)

        self.age_rotation_records(timedelta(seconds=11))
        self.assertEqual(self.present(self.shared_refresh_token)[0], 401)

    def test_reuse_outside_the_grace_window_is_rejected_and_forces_a_logout(self):
        _, first_tab = self.refresh()
        self.age_rotation_records(timedelta(hours=1))

        status_code, cookies = self.present(self.shared_refresh_token)

        self.assertEqual(status_code, 401)
        self.assertEqual(cookies["access_token"], "")
        self.assertEqual(cookies["refresh_token"], "")
        # ...and the whole chain goes with it: the pair the legitimate
        # client is holding stops working too, so a stolen refresh token
        # can't outlive its own detection.
        self.assertEqual(self.present(first_tab["refresh_token"])[0], 401)

    def test_reuse_of_a_token_two_generations_stale_is_rejected(self):
        self.refresh()
        self.refresh()

        status_code, _ = self.present(self.shared_refresh_token)

        self.assertEqual(status_code, 401)

    def test_a_dead_heat_between_two_workers_leaves_both_clients_usable(self):
        # Closer still: both requests read the blacklist before either wrote
        # to it, so neither one is a replay and both rotate. Deleting the
        # blacklist row rewinds the second call to that instant -- there's no
        # other way to line two requests up that precisely from a test.
        _, first_pair = rotate_refresh_token(self.shared_refresh_token)
        BlacklistedToken.objects.all().delete()

        _, second_pair = rotate_refresh_token(self.shared_refresh_token)

        self.assertNotEqual(second_pair, first_pair)
        self.assertEqual(self.present(first_pair)[0], 204)
        self.assertEqual(self.present(second_pair)[0], 204)

    def test_a_refresh_token_revoked_by_logout_is_never_replayed(self):
        self.assertEqual(self.post_json("/auth/logout").status_code, 204)

        status_code, _ = self.present(self.shared_refresh_token)

        self.assertEqual(status_code, 401)

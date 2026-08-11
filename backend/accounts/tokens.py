"""Issues and delivers the JWT pair as httpOnly cookies.

Cookie names (part of the API contract — see this ticket's summary):
  - `access_token`  — short-lived (15 min), sent on every request, path=/
  - `refresh_token` — longer-lived (7 days), only sent to /auth/*, path=/auth

Both are `HttpOnly` (never readable by JavaScript — this app handles PHI and
a stolen token via XSS is the exact risk that rules out `localStorage`),
`Secure` outside local dev, and `SameSite=Strict` (see accounts/csrf.py for
why that's not the whole CSRF story).
"""

from django.conf import settings
from rest_framework_simplejwt.tokens import RefreshToken

ACCESS_COOKIE_NAME = "access_token"
REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/auth"


def _cookie_kwargs():
    # Read from settings per call (not at import time) so tests can
    # `override_settings` and see the effect.
    return {
        "httponly": True,
        "secure": settings.AUTH_COOKIE_SECURE,
        "samesite": settings.AUTH_COOKIE_SAMESITE,
    }


def issue_tokens_for_user(user):
    """Returns `(access_token, refresh_token)` encoded strings for a freshly
    authenticated user, registering the refresh token as outstanding so it
    can be individually revoked later (logout, password change)."""
    refresh = RefreshToken.for_user(user)
    return str(refresh.access_token), str(refresh)


def set_auth_cookies(response, access_token, refresh_token):
    cookie_kwargs = _cookie_kwargs()
    response.set_cookie(
        ACCESS_COOKIE_NAME,
        access_token,
        max_age=int(settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"].total_seconds()),
        path="/",
        **cookie_kwargs,
    )
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        path=REFRESH_COOKIE_PATH,
        **cookie_kwargs,
    )


def clear_auth_cookies(response):
    response.delete_cookie(ACCESS_COOKIE_NAME, path="/")
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)

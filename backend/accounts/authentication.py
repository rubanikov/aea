from rest_framework.permissions import SAFE_METHODS
from rest_framework_simplejwt.authentication import JWTAuthentication

from .csrf import enforce_ajax_header
from .tokens import ACCESS_COOKIE_NAME


class CookieJWTAuthentication(JWTAuthentication):
    """Reads the access token from an httpOnly cookie instead of the
    `Authorization` header `JWTAuthentication` normally expects.

    This app handles PHI, so the access/refresh tokens are never exposed to
    JavaScript (never `localStorage`, never a JS-readable cookie) — see
    `accounts/tokens.py` for how the cookies are set. Reading the token back
    out of the cookie here is the other half of that.

    DRF authenticates every request (regardless of the view's
    `permission_classes`), so the CSRF header check below applies uniformly
    to every unsafe-method request this API receives — including
    register/login, where a login-CSRF (forging a request that logs the
    victim into an attacker-controlled account) is a real, if less obvious,
    variant of the same attack — not only ones that happen to already carry
    a cookie.
    """

    def authenticate(self, request):
        if request.method not in SAFE_METHODS:
            enforce_ajax_header(request)

        raw_token = request.COOKIES.get(ACCESS_COOKIE_NAME)
        if raw_token is None:
            return None

        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token

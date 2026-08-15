"""Issues, rotates and delivers the JWT pair as httpOnly cookies.

Cookie names (part of the API contract):
  - `access_token`  — short-lived (15 min), sent on every request, path=/
  - `refresh_token` — longer-lived (7 days), only sent to /auth/*, path=/auth

Both are `HttpOnly` (never readable by JavaScript — this app handles PHI and
a stolen token via XSS is the exact risk that rules out `localStorage`),
`Secure` outside local dev, and `SameSite=Strict` (see accounts/csrf.py for
why that's not the whole CSRF story).
"""

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.utils import datetime_from_epoch

from .models import RefreshTokenRotation

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


class RefreshTokenReuse(TokenError):
    """A rotated-out refresh token was presented long enough after its
    replacement was issued that a multi-tab race can't explain it.

    Raised only after every session for the account has already been revoked
    — the caller's job is to answer 401 and clear the cookies, not to decide
    whether to revoke.
    """


class _RotatingRefreshToken(RefreshToken):
    """A `RefreshToken` that verifies everything except the blacklist.

    Stock simplejwt collapses "invalid or expired", "blacklisted seconds ago
    by this session's own rotation" and "blacklisted hours ago and now being
    replayed" into one indistinguishable `TokenError`, because
    `BlacklistMixin.verify()` checks the blacklist before anything else.
    `rotate_refresh_token` has to answer those three differently, so it runs
    the blacklist check itself. Signature, expiry and token type are still
    verified in full by `super().verify()`.
    """

    def check_blacklist(self):
        return


def rotate_refresh_token(raw_refresh):
    """Exchanges a refresh token for a fresh `(access_token, refresh_token)`
    pair, rotating and blacklisting the presented one.

    Raises `TokenError` if the token can't be honoured at all, or
    `RefreshTokenReuse` if it was rotated out long enough ago to read as
    genuine reuse (see `RefreshTokenRotation`).
    """
    token = _RotatingRefreshToken(raw_refresh)

    if _is_blacklisted(token[api_settings.JTI_CLAIM]):
        return _replay_or_reject(token)

    return _rotate(token)


def _is_blacklisted(jti):
    return BlacklistedToken.objects.filter(token__jti=jti).exists()


def _rotate(token):
    retired_jti = token[api_settings.JTI_CLAIM]
    retired_expires_at = datetime_from_epoch(token["exp"])
    user_id = token[api_settings.USER_ID_CLAIM]

    access_token = str(token.access_token)
    token.blacklist()
    token.set_jti()
    token.set_exp()
    token.set_iat()
    token.outstand()
    refresh_token = str(token)

    _record_rotation(
        user_id=user_id,
        retired_jti=retired_jti,
        retired_expires_at=retired_expires_at,
        access_token=access_token,
        refresh_token=refresh_token,
        refresh_jti=token[api_settings.JTI_CLAIM],
    )
    return access_token, refresh_token


def _record_rotation(
    *, user_id, retired_jti, retired_expires_at, access_token, refresh_token, refresh_jti
):
    RefreshTokenRotation.objects.filter(
        user_id=user_id, expires_at__lte=timezone.now()
    ).delete()
    try:
        # `atomic` so the failed INSERT below can't poison an outer
        # transaction, per Django's own guidance on catching IntegrityError.
        with transaction.atomic():
            RefreshTokenRotation.objects.create(
                user_id=user_id,
                retired_jti=retired_jti,
                expires_at=retired_expires_at,
                issued_access_token=access_token,
                issued_refresh_token=refresh_token,
                issued_refresh_jti=refresh_jti,
            )
    except IntegrityError:
        # A dead heat: two requests rotated the same token before either had
        # blacklisted it, so neither was a replay. Both pairs are valid and
        # both clients already hold theirs, so the first receipt stands.
        pass


def _replay_or_reject(token):
    """Decides what a blacklisted-but-otherwise-valid refresh token means."""
    rotation = RefreshTokenRotation.objects.filter(
        retired_jti=token[api_settings.JTI_CLAIM]
    ).first()

    if rotation is None:
        # Blacklisted by something other than a rotation — a logout, a
        # password change, or the revocation below. There is no pair to
        # replay and the session is genuinely over.
        raise TokenError("Token is blacklisted")

    if timezone.now() - rotation.rotated_at > settings.REFRESH_ROTATION_GRACE_PERIOD:
        _revoke_every_session(rotation.user_id)
        raise RefreshTokenReuse("Refresh token reuse detected; all sessions were revoked.")

    if _is_blacklisted(rotation.issued_refresh_jti):
        # The pair this token rotated into has itself been revoked since —
        # a logout landing between two racing tabs, or a second rotation.
        # Replaying would hand back a dead refresh token and resurrect a
        # session that was deliberately ended.
        raise TokenError("Token is blacklisted")

    return rotation.issued_access_token, rotation.issued_refresh_token


def _revoke_every_session(user_id):
    """Blacklists every outstanding refresh token the account holds.

    Reuse means one of the tokens in circulation is in the wrong hands and
    there's no telling which side of the exchange was the legitimate one, so
    both sides lose the session — the response RFC 9700 prescribes for
    rotation with reuse detection. Access tokens already minted stay valid
    until they expire (at 15 minutes that's the ceiling a stateless JWT
    imposes), but none of them can be renewed.
    """
    BlacklistedToken.objects.bulk_create(
        [
            BlacklistedToken(token=outstanding)
            for outstanding in OutstandingToken.objects.filter(user_id=user_id)
        ],
        ignore_conflicts=True,
    )

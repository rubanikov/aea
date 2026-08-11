import logging

from django.db import IntegrityError
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .csrf import enforce_ajax_header
from .serializers import (
    ChangePasswordSerializer,
    DeleteAccountSerializer,
    LoginSerializer,
    RegisterSerializer,
    UserSerializer,
)
from .tokens import (
    REFRESH_COOKIE_NAME,
    clear_auth_cookies,
    issue_tokens_for_user,
    set_auth_cookies,
)

logger = logging.getLogger(__name__)

# Registration/login race a real, if narrow, TOCTOU gap: two requests can
# both pass the serializer's uniqueness check before either insert commits.
# The model's `unique=True` on `email` is the actual guarantee; this is only
# here so that rare case still returns a clean 400, not a raw IntegrityError
# traceback.
DUPLICATE_EMAIL_RESPONSE = {"email": ["An account with this email already exists."]}


class LoginRateThrottle(AnonRateThrottle):
    """Scoped separately (see `DEFAULT_THROTTLE_RATES["login"]` in
    settings.py) so a burst of failed logins can't also throttle
    registration or any other anonymous endpoint."""

    scope = "login"


class RegisterView(APIView):
    """`POST /auth/register` — patient self-service signup. Always creates a
    `patient` (see `RegisterSerializer`); logs the user in on success, same
    as `LoginView`."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = serializer.save()
        except IntegrityError:
            return Response(DUPLICATE_EMAIL_RESPONSE, status=status.HTTP_400_BAD_REQUEST)

        logger.info("user registered id=%s role=%s", user.id, user.role)
        access_token, refresh_token = issue_tokens_for_user(user)
        response = Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)
        set_auth_cookies(response, access_token, refresh_token)
        return response


class LoginView(APIView):
    """`POST /auth/login`."""

    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]

        logger.info("user logged in id=%s", user.id)
        access_token, refresh_token = issue_tokens_for_user(user)
        response = Response(UserSerializer(user).data)
        set_auth_cookies(response, access_token, refresh_token)
        return response


def _revoke_session(request, response):
    """Blacklists the current refresh token (if present) and clears both
    auth cookies on `response`. Shared by `LogoutView` and
    `DeleteAccountView` — a successful account deletion logs the user out
    the exact same way `POST /auth/logout` does, rather than duplicating
    the mechanism."""
    raw_refresh = request.COOKIES.get(REFRESH_COOKIE_NAME)
    if raw_refresh:
        try:
            RefreshToken(raw_refresh).blacklist()
        except TokenError:
            pass  # already expired/invalid -- nothing left to revoke

    clear_auth_cookies(response)


class LogoutView(APIView):
    """`POST /auth/logout` — requires a valid session (default
    `IsAuthenticated`). Blacklists the refresh token so it can't be used to
    mint new access tokens, and clears both cookies; the browser stops
    sending the access token on the very next request as a result."""

    def post(self, request):
        logger.info("user logged out id=%s", request.user.id)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        _revoke_session(request, response)
        return response


class RefreshView(APIView):
    """`POST /auth/refresh` — not in the ticket's literal endpoint list, but
    a short-lived (15 min) access token with no way to renew it silently
    forces a re-login every 15 minutes, which is a poor tradeoff for a
    working session. Bypasses `CookieJWTAuthentication` entirely (the access
    token cookie may well be expired — that's the point) and reads the
    refresh cookie directly instead. Always rotates the refresh token
    (`ROTATE_REFRESH_TOKENS`/`BLACKLIST_AFTER_ROTATION`, see settings.py) —
    the old refresh token is blacklisted the moment a new pair is issued.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        enforce_ajax_header(request)
        raw_refresh = request.COOKIES.get(REFRESH_COOKIE_NAME)
        if not raw_refresh:
            return Response(
                {"detail": "No refresh token cookie present."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        try:
            refresh = RefreshToken(raw_refresh)
            access_token = str(refresh.access_token)
            refresh.blacklist()
            refresh.set_jti()
            refresh.set_exp()
            refresh.set_iat()
            refresh.outstand()
        except TokenError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_401_UNAUTHORIZED)

        response = Response(status=status.HTTP_204_NO_CONTENT)
        set_auth_cookies(response, access_token, str(refresh))
        return response


class MeView(APIView):
    """`GET /auth/me` — the current user + role, for the frontend to read
    once it has a session (post-login, or on app load to check for one)."""

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class ProfileView(APIView):
    """`GET`/`PATCH /profile` — view/update name, email, phone, timezone.
    `role` is read-only here; it isn't self-service (see accounts/admin.py)."""

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        serializer = UserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            serializer.save()
        except IntegrityError:
            return Response(DUPLICATE_EMAIL_RESPONSE, status=status.HTTP_400_BAD_REQUEST)

        logger.info("profile updated id=%s", request.user.id)
        return Response(serializer.data)


class ChangePasswordView(APIView):
    """`POST /profile/password` — requires the current password. Rotates
    this session's tokens on success so the acting request stays logged in;
    `CHECK_REVOKE_TOKEN` (settings.py) invalidates every *other* outstanding
    access token immediately, since each one embeds a hash of the password
    that just changed."""

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        logger.info("password changed id=%s", request.user.id)

        old_refresh = request.COOKIES.get(REFRESH_COOKIE_NAME)
        if old_refresh:
            try:
                RefreshToken(old_refresh).blacklist()
            except TokenError:
                pass

        access_token, refresh_token = issue_tokens_for_user(request.user)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        set_auth_cookies(response, access_token, refresh_token)
        return response


class DeleteAccountView(APIView):
    """`POST /profile/delete-account` — TICKET-14. Requires the current
    password re-submitted as server-side proof of intent (a client-side
    confirmation modal alone isn't enough for an irreversible action — see
    `DeleteAccountSerializer`). Scrubs the account's PHI fields in place
    (never a hard delete, so `AuditLog.actor` keeps resolving by id — see
    `accounts/models.py`'s `deleted_at` field) and logs the session out the
    same way `POST /auth/logout` does.
    """

    def post(self, request):
        serializer = DeleteAccountSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        cancelled_appointments_count = serializer.save()

        logger.info("account deletion requested id=%s", request.user.id)
        response = Response({"cancelled_appointments_count": cancelled_appointments_count})
        _revoke_session(request, response)
        return response

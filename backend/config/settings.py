"""
Django settings for config project.

For more information on this file, see
https://docs.djangoproject.com/en/6.1/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/6.1/ref/settings/
"""

import os
import sys
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from corsheaders.defaults import default_headers
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

# `manage.py test` (this project's CI command -- see .github/workflows/ci.yml)
# runs with DJANGO_DEBUG=False on purpose, to exercise the app against
# production-like settings rather than DEBUG's more forgiving ones. That's
# fine for a setting like AUTH_COOKIE_SECURE below -- a `Secure` cookie flag
# is inert against Django's own test client, nothing there enforces it. It
# is not fine for SECURE_SSL_REDIRECT: unlike a cookie flag, that one
# actually changes response behavior (a 301 before the view ever runs), and
# Django's test client always makes plain, non-HTTPS requests -- so the
# genuinely production-only redirect would otherwise 301 every single test
# in this suite. RUNNING_TESTS scopes that one setting back to "off" for
# `manage.py test` specifically, the same "detect the test runner" idiom
# Django projects commonly use for this exact conflict.
RUNNING_TESTS = sys.argv[1:2] == ["test"]


def _load_env_file(path: Path) -> None:
    """Populate os.environ from a plain KEY=VALUE .env file.

    Hosted environments (Railway, CI) set real environment variables and never
    have a .env file to read, so this is purely a local-dev convenience — it
    lets `manage.py runserver` pick up a copied `.env.example` without pulling
    in a third-party dotenv dependency. Existing environment variables always
    win over the file.
    """
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


_load_env_file(REPO_ROOT / ".env")
_load_env_file(BASE_DIR / ".env")


def _database_config_from_url(url: str) -> dict:
    """Turn a Postgres connection URL (the format Supabase and Railway both
    hand out) into a Django DATABASES entry, without a dj-database-url
    dependency — the format is simple enough to parse with the stdlib.
    """
    parsed = urlparse(url)
    # Query params (e.g. Supabase's ?sslmode=require) pass straight through to
    # psycopg as connection options.
    options = {key: values[0] for key, values in parse_qs(parsed.query).items()}
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/"),
        "USER": parsed.username or "",
        "PASSWORD": parsed.password or "",
        "HOST": parsed.hostname or "",
        "PORT": parsed.port or "",
        "OPTIONS": options,
    }


# SECURITY WARNING: keep the secret key used in production secret!
# The fallback below only works locally with DEBUG on — see .env.example.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "insecure-dev-only-key-change-me")

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.environ.get("DJANGO_DEBUG", "False") == "True"

# Fail loudly rather than failing open: outside local DEBUG, starting up
# with the public, checked-in dev fallback key would mean a missing
# DJANGO_SECRET_KEY env var silently compromises both Django's own signing
# and JWT_SECRET_KEY (which falls back to SECRET_KEY below) — the app
# should refuse to start rather than run with a secret every reader of
# this repo already knows.
if not DEBUG and SECRET_KEY == "insecure-dev-only-key-change-me":
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be set to a real value outside local development."
    )

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "core",
    "accounts",
    "audit",
    "scheduling",
    "bookings",
    "reminders",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Outermost-but-one on the way back out, so it sees the finished response
    # of every view (and every DRF exception handler) and can mark it
    # uncacheable — see core/middleware.py for why a cached identity response
    # is both a wrong "access denied" and a PHI leak.
    "core.middleware.NoStoreSessionScopedResponsesMiddleware",
]

# Custom user model — swapped in before the first `migrate` (see TICKET-01's
# handoff notes / accounts/models.py) rather than bolted onto the stock
# django.contrib.auth.User after the fact.
AUTH_USER_MODEL = "accounts.User"

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# Database
# https://docs.djangoproject.com/en/6.1/ref/settings/#databases
#
# DATABASE_URL is a standard Postgres connection string. Supabase and Railway
# both hand out this exact format, and it defaults below to a local/dockerized
# Postgres instance so `manage.py runserver` works out of the box without a
# live Supabase project — see .env.example.

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/postgres"
)
DATABASES = {"default": _database_config_from_url(DATABASE_URL)}

# Two `manage.py test` runs against the same local Postgres instance (e.g. two
# agents/developers working in parallel) otherwise collide on Django's fixed
# default test-DB name and deadlock/error. TEST_DB_NAME_SUFFIX lets each
# runner pick a distinct one; unset by default so CI/solo dev keeps Django's
# normal `test_<name>` behavior.
_test_db_suffix = os.environ.get("TEST_DB_NAME_SUFFIX", "")
if _test_db_suffix:
    DATABASES["default"]["TEST"] = {
        "NAME": f"test_{DATABASES['default']['NAME']}_{_test_db_suffix}"
    }


# Password hashing — project.md's Security section names bcrypt/argon2
# explicitly, so bcrypt goes first. PBKDF2 (Django's own default) stays
# second: it's not used for new hashes, but keeping it in the list means
# Django can still verify anything hashed before this setting existed
# (e.g. rows created by an older seed run) without a data migration.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]


# Password validation
# https://docs.djangoproject.com/en/6.1/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# CORS
# The frontend (Next.js, a different origin in every environment — different
# port locally, different domain once deployed) is the only browser client
# this API expects. CORS_ALLOW_CREDENTIALS is required so the browser will
# send/receive the httpOnly auth cookies (see accounts/tokens.py) on
# cross-origin requests at all.

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = True

# django-cors-headers' defaults cover `x-requested-with` (accounts/csrf.py's
# mitigation, sent on every unsafe-method request) but not `Idempotency-Key`,
# which `POST /bookings` reads (bookings/views.py's IDEMPOTENCY_KEY_HEADER).
# A custom header absent from the preflight response is not a soft failure:
# the browser refuses to send the real request at all, so the server logs an
# `OPTIONS` with no `POST` after it and the caller's `fetch` rejects with a
# network-level error carrying no status to report on. Any new custom request
# header the frontend starts sending has to be added here too.
CORS_ALLOW_HEADERS = (*default_headers, "idempotency-key")


# Django REST Framework
# Deny-by-default (IsAuthenticated) — individual views opt into AllowAny
# (register/login) rather than the reverse, so a new protected resource is
# rejected for unauthenticated requests unless someone deliberately opens it
# up.

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.authentication.CookieJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # A general floor under every endpoint that doesn't already have its own
    # scoped throttle (accounts/views.py's LoginRateThrottle is still the
    # tighter, more specific rate for login — a view-level throttle_classes
    # entirely replaces these defaults for that view, so this doesn't stack
    # with it). Rates are deliberately generous: this is abuse protection,
    # not a capacity limit, and this project's own test suite (in particular
    # bookings/tests/test_concurrency.py's ~10-request bursts) needs to stay
    # well under both.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        # Scoped to the login view only (accounts/views.py's
        # LoginRateThrottle) — a blanket AnonRateThrottle would also throttle
        # registration off the back of a login attack.
        "login": "5/min",
        # Cancellations only, on PATCH /bookings/<id>/status (bookings/
        # views.py's CancellationRateThrottle) -- the one authenticated
        # action that makes the server send provider-written text to a
        # patient's inbox and phone, so it gets a tighter limit than the
        # generic per-account floor below. Ten a minute is far more than a
        # provider clearing a morning by hand ever needs.
        "booking_cancel": "10/min",
        "anon": "100/min",
        "user": "300/min",
    },
    # DRF's browsable HTML API is a local-dev convenience (lets you click
    # through endpoints in a browser); outside DEBUG it's pure attack
    # surface for no benefit a real client needs, so only JSONRenderer ships
    # then.
    "DEFAULT_RENDERER_CLASSES": (
        [
            "rest_framework.renderers.JSONRenderer",
            "rest_framework.renderers.BrowsableAPIRenderer",
        ]
        if DEBUG
        else ["rest_framework.renderers.JSONRenderer"]
    ),
}


# djangorestframework-simplejwt
# Tokens are delivered as httpOnly cookies, never in a JSON body or header a
# script could read (see accounts/tokens.py) — this app handles PHI, and
# token theft via XSS is exactly the risk that rules out localStorage.
# Access tokens are short-lived by design ("sessions expire" is a stated
# requirement, not a bug); POST /auth/refresh (accounts/views.py) renews one
# silently using the longer-lived refresh cookie.

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    # Changing your password immediately invalidates every access token
    # issued before the change (each one embeds a hash of the password that
    # was current when it was minted) — not just the one used to change it.
    "CHECK_REVOKE_TOKEN": True,
    # `or`, not `.get(..., default)`: .env.example ships JWT_SECRET_KEY as
    # a documented-empty line, so the var is *set* (to ""), not missing --
    # .get()'s default never kicks in for that, and an empty HMAC key is a
    # hard PyJWT error at the first token issued. `or` treats "unset" and
    # "set to empty" the same way, which is what "falls back to
    # SECRET_KEY" actually needs to mean here.
    "SIGNING_KEY": os.environ.get("JWT_SECRET_KEY") or SECRET_KEY,
}

# How long after a refresh token is rotated out it may still be presented
# without that counting as reuse. Two tabs open on the same account share one
# refresh cookie, so when the access token expires they both post to
# /auth/refresh at once and the loser arrives holding a token the winner has
# already rotated — see accounts/models.py's RefreshTokenRotation.
#
# The window only has to cover the spread between two clients reacting to the
# same expiry: a request round trip, plus a suspended tab's timers firing
# late, plus one retry. Ten seconds covers that with room to spare and is
# still far too narrow to be useful to an attacker replaying an exfiltrated
# token — anything slower than "already in flight" gets the full revocation.
REFRESH_ROTATION_GRACE_PERIOD = timedelta(seconds=10)

AUTH_COOKIE_SECURE = not DEBUG
AUTH_COOKIE_SAMESITE = "Strict"

# Django's own cookies -- the session/CSRF pair `/admin/`'s login uses --
# are a separate mechanism from the app's own JWT cookies above, and need
# the same `not DEBUG` hardening applied to them directly; setting
# AUTH_COOKIE_SECURE doesn't touch these. SECURE_SSL_REDIRECT/
# SECURE_PROXY_SSL_HEADER cover transport for the whole app, not just
# these two cookies: Railway (and any other reverse-proxy deployment)
# terminates TLS upstream and forwards plain HTTP with
# X-Forwarded-Proto, so Django needs that header named explicitly to
# know a proxied request was actually HTTPS.
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_SSL_REDIRECT = not DEBUG and not RUNNING_TESTS
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")


# Internationalization
# https://docs.djangoproject.com/en/6.1/topics/i18n/

LANGUAGE_CODE = "en-us"

# Every timestamp is stored in UTC; providers/patients carry their own IANA
# timezone field on their own records (architecture.md §5) — this project-wide
# setting is the storage half of that decision.
TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.1/howto/static-files/

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"


# Default primary key field type
# https://docs.djangoproject.com/en/6.1/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Logging
# Structured console logging so Railway (which captures stdout) and local dev
# both see the same output. No PHI in log messages — identifiers/references
# only, per project.md's cross-cutting logging requirement.

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "structured": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "structured",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
}


# Reminders / Resend (TICKET-12, architecture.md §7)
# `RESEND_API_KEY` unset is a supported, deliberate state (local dev, CI,
# and this environment never have a real key) -- reminders.emails
# .send_reminder_email treats it as "skip this send, log a warning," not a
# crash; see that module's docstring. `RESEND_FROM_EMAIL` is a verified
# Resend sending address in a real deployment; the placeholder below only
# matters once RESEND_API_KEY is actually set. `FRONTEND_BASE_URL` is the
# deployed Next.js origin (Vercel) the reminder email's "view details"
# link points at -- distinct from CORS_ALLOWED_ORIGINS above, which is
# about what origins may *call this API*, not what link a third-party
# email should embed.

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "reminders@example.com")
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:3000")

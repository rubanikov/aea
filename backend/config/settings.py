"""
Django settings for config project.

For more information on this file, see
https://docs.djangoproject.com/en/6.1/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/6.1/ref/settings/
"""

import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent


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
    "DEFAULT_THROTTLE_RATES": {
        # Scoped to the login view only (accounts/views.py's
        # LoginRateThrottle) — a blanket AnonRateThrottle would also throttle
        # registration off the back of a login attack.
        "login": "5/min",
    },
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
    "SIGNING_KEY": os.environ.get("JWT_SECRET_KEY", SECRET_KEY),
}

AUTH_COOKIE_SECURE = not DEBUG
AUTH_COOKIE_SAMESITE = "Strict"


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

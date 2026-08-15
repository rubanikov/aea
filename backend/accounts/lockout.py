"""Per-account login lockout -- the counterpart to the per-IP throttle.

`LoginRateThrottle` (accounts/views.py, 5/min per IP) blunts a single
source hammering `POST /auth/login`, but an attacker rotating IPs gets a
fresh budget per address against the *same* account. This module tracks
failed attempts per normalized email in the shared cache (settings.CACHES
-- database-backed in production, so every gunicorn worker sees the same
counter and it survives deploys): after `LOCKOUT_MAX_FAILURES` failures
inside `LOCKOUT_WINDOW`, the account rejects every further login attempt --
correct password included, so a lucky guess during the window doesn't slip
through -- with a 429 until the window expires.

Only *failed* attempts count, and a successful login clears the counter
outright -- the demo/e2e flows that log in repeatedly with correct
credentials never accumulate anything.

Cache keys and log lines use a SHA-256 fingerprint of the email, never the
raw address: an email is PHI (no PHI in logs, per project convention), and
the attempted address may not belong to any registered account, so there is
not always a user id to log instead.
"""

import hashlib
import logging
from datetime import timedelta

from django.core.cache import cache

logger = logging.getLogger(__name__)

LOCKOUT_MAX_FAILURES = 10
LOCKOUT_WINDOW = timedelta(minutes=15)

LOCKOUT_DETAIL = (
    "Too many failed login attempts for this account. Try again in a few minutes."
)


def _fingerprint(email):
    return hashlib.sha256(email.encode("utf-8")).hexdigest()


def _cache_key(email):
    return f"login-lockout:{_fingerprint(email)}"


def is_locked_out(email):
    """True while `email` has `LOCKOUT_MAX_FAILURES`+ recorded failures."""
    return (cache.get(_cache_key(email)) or 0) >= LOCKOUT_MAX_FAILURES


def record_failure(email):
    """Counts one failed attempt against `email`'s fixed window: the first
    failure starts the clock, and the whole counter expires
    `LOCKOUT_WINDOW` after it (which is also when a lockout ends)."""
    key = _cache_key(email)
    window_seconds = LOCKOUT_WINDOW.total_seconds()
    if cache.add(key, 1, window_seconds):
        failures = 1
    else:
        try:
            failures = cache.incr(key)
        except ValueError:
            # The window expired between add() and incr() -- start a new one.
            cache.add(key, 1, window_seconds)
            failures = 1

    if failures == LOCKOUT_MAX_FAILURES:
        logger.warning(
            "login lockout engaged account_fingerprint=%s failures=%s",
            _fingerprint(email)[:12],
            failures,
        )
    return failures


def clear_failures(email):
    cache.delete(_cache_key(email))

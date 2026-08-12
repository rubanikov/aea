from django.conf import settings
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.db import models


class UserManager(BaseUserManager):
    """Creates users keyed by email — there is no separate `username` field
    (see `User.USERNAME_FIELD`). Mirrors Django's own `UserManager`, just
    swapping the required identifier.
    """

    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("Users must have an email address.")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email=None, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email=None, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.ADMIN)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    """Custom user model swapped in before the first `migrate` (see
    TICKET-01's handoff notes) specifically so `role` could be a first-class,
    real column from day one instead of bolted on later.

    Extends `AbstractUser` — Django's documented safe path for a custom user
    model — rather than `AbstractBaseUser`, so password hashing (bcrypt, per
    `settings.PASSWORD_HASHERS`), permissions, and
    `is_staff`/`is_superuser`/`is_active` all come for free. The one
    deviation from stock `AbstractUser` is authentication
    by email instead of a separate username (see `USERNAME_FIELD` below) —
    the product has no concept of a username, only an email.
    """

    class Role(models.TextChoices):
        """Matches the `AppointmentStatus`-style enum convention set by
        architecture.md §4."""

        PATIENT = "patient", "Patient"
        PROVIDER = "provider", "Provider"
        ADMIN = "admin", "Admin"

    class Carrier(models.TextChoices):
        """US mobile carriers supported for SMS-via-email-gateway delivery.
        TICKET-04 stores the choice; TICKET-05's SMS sending consumes it.
        Same `TextChoices` convention as `Role` above."""

        VERIZON = "verizon", "Verizon"
        ATT = "att", "AT&T"
        TMOBILE = "tmobile", "T-Mobile"
        SPRINT = "sprint", "Sprint"
        USCELLULAR = "uscellular", "US Cellular"
        BOOST = "boost", "Boost Mobile"
        CRICKET = "cricket", "Cricket Wireless"
        METROPCS = "metropcs", "Metro by T-Mobile"
        GOOGLEFI = "googlefi", "Google Fi"

    username = None
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=255, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.PATIENT)
    phone = models.CharField(max_length=32, blank=True)
    # `""` means "no carrier set / SMS not possible" -- same blank-string
    # convention as `phone` above. Never required.
    sms_carrier = models.CharField(max_length=32, blank=True, default="", choices=Carrier.choices)
    timezone = models.CharField(max_length=64, default="UTC")
    # Set by TICKET-14's account-deletion flow when this row's PHI fields
    # get scrubbed. The row itself is never hard-deleted (see
    # `accounts.views.DeleteAccountView`) so `AuditLog.actor` keeps
    # resolving by id — this timestamp is how "was this account scrubbed"
    # stays queryable/auditable after the fact.
    deleted_at = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.email


class RefreshTokenRotation(models.Model):
    """The receipt for one refresh-token rotation: which token was retired,
    and the exact pair that was issued in its place.

    Rotation blacklists the old refresh token the instant a new one is issued
    (`BLACKLIST_AFTER_ROTATION`), which is what catches a stolen token being
    replayed. On its own, though, "this token is blacklisted" can't tell that
    apart from two browser tabs on the same account refreshing the same
    expired session within milliseconds of each other — one of which is a
    real attack and the other of which is a Tuesday.

    Keeping the receipt is what separates them: presented inside the grace
    window, the second tab gets handed the same pair the first one already
    got (idempotent replay — no new credential is minted); presented later,
    it's reuse, and the whole chain is revoked. See `accounts/tokens.py`.

    Storing the issued tokens verbatim matches what `token_blacklist`'s own
    `OutstandingToken.token` column already does with every refresh token
    this app issues, so it widens no existing exposure.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="refresh_rotations"
    )
    # The jti of the refresh token that was rotated out — the lookup key for
    # a client that presents it again.
    retired_jti = models.CharField(max_length=255, unique=True)
    # Its own `exp`, so rows can be pruned once the token they describe could
    # no longer be accepted anyway.
    expires_at = models.DateTimeField()
    rotated_at = models.DateTimeField(auto_now_add=True)
    issued_access_token = models.TextField()
    issued_refresh_token = models.TextField()
    # Tracked so a replay can check the pair it's about to hand back is still
    # live, rather than resurrecting a session that was revoked in between.
    issued_refresh_jti = models.CharField(max_length=255)

    class Meta:
        indexes = [models.Index(fields=["expires_at"])]

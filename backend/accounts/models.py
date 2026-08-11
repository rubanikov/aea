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

    username = None
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=255, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.PATIENT)
    phone = models.CharField(max_length=32, blank=True)
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

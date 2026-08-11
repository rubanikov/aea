import re
import zoneinfo

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone as django_timezone
from rest_framework import serializers

from audit.services import record_audit_event

User = get_user_model()

_PHONE_RE = re.compile(r"^\+?[0-9()\-.\s]{7,20}$")


def _run_password_validators(password, user=None):
    """Wraps Django's `AUTH_PASSWORD_VALIDATORS` (min length, common
    passwords, similarity to user attributes, not-all-numeric — see
    settings.py) and converts their exception type to DRF's."""
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({"password": list(exc.messages)}) from exc


class RegisterSerializer(serializers.ModelSerializer):
    """Patient self-service signup. Always creates a `patient` — there is no
    `role` field here at all, so a client cannot request `provider`/`admin`
    by passing extra fields; those roles are provisioned separately (see
    accounts/admin.py).
    """

    # Declared explicitly (rather than left for ModelSerializer to build
    # from the model field) so DRF doesn't also auto-attach a case-sensitive
    # `UniqueValidator` for the model's `unique=True` -- that would run
    # *before* `validate_email` below and win with its own generic message,
    # short-circuiting both the custom message and the case-insensitive
    # check.
    email = serializers.EmailField(validators=[])
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    class Meta:
        model = User
        fields = ["email", "password", "name"]

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        # Object-level (not field-level) so the password strength check can
        # weigh it against the email/name being registered, same as Django's
        # own `UserAttributeSimilarityValidator` expects.
        candidate = User(email=attrs.get("email", ""), name=attrs.get("name", ""))
        _run_password_validators(attrs["password"], user=candidate)
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(role=User.Role.PATIENT, **validated_data)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        user = authenticate(
            self.context["request"],
            username=attrs["email"].strip().lower(),
            password=attrs["password"],
        )
        if user is None:
            # Deliberately generic and not tied to the `email` field: naming
            # which one was wrong (unknown account vs. wrong password) lets
            # an attacker enumerate registered emails.
            raise serializers.ValidationError(
                "Invalid email or password.", code="invalid_credentials"
            )
        attrs["user"] = user
        return attrs


class UserSerializer(serializers.ModelSerializer):
    """Shared shape for `GET /auth/me` and `GET`/`PATCH /profile`."""

    # See RegisterSerializer.email for why this is declared explicitly
    # instead of left to ModelSerializer's auto-generated field.
    email = serializers.EmailField(validators=[])

    class Meta:
        model = User
        fields = ["id", "email", "name", "role", "phone", "timezone"]
        read_only_fields = ["id", "role"]

    def validate_email(self, value):
        value = value.strip().lower()
        already_taken = User.objects.filter(email=value).exclude(pk=self.instance.pk).exists()
        if already_taken:
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_phone(self, value):
        value = value.strip()
        if value and not _PHONE_RE.match(value):
            raise serializers.ValidationError("Enter a valid phone number.")
        return value

    def validate_timezone(self, value):
        if value not in zoneinfo.available_timezones():
            raise serializers.ValidationError(
                "Not a recognized IANA timezone name, e.g. 'America/Chicago'."
            )
        return value


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_current_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        user = self.context["request"].user
        _run_password_validators(value, user=user)
        return value

    def save(self):
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user


def _cancel_upcoming_appointments(user):
    """Cancels the patient's upcoming appointments as part of account
    deletion.

    Currently a no-op: `Booking` doesn't exist yet (TICKET-07). Once it
    does, this should cancel every upcoming `Booking` owned by `user` and
    return the count cancelled -- `DeleteAccountSerializer.save` already
    surfaces that count in the endpoint's response, so the frontend
    contract (`cancelled_appointments_count`) doesn't need to change when
    this is wired up.

    # TODO(TICKET-07/09): cancel real Booking rows once that model exists
    """
    return 0


class DeleteAccountSerializer(serializers.Serializer):
    """`POST /profile/delete-account`. The current password is required as
    server-side proof of intent -- a typed-confirmation modal is a
    client-side UX affordance (see the ticket), not a substitute for
    actually re-proving who's asking for an irreversible action."""

    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Incorrect password.")
        return value

    def save(self):
        user = self.context["request"].user

        # Logged while the actor's own identifying fields are still intact
        # -- the entry itself only ever references `user.id`, which stays
        # valid after the scrub below (the row is never hard-deleted).
        record_audit_event(
            actor=user,
            action="account:deletion_requested",
            target_type="user",
            target_id=user.id,
            metadata={"role": user.role},
        )
        cancelled_count = _cancel_upcoming_appointments(user)

        user.name = ""
        user.phone = ""
        user.email = f"deleted-user-{user.id}@deleted.invalid"
        user.is_active = False
        user.deleted_at = django_timezone.now()
        user.set_unusable_password()
        user.save()

        return cancelled_count

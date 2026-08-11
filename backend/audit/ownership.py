from django.core.exceptions import ImproperlyConfigured

from accounts.models import User

from .services import record_audit_event


def resource_owner(obj):
    """Resolve the `User` who owns `obj`, per whichever convention the
    resource model implements:

    - a `get_owner(self) -> User | None` method, or
    - an `owner_field_name = "patient"` class attribute naming the
      FK/attribute that holds the owner.

    A resource model needs exactly one of these — see `IsOwnerOrAdmin`'s
    docstring for the one-line versions of each. Raises
    `ImproperlyConfigured` if a model implements neither, rather than
    silently treating it as unowned (a resource that forgets to declare
    its owner should fail loudly in development, not fail open in
    production).
    """
    get_owner = getattr(obj, "get_owner", None)
    if callable(get_owner):
        return get_owner()

    owner_field_name = getattr(obj, "owner_field_name", None)
    if owner_field_name is None:
        raise ImproperlyConfigured(
            f"{type(obj).__name__} must implement get_owner() or set "
            "owner_field_name to be usable with the ownership-check utility "
            "(see audit/ownership.py)."
        )
    return getattr(obj, owner_field_name)


def target_type_for(obj):
    """`AuditLog.target_type` for `obj`: an explicit `audit_target_type`
    attribute on the model if it sets one, else the model's own class name
    lowercased (e.g. a `Booking` instance logs as `"booking"`)."""
    return getattr(obj, "audit_target_type", None) or type(obj).__name__.lower()


def user_owns_or_is_admin(user, obj, *, action, target_type=None, metadata=None):
    """Plain-function equivalent of `IsOwnerOrAdmin`, for non-DRF-view
    contexts (a management command, a signal handler, ...) that still need
    the same "owner, or logged admin bypass, or reject" decision without a
    `request`/`view` pair to hang a DRF permission class off of.

    Returns `True`/`False` — there's no HTTP response to shape here, so
    callers decide what "rejected" means in their own context (raise,
    skip, exit non-zero, ...). `action` is required and becomes part of
    the audit action string on an admin bypass (e.g.
    `action="cancel_booking"` logs as `"admin_bypass:cancel_booking"`) —
    keep it identifier-shaped, never a sentence containing PHI.
    """
    owner = resource_owner(obj)
    if owner is not None and owner.pk == user.pk:
        return True

    if user.role == User.Role.ADMIN:
        record_audit_event(
            actor=user,
            action=f"admin_bypass:{action}",
            target_type=target_type or target_type_for(obj),
            target_id=obj.pk,
            metadata=metadata,
        )
        return True

    return False

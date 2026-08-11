from rest_framework.permissions import BasePermission

from .ownership import target_type_for, user_owns_or_is_admin


class IsOwnerOrAdmin(BasePermission):
    """Object-level ownership check: a request reaches the object only if
    the requesting user owns it, or is an admin (an admin bypass is
    allowed through, but written to the audit log rather than silently
    permitted — see `audit.ownership.user_owns_or_is_admin`). Everyone
    else gets DRF's normal object-permission-denied response (403, or 404
    if the view sets `DjangoObjectPermissions`-style hiding — this class
    doesn't change that).

    Convention this expects the *resource model* (not this class, and not
    the view) to implement — one line, either of:

        class Booking(models.Model):
            patient = models.ForeignKey(User, ...)
            owner_field_name = "patient"

        class Booking(models.Model):
            def get_owner(self):
                return self.patient

    `get_owner()` wins if a model defines both. Optionally set
    `audit_target_type = "booking"` on the model too, if its lowercased
    class name isn't the right value to log as `AuditLog.target_type`.

    This is `has_object_permission` only — it needs an instance to check
    ownership against, so it can't filter a list queryset by itself (views
    still need their own `get_queryset()` scoping for list endpoints).
    Pair with `IsAuthenticated` for the request-level "must be logged in"
    check (already this project's default — see `DEFAULT_PERMISSION_CLASSES`
    in settings.py), and use it from a view that actually calls
    `check_object_permissions()` — DRF's generic views do this
    automatically inside `get_object()`; a bare `APIView` must call it
    explicitly.
    """

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        action = getattr(view, "audit_action", None) or request.method.lower()
        return user_owns_or_is_admin(
            request.user, obj, action=f"{action}:{target_type_for(obj)}"
        )

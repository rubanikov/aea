"""`bookings`-specific object permissions.

`audit.permissions.IsOwnerOrAdmin` (and the `audit.ownership
.user_owns_or_is_admin` function it wraps) check ownership via
`Booking.owner_field_name`, which is always `"patient"` (see that model
attribute's docstring) -- the axis a *patient* viewing/cancelling their own
booking needs (TICKET-09). A provider managing their own calendar (this
ticket) is a different, independent ownership axis over the same model:
`booking.provider`, not `booking.patient`. Reusing `IsOwnerOrAdmin` here
would check the wrong field, so this is its own permission class -- same
"owner, or a logged admin bypass, or reject" shape as `IsOwnerOrAdmin`,
just keyed to `provider` instead.
"""

from rest_framework.permissions import BasePermission

from accounts.models import User
from audit.services import record_audit_event


class IsBookingProviderOrAdmin(BasePermission):
    """Object-level check for `PATCH /bookings/<id>/status`
    (`bookings.views.BookingStatusView`): only the booking's own
    `provider`, or an admin, reaches the transition. An admin bypass is
    allowed through but written to the audit log -- matching
    `IsOwnerOrAdmin`'s `admin_bypass:<action>:<target_type>` action-string
    convention exactly, so the two read the same way in the audit trail.
    """

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if obj.provider_id == request.user.pk:
            return True

        if request.user.role == User.Role.ADMIN:
            action = getattr(view, "audit_action", None) or request.method.lower()
            record_audit_event(
                actor=request.user,
                action=f"admin_bypass:{action}:booking",
                target_type="booking",
                target_id=obj.pk,
            )
            return True

        return False

from rest_framework.permissions import BasePermission

from .models import User


class HasRole(BasePermission):
    """Reusable role-check primitive: `HasRole(User.Role.PROVIDER)` (or any
    number of roles) only allows authenticated users whose `role` is one of
    the given values.

    This ticket doesn't yet have a role-restricted resource to attach it to
    — row-level ownership enforcement is TICKET-03 — but the role itself
    has to be real and checkable now (see this ticket's acceptance
    criteria), so this is that: a genuine, tested permission class future
    tickets compose with `IsAuthenticated` on their own views, e.g.
    `permission_classes = [IsAuthenticated, HasRole(User.Role.PROVIDER)]`.
    """

    def __init__(self, *roles):
        self.roles = frozenset(roles)

    def __call__(self):
        # DRF instantiates every entry in `permission_classes`; returning
        # self from `__call__` lets `HasRole(...)` be used the same way as
        # a plain permission class reference.
        return self

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if user is None or not user.is_authenticated:
            return False
        return user.role in self.roles


IsAdminRole = HasRole(User.Role.ADMIN)

"""Stand-in resources for exercising the ownership-check utility without a
real ORM-backed model — TICKET-04+'s actual resource models don't exist
yet, so these mirror the two adoption conventions
`audit.ownership.resource_owner` documents (`get_owner()` and
`owner_field_name`), the same way `accounts/tests/test_permissions.py`
unit-tests `HasRole` against plain objects rather than a fixture model.
"""


class DummyBooking:
    """Adopts the `get_owner()` convention."""

    audit_target_type = "booking"

    def __init__(self, pk, owner):
        self.pk = pk
        self._owner = owner

    def get_owner(self):
        return self._owner


class DummyAvailability:
    """Adopts the `owner_field_name` convention."""

    owner_field_name = "provider"

    def __init__(self, pk, provider):
        self.pk = pk
        self.provider = provider


class DummyUnconfigured:
    """Implements neither convention -- the "a resource model forgot to
    opt in" case."""

    def __init__(self, pk):
        self.pk = pk

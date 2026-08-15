from datetime import datetime, time
from datetime import timezone as dt_timezone

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import generics, serializers

from accounts.permissions import IsAdminRole

from .models import AuditLog
from .pagination import AuditLogPagination
from .serializers import AuditLogSerializer
from .services import record_audit_event


def _parse_date_boundary(field_name, raw_value, *, end_of_day):
    """Parse a `date_from`/`date_to` query param: either a full ISO 8601
    datetime, or a bare `yyyy-mm-dd` date (what the frontend's filter form
    sends -- see `frontend/lib/audit/types.ts`). A bare date expands to
    that day's UTC start (`date_from`) or end (`date_to`), so
    `date_from=date_to=2026-08-01` still matches every event that day.
    """
    parsed = parse_datetime(raw_value)
    if parsed is None:
        parsed_date = parse_date(raw_value)
        if parsed_date is None:
            raise serializers.ValidationError(
                {
                    field_name: (
                        "Must be an ISO 8601 date or datetime, e.g. "
                        "'2026-08-01' or '2026-08-01T00:00:00Z'."
                    )
                }
            )
        parsed = datetime.combine(parsed_date, time.max if end_of_day else time.min)

    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, dt_timezone.utc)
    return parsed


class AuditLogListView(generics.ListAPIView):
    """`GET /audit-log` -- admin-only, paginated, filterable read of the
    full audit trail (TICKET-03's admin audit-log viewer: this is the
    backend half, the screen itself is frontend-builder's, consuming this
    under `frontend/lib/audit/`).

    Deliberately a plain `ListAPIView`: there is no create/update/delete
    route for this resource, on top of `AuditLog` having no exposed
    mutation path anywhere else in this app (see `audit/models.py`,
    `audit/admin.py`).

    Query params, all optional: `actor` (user id), `action` (substring
    match against the free-text action string), `target_type` (exact
    match), `date_from`/`date_to` (ISO 8601 or `yyyy-mm-dd`, inclusive of
    the named day), `page`, `page_size` (default 25, max 100).

    Every successful read of this endpoint writes its own
    `read:audit_log` entry (security-audit pass: reads of the audit trail
    itself must leave a trace) -- see `list` below for the ordering.
    """

    serializer_class = AuditLogSerializer
    permission_classes = [IsAdminRole]
    pagination_class = AuditLogPagination

    def list(self, request, *args, **kwargs):
        # `super().list()` first: the page is queried and serialized
        # before this read's own entry is inserted, so a response never
        # contains the row recording itself (and a rejected request --
        # bad filter param, non-admin -- raises before reaching this line
        # and logs nothing, since no data was returned). Metadata stays
        # IDs only per `record_audit_event`'s convention -- the filter
        # params aren't recorded because `action` is free text.
        response = super().list(request, *args, **kwargs)
        record_audit_event(
            actor=request.user,
            action="read:audit_log",
            target_type="audit_log",
            target_id="*",
            metadata=None,
        )
        return response

    def get_queryset(self):
        queryset = AuditLog.objects.all()
        params = self.request.query_params

        actor = params.get("actor")
        if actor:
            queryset = queryset.filter(actor_id=self._parse_int("actor", actor))

        action = params.get("action")
        if action:
            queryset = queryset.filter(action__icontains=action)

        target_type = params.get("target_type")
        if target_type:
            queryset = queryset.filter(target_type=target_type)

        date_from = params.get("date_from")
        if date_from:
            lower_bound = _parse_date_boundary("date_from", date_from, end_of_day=False)
            queryset = queryset.filter(timestamp__gte=lower_bound)

        date_to = params.get("date_to")
        if date_to:
            upper_bound = _parse_date_boundary("date_to", date_to, end_of_day=True)
            queryset = queryset.filter(timestamp__lte=upper_bound)

        return queryset

    @staticmethod
    def _parse_int(field_name, raw_value):
        try:
            return int(raw_value)
        except ValueError:
            raise serializers.ValidationError({field_name: "Must be an integer user id."})

from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    """Read-only shape for `GET /audit-log`. Every field is read-only —
    this serializer backs a list-only view (`audit/views.py`) and is never
    used to construct or mutate a row; `id`/`actor`/`target_id` are cast
    to strings (rather than left as DRF's default integer rendering) to
    match the frontend's `AuditLogEntry` contract (`frontend/lib/audit/types.ts`).
    """

    id = serializers.CharField(read_only=True)
    actor = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ["id", "actor", "action", "target_type", "target_id", "timestamp", "metadata"]
        read_only_fields = fields

    def get_actor(self, obj):
        # `None` for system-initiated entries (see AuditLog.actor) --
        # never a name/email, an id or nothing, per "log entries reference
        # IDs only."
        return str(obj.actor_id) if obj.actor_id is not None else None

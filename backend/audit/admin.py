from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Read-only by construction: `has_add/change/delete_permission` all
    return `False`, so nothing about this registration opens an update or
    delete path -- Django admin's own UI simply omits the buttons for
    actions it isn't permitted, and the underlying views 403 if hit
    directly. The one intended write path stays
    `audit.services.record_audit_event` (see `audit/models.py`).
    """

    ordering = ["-timestamp"]
    list_display = ["timestamp", "actor", "action", "target_type", "target_id"]
    list_filter = ["target_type"]
    search_fields = ["action", "target_type", "target_id"]
    date_hierarchy = "timestamp"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

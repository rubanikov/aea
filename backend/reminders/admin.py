from django.contrib import admin

from .models import ReminderLog


@admin.register(ReminderLog)
class ReminderLogAdmin(admin.ModelAdmin):
    """Read-only, same shape as `audit.admin.AuditLogAdmin` -- the one
    intended write path stays `reminders.services.dispatch_due_reminders`.
    """

    ordering = ["-sent_at"]
    list_display = ["id", "booking", "interval", "sent_at"]
    list_filter = ["interval"]
    search_fields = ["booking__id"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

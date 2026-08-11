from django.contrib import admin

from .models import AppointmentType, Availability, BlockedTime


@admin.register(Availability)
class AvailabilityAdmin(admin.ModelAdmin):
    """Read-only, same shape as `audit.admin.AuditLogAdmin` -- writes go
    through this app's own guarded views instead, never through
    `/admin/` directly.
    """

    list_display = ["provider", "day_of_week", "start_time", "end_time"]
    list_filter = ["day_of_week"]
    search_fields = ["provider__email"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AppointmentType)
class AppointmentTypeAdmin(admin.ModelAdmin):
    """Read-only, same shape as `audit.admin.AuditLogAdmin` -- writes go
    through this app's own guarded views instead, never through
    `/admin/` directly.
    """

    list_display = ["provider", "name", "duration_minutes"]
    search_fields = ["provider__email", "name"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(BlockedTime)
class BlockedTimeAdmin(admin.ModelAdmin):
    """Read-only, same shape as `audit.admin.AuditLogAdmin` -- writes go
    through this app's own guarded views instead, never through
    `/admin/` directly.
    """

    list_display = ["provider", "start", "end", "label"]
    search_fields = ["provider__email", "label"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

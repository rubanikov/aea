from django.contrib import admin

from .models import Booking


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    """Read-only, same shape as `audit.admin.AuditLogAdmin`: a change made
    here wouldn't go through `bookings.transitions.transition()`'s guard
    rules (the allowed-transition table, the no-show/cancellation-notice
    timing rules) and wouldn't write an `AuditLog` entry either -- every
    write to a `Booking` stays through this app's own guarded views.
    """

    list_display = ["id", "provider", "patient", "appointment_type", "start_time", "status"]
    list_filter = ["status"]
    search_fields = ["provider__email", "patient__email"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

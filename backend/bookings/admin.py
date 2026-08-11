from django.contrib import admin

from .models import Booking


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ["id", "provider", "patient", "appointment_type", "start_time", "status"]
    list_filter = ["status"]
    search_fields = ["provider__email", "patient__email"]

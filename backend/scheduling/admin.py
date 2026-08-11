from django.contrib import admin

from .models import AppointmentType, Availability, BlockedTime


@admin.register(Availability)
class AvailabilityAdmin(admin.ModelAdmin):
    list_display = ["provider", "day_of_week", "start_time", "end_time"]
    list_filter = ["day_of_week"]
    search_fields = ["provider__email"]


@admin.register(AppointmentType)
class AppointmentTypeAdmin(admin.ModelAdmin):
    list_display = ["provider", "name", "duration_minutes"]
    search_fields = ["provider__email", "name"]


@admin.register(BlockedTime)
class BlockedTimeAdmin(admin.ModelAdmin):
    list_display = ["provider", "start", "end", "label"]
    search_fields = ["provider__email", "label"]

from django.urls import path

from . import views

urlpatterns = [
    path(
        "scheduling/availability",
        views.AvailabilityListView.as_view(),
        name="availability-list",
    ),
    path(
        "scheduling/schedule",
        views.ProviderScheduleView.as_view(),
        name="provider-schedule",
    ),
    path(
        "scheduling/schedule/pending",
        views.PendingScheduleView.as_view(),
        name="provider-schedule-pending",
    ),
    path(
        "scheduling/appointment-types",
        views.AppointmentTypeListCreateView.as_view(),
        name="appointment-type-list",
    ),
    path(
        "scheduling/appointment-types/<int:pk>",
        views.AppointmentTypeDetailView.as_view(),
        name="appointment-type-detail",
    ),
    path(
        "scheduling/blocked-time",
        views.BlockedTimeListCreateView.as_view(),
        name="blocked-time-list",
    ),
    path(
        "scheduling/blocked-time/<int:pk>",
        views.BlockedTimeDetailView.as_view(),
        name="blocked-time-detail",
    ),
    path("scheduling/slots", views.SlotsView.as_view(), name="slots"),
    path("scheduling/providers", views.ProviderListView.as_view(), name="provider-list"),
    path(
        "scheduling/providers/<int:pk>/appointment-types",
        views.ProviderAppointmentTypesView.as_view(),
        name="provider-appointment-type-list",
    ),
]

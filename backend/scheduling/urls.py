from django.urls import path

from . import views

urlpatterns = [
    path(
        "scheduling/availability",
        views.AvailabilityListCreateView.as_view(),
        name="availability-list",
    ),
    path(
        "scheduling/availability/<int:pk>",
        views.AvailabilityDetailView.as_view(),
        name="availability-detail",
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
    path("scheduling/slots", views.SlotsView.as_view(), name="slots"),
]

from django.urls import path

from . import views

urlpatterns = [
    path("bookings", views.BookingListCreateView.as_view(), name="booking-list-create"),
    path("bookings/<int:pk>/status", views.BookingStatusView.as_view(), name="booking-status"),
]

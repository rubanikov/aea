from django.urls import path

from . import views

urlpatterns = [
    path("bookings", views.BookingListCreateView.as_view(), name="booking-list-create"),
    path("bookings/mine", views.BookingMineListView.as_view(), name="booking-mine-list"),
    path("bookings/<int:pk>/status", views.BookingStatusView.as_view(), name="booking-status"),
    path("bookings/<int:pk>/cancel", views.BookingCancelView.as_view(), name="booking-cancel"),
]

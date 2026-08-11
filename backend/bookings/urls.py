from django.urls import path

from . import views

urlpatterns = [
    path("bookings", views.BookingCreateView.as_view(), name="booking-create"),
]

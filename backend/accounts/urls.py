from django.urls import path

from . import views

urlpatterns = [
    path("auth/register", views.RegisterView.as_view(), name="register"),
    path("auth/login", views.LoginView.as_view(), name="login"),
    path("auth/logout", views.LogoutView.as_view(), name="logout"),
    path("auth/refresh", views.RefreshView.as_view(), name="refresh"),
    path("auth/me", views.MeView.as_view(), name="me"),
    path("profile", views.ProfileView.as_view(), name="profile"),
    path("profile/password", views.ChangePasswordView.as_view(), name="change-password"),
    path("profile/delete-account", views.DeleteAccountView.as_view(), name="delete-account"),
]

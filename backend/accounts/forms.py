from django.contrib.auth.forms import BaseUserCreationForm
from django.contrib.auth.forms import UserChangeForm as DjangoUserChangeForm

from .models import User


class UserCreationForm(BaseUserCreationForm):
    """Django admin's add-user form, rebuilt around `email` instead of the
    `username` field this project's `User` model doesn't have. Subclasses
    `BaseUserCreationForm` (not `UserCreationForm`) because the latter's
    `clean_username` hardcodes a `username` field that no longer exists.
    """

    class Meta(BaseUserCreationForm.Meta):
        model = User
        fields = ("email",)
        field_classes = {}


class UserChangeForm(DjangoUserChangeForm):
    """Django admin's edit-user form, same `username` -> `email` swap as
    `UserCreationForm` above."""

    class Meta(DjangoUserChangeForm.Meta):
        model = User
        fields = "__all__"
        field_classes = {}

from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from core.views import health_check

urlpatterns = [
    path("health", health_check, name="health-check"),
    path("", include("accounts.urls")),
    path("", include("audit.urls")),
    path("", include("scheduling.urls")),
    path("", include("bookings.urls")),
]

# /admin/ is a dev convenience (the domain ModelAdmins are read-only; the
# one writable piece, accounts/admin.py's provider/admin provisioning, is a
# staff workflow that doesn't need a public host). Its login form is
# *unthrottled* -- DRF's throttles only cover DRF views -- so mounting it on
# the public host hands attackers unlimited password attempts against
# staff/admin accounts. DEBUG-only keeps it off production. RUNNING_TESTS
# keeps it available to `manage.py test` (which runs with DEBUG off on
# purpose -- see settings.py) so the provisioning workflow stays tested; the
# same carve-out idiom settings.py uses for SECURE_SSL_REDIRECT.
if settings.DEBUG or settings.RUNNING_TESTS:
    urlpatterns.insert(0, path("admin/", admin.site.urls))

# Non-DRF paths get the same "structured JSON, never an HTML error page"
# treatment core/exceptions.py gives DRF endpoints -- the API's only client
# parses JSON. Only active when DEBUG is off; DEBUG keeps Django's
# traceback page.
handler500 = "core.views.server_error"

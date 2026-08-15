"""The API-wide graceful-degradation contract (core/exceptions.py +
core.views.server_error): any endpoint hit by a database outage or an
unexpected bug answers with structured JSON and the right status -- the
same "always returns JSON, never a 500 HTML page" standard health_check
sets for itself in core/tests/test_health.py.

This module doubles as its own ROOT_URLCONF (via override_settings below):
the stand-in views raise the exceptions a real endpoint would, at the same
seam -- over HTTP through Django's full middleware/handler stack.
"""

from django.db.utils import OperationalError
from django.test import Client, TestCase, override_settings
from django.urls import path
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from core.exceptions import DATABASE_UNAVAILABLE_DETAIL, UNEXPECTED_ERROR_DETAIL


class DbOutageView(APIView):
    """Stands in for any ordinary endpoint whose ORM call hits a dead
    database mid-request (the health_check mock-outage idiom, applied to a
    non-health endpoint)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        raise OperationalError("mock db outage")


class UnexpectedErrorView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        raise RuntimeError("mock unexpected bug")


def plain_django_view_that_raises(request):
    raise RuntimeError("mock unexpected bug outside DRF")


urlpatterns = [
    path("boom-db", DbOutageView.as_view()),
    path("boom", UnexpectedErrorView.as_view()),
    path("boom-plain", plain_django_view_that_raises),
]

# Same wiring as config/urls.py, so the non-DRF fallback is exercised too.
handler500 = "core.views.server_error"


@override_settings(ROOT_URLCONF="core.tests.test_exception_handling")
class ApiExceptionHandlerTests(TestCase):
    def test_database_outage_returns_structured_json_503(self):
        with self.assertLogs("core.exceptions", level="ERROR") as logs:
            response = self.client.get("/boom-db")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["Content-Type"], "application/json")
        self.assertEqual(response.json(), {"detail": DATABASE_UNAVAILABLE_DETAIL})
        # Exception class is logged; the message (which could carry SQL
        # parameter values on a real error) is not.
        self.assertIn("OperationalError", logs.output[0])
        self.assertNotIn("mock db outage", "".join(logs.output))

    def test_unexpected_exception_returns_structured_json_500(self):
        with self.assertLogs("core.exceptions", level="ERROR") as logs:
            response = self.client.get("/boom")

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers["Content-Type"], "application/json")
        self.assertEqual(response.json(), {"detail": UNEXPECTED_ERROR_DETAIL})
        # logger.exception -- the full traceback lands in the log entry.
        self.assertIn("RuntimeError", "".join(logs.output))
        self.assertIn("Traceback", "".join(logs.output))


@override_settings(ROOT_URLCONF="core.tests.test_exception_handling")
class Handler500Tests(TestCase):
    def test_non_drf_view_error_returns_structured_json_500(self):
        # raise_request_exception=False: unlike the DRF cases above, this
        # exception genuinely escapes the view, and the default test client
        # would re-raise it instead of showing us the 500 response a real
        # client receives.
        client = Client(raise_request_exception=False)

        response = client.get("/boom-plain")

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers["Content-Type"], "application/json")
        self.assertEqual(response.json(), {"detail": UNEXPECTED_ERROR_DETAIL})

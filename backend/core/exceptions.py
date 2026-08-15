"""API-wide graceful degradation for unhandled exceptions.

core/views.py's health_check sets the project's standard for itself --
"always returns JSON, never a 500" -- but until this module that standard
stopped at /health: a database outage mid-request on any ordinary endpoint
(POST /bookings while Postgres restarts) surfaced as Django's generic 500,
which the frontend can't parse and can't distinguish from a bug. This
handler extends the standard to every DRF endpoint:

  - django.db.Error (OperationalError and friends) becomes a structured,
    retryable JSON 503 -- an outage is an expected, reportable condition,
    not an application error.
  - Anything else unhandled still logs its full traceback, but goes out as
    structured JSON 500 instead of Django's HTML debug/error page.

Wired via REST_FRAMEWORK["EXCEPTION_HANDLER"] (settings.py). Non-DRF paths
get the same JSON treatment from handler500 (config/urls.py ->
core.views.server_error).
"""

import logging

from django.db import Error as DatabaseError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)

DATABASE_UNAVAILABLE_DETAIL = "Service temporarily unavailable. Please try again shortly."
UNEXPECTED_ERROR_DETAIL = "An unexpected error occurred."


def api_exception_handler(exc, context):
    # DRF's own handler first: APIException subclasses (validation errors,
    # throttling, auth failures, 404s) already carry the right status and
    # JSON shape -- those are handled responses, not degradation.
    response = drf_exception_handler(exc, context)
    if response is not None:
        return response

    view = context.get("view")
    view_name = type(view).__name__ if view is not None else "unknown"

    if isinstance(exc, DatabaseError):
        # Exception *class* only, never its message -- a database error
        # string can embed the failing SQL with parameter values (PHI).
        logger.error(
            "database error in %s: %s -- returning 503", view_name, type(exc).__name__
        )
        return Response(
            {"detail": DATABASE_UNAVAILABLE_DETAIL},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    logger.exception("unhandled exception in %s", view_name)
    return Response(
        {"detail": UNEXPECTED_ERROR_DETAIL},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )

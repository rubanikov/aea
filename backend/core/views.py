import logging

from django.db import Error as DatabaseError
from django.db import connection
from django.http import JsonResponse

logger = logging.getLogger(__name__)


def health_check(request):
    """Report app + database reachability for uptime monitoring.

    Always returns JSON, never a 500: a database outage is an expected,
    reportable condition here, not an unhandled error.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except DatabaseError:
        logger.error("health_check: database unreachable")
        return JsonResponse({"status": "degraded", "database": "unreachable"}, status=503)
    return JsonResponse({"status": "ok", "database": "reachable"})


def server_error(request):
    """JSON 500 for exceptions outside DRF's reach (handler500 in
    config/urls.py).

    DRF endpoints never get here -- core/exceptions.py already converts
    their uncaught exceptions to JSON before Django's error handling sees
    them. This covers the rest (middleware failures, non-DRF views): the
    only client of this API parses JSON, so Django's default HTML error page
    is useless to it. The traceback itself is already logged by
    django.request before this view runs; path only here, IDs-in-URLs at
    most, never PHI.
    """
    logger.error("server_error: unhandled exception path=%s", request.path)
    return JsonResponse({"detail": "An unexpected error occurred."}, status=500)

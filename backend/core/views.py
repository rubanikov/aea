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

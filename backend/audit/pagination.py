from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class AuditLogPagination(PageNumberPagination):
    """`{results, count, page, page_size}` rather than DRF's default
    `{results, count, next, previous}` -- matches the frontend's
    `AuditLogResponse` contract (`frontend/lib/audit/types.ts`), which
    tracks the current page number directly instead of following `next`/
    `previous` URLs.
    """

    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_paginated_response(self, data):
        return Response(
            {
                "results": data,
                "count": self.page.paginator.count,
                "page": self.page.number,
                "page_size": self.page.paginator.per_page,
            }
        )

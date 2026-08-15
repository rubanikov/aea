"""Keeps session-scoped API responses out of shared caches.

Every authenticated response this API returns is written for exactly one
session: `GET /auth/me` answers with the caller's name, email and role,
`/appointments` with their PHI. None of it carries an explicit cache
lifetime of its own, and DRF's `Vary` header only mentions `Accept` and
`origin` -- so a cache sitting anywhere between the browser and Django (a
CDN, a corporate proxy, the browser's own store) is free to key an entry on
the URL alone and hand one person's response to the next caller.

That failure is quiet and looks like a bug elsewhere: the frontend's route
guard decides access by reading `role` from `GET /auth/me` (see
`frontend/proxy.ts`), so one stale identity served from a cache turns into a
wrong "access denied" on a page the visitor really does own -- with their
name and email leaked to whoever else was served the same entry.

`no-store` keeps such a response from being written down at all; `Vary:
Cookie` keys it to the session for any cache that stores it regardless.
Responses that set `Cache-Control` themselves have already made a
deliberate decision (Django's admin marks its own views never-cache,
WhiteNoise gives static assets a long lifetime) and are left alone.
"""

from django.conf import settings
from django.http import JsonResponse
from django.utils.cache import add_never_cache_headers, patch_vary_headers


class NoStoreSessionScopedResponsesMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if response.has_header("Cache-Control"):
            return response

        add_never_cache_headers(response)
        patch_vary_headers(response, ("Cookie",))
        return response


class RequestBodySizeLimitMiddleware:
    """Rejects any request whose declared body exceeds
    `settings.MAX_REQUEST_BODY_BYTES` with a JSON 413 before the body is
    read.

    Django's own `DATA_UPLOAD_MAX_MEMORY_SIZE` guards `request.body` and
    form/multipart parsing, but DRF's JSON parser reads the raw stream
    directly, so that setting never fires for this API's endpoints. Every
    legitimate payload here is small -- a booking is three fields, the
    biggest schedule PUT is a few dozen windows, a cancellation reason is
    capped at 500 characters -- so a hard, low ceiling costs nothing and
    means an oversized body can't reach `json.loads` in memory. Checked on
    `Content-Length` only: a request that omits it carries no body as far
    as DRF is concerned (`Request._load_stream` treats a missing length as
    an empty stream).
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            content_length = int(request.META.get("CONTENT_LENGTH") or 0)
        except (TypeError, ValueError):
            content_length = 0

        limit = settings.MAX_REQUEST_BODY_BYTES
        if limit is not None and content_length > limit:
            return JsonResponse(
                {"detail": f"Request body too large (limit {limit} bytes)."},
                status=413,
            )
        return self.get_response(request)

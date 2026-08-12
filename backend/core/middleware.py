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

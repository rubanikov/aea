"""CSRF mitigation for cookie-delivered JWTs.

DRF's `APIView` marks every view `csrf_exempt` at the Django level (so
`CsrfViewMiddleware` never runs for it), and `SessionAuthentication` is the
only DRF authentication class that re-applies a CSRF check of its own. Since
this app authenticates via `CookieJWTAuthentication` instead (see
`accounts/authentication.py`), neither of those checks fire — and a
browser-attached cookie is otherwise exactly the CSRF shape (a forged
cross-site request would ride along with it). This module is the mitigation:
every state-changing request must carry `X-Requested-With: XMLHttpRequest`,
a header only same-origin JavaScript can attach (a cross-site `<form>`
submission — the classic CSRF vector — cannot set custom headers). Combined
with `SameSite=Strict` on the cookies themselves (`accounts/tokens.py`),
a forged cross-site request is blocked twice over.
"""

from rest_framework import exceptions

REQUIRED_HEADER = "X-Requested-With"
REQUIRED_HEADER_VALUE = "XMLHttpRequest"


def enforce_ajax_header(request):
    """Raise 403 unless the request carries the required client header.

    Call this from any view that reads an auth cookie directly for an
    unsafe method without going through `CookieJWTAuthentication` (which
    already enforces it for authenticated requests).
    """
    if request.headers.get(REQUIRED_HEADER) != REQUIRED_HEADER_VALUE:
        raise exceptions.PermissionDenied(
            "Missing required client header for a state-changing request."
        )

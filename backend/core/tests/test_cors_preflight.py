"""CORS preflight coverage for the custom request headers the frontend
actually sends.

Every other test in this suite talks to the API through Django's test
client, which is same-origin by construction and never runs a preflight --
so a header the browser would refuse to send still arrives here and the
endpoint tests pass. The real deployment is always cross-origin (Next.js
on its own port locally, its own domain in production), and a custom
header missing from `CORS_ALLOW_HEADERS` means the browser blocks the
request *before* it is sent: the server sees only the `OPTIONS` preflight,
never the `POST`, and the frontend's `fetch` rejects with a network-level
`TypeError` rather than an `ApiError` it could report usefully.

That's the exact shape of the "Couldn't book this appointment" bug, so
these tests assert the preflight contract per header rather than the
setting's literal contents.
"""

from django.test import Client, TestCase, override_settings

FRONTEND_ORIGIN = "http://localhost:3003"


@override_settings(CORS_ALLOWED_ORIGINS=[FRONTEND_ORIGIN])
class BookingPreflightTests(TestCase):
    def preflight(self, path, *, method, headers):
        return Client().options(
            path,
            HTTP_ORIGIN=FRONTEND_ORIGIN,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD=method,
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS=headers,
        )

    def allowed_headers(self, response):
        return {
            header.strip().lower()
            for header in response.headers.get("access-control-allow-headers", "").split(",")
            if header.strip()
        }

    def test_preflight_allows_the_idempotency_key_header_post_bookings_sends(self):
        # `frontend/components/booking/ConfirmStep.tsx` puts the booking's
        # idempotency key in this header on every `POST /bookings`. Without
        # it here the browser never sends the booking at all.
        response = self.preflight(
            "/bookings", method="POST", headers="content-type,idempotency-key,x-requested-with"
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("idempotency-key", self.allowed_headers(response))

    def test_preflight_allows_the_csrf_mitigation_header_every_unsafe_request_sends(self):
        # `frontend/lib/api/client.ts` attaches this to every unsafe-method
        # request; `accounts/csrf.py` rejects the request without it.
        response = self.preflight(
            "/bookings", method="POST", headers="content-type,x-requested-with"
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("x-requested-with", self.allowed_headers(response))

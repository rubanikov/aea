/**
 * Extracts a specific, server-provided error message from a
 * `PATCH /bookings/:id/status` 400 response body, e.g.
 * `{"detail": "Can't mark no-show before the appointment start time."}` --
 * matching the `{"detail": str(exc)}` shape `backend/bookings/views.py`
 * already uses for its own domain-error responses (`SlotNotOpen`/
 * `SlotNoLongerAvailable`). Falls back to `null` for a body that doesn't
 * match, so callers can supply their own generic fallback message rather
 * than rendering nothing.
 */
export function extractBookingErrorDetail(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "detail" in body &&
    typeof (body as { detail: unknown }).detail === "string"
  ) {
    return (body as { detail: string }).detail;
  }
  return null;
}

/**
 * Extracts a specific, server-provided error message from a
 * `PATCH /bookings/:id/status` 400 response body, e.g.
 * `{"detail": "Can't mark no-show before the appointment start time."}`.
 * Matches the `{"detail": str(exc)}` shape `backend/bookings/views.py`
 * uses for its own domain-error responses (`SlotNotOpen`/
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

/**
 * Extracts the first `cancellation_reason` field error from a
 * `PATCH /bookings/:id/status` 400 response body, e.g.
 * `{"cancellation_reason": ["This field is required."]}` — DRF's standard
 * field-error shape, distinct from the `{"detail": ...}` domain-error
 * shape `extractBookingErrorDetail` handles. Returns `null` when the body
 * doesn't match, so `AgendaRow` can fall through to the detail/generic
 * error path instead of misfiling other 400s under the textarea.
 */
export function extractCancellationReasonError(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("cancellation_reason" in body)) {
    return null;
  }
  const errors = (body as { cancellation_reason: unknown }).cancellation_reason;
  if (Array.isArray(errors) && typeof errors[0] === "string") {
    return errors[0];
  }
  return null;
}

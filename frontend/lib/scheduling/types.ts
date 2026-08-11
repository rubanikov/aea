/**
 * Patient-facing browse/discovery types (TICKET-06). `AppointmentType`
 * itself isn't redeclared here -- `GET /scheduling/providers/:id/appointment-types`
 * returns the exact same `{id, name, duration_minutes}` shape as the
 * provider's own `GET /scheduling/appointment-types`
 * (`lib/availability/types.ts`), just scoped to one provider instead of
 * "mine" -- so call sites import that existing type directly rather than
 * this file declaring a duplicate.
 */

/**
 * One provider a patient can browse/book with, as assumed from
 * `GET /scheduling/providers` (built in parallel by the backend half of
 * this ticket -- there is no existing `backend/scheduling/` route for this
 * yet to confirm against; adapt if the real shape differs).
 */
export interface Provider {
  id: number;
  name: string;
  timezone: string;
}

/** One open, bookable window, as `SlotSerializer` returns it from
 * `GET /scheduling/slots` (already real, TICKET-04/05). `start`/`end` are
 * UTC ISO 8601 instants. */
export interface Slot {
  start: string;
  end: string;
}

/**
 * `GET /scheduling/slots`'s full response body. `bookable: false` (with a
 * human-readable `reason`) is how the endpoint distinguishes "this provider
 * hasn't configured any working hours yet" from "configured, but nothing
 * open in this particular date range" -- the two need different empty-state
 * messaging (see `SlotBrowser.tsx`).
 */
export interface SlotsResponse {
  provider_id: number;
  appointment_type_id: number;
  date_from: string;
  date_to: string;
  bookable: boolean;
  reason: string | null;
  slots: Slot[];
}

/**
 * A confirmed appointment, as `POST /bookings` returns it on success
 * (TICKET-07). Matches `backend/bookings/serializers.py`'s
 * `BookingSerializer` exactly. Auto-accept means a booking is created
 * directly as `status: "confirmed"` -- there's no separate
 * pending/awaiting-approval status for the frontend to ever render here.
 */
export interface Booking {
  id: number;
  provider_id: number;
  patient_id: number;
  appointment_type_id: number;
  start_time: string;
  end_time: string;
  status: string;
}

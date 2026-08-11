/**
 * Patient-facing browse/discovery types. `AppointmentType` itself isn't
 * redeclared here: `GET /scheduling/providers/:id/appointment-types`
 * returns the same `{id, name, duration_minutes}` shape as the provider's
 * own `GET /scheduling/appointment-types` (`lib/availability/types.ts`),
 * just scoped to one provider instead of "mine", so call sites import
 * that existing type directly rather than this file declaring a duplicate.
 */

/** One provider a patient can browse/book with, from `GET /scheduling/providers`. */
export interface Provider {
  id: number;
  name: string;
  timezone: string;
}

/** One open, bookable window, as `SlotSerializer` returns it from
 * `GET /scheduling/slots`. `start`/`end` are UTC ISO 8601 instants. */
export interface Slot {
  start: string;
  end: string;
}

/**
 * `GET /scheduling/slots`'s full response body. `bookable: false` (with a
 * human-readable `reason`) is how the endpoint distinguishes "this provider
 * hasn't configured any working hours yet" from "configured, but nothing
 * open in this particular date range"; the two need different empty-state
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
 * A confirmed appointment, as `POST /bookings` returns it on success.
 * Matches `backend/bookings/serializers.py`'s `BookingSerializer`.
 * Auto-accept means a booking is created directly as `status: "confirmed"`,
 * so there's no separate pending/awaiting-approval status for the
 * frontend to ever render here.
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

/**
 * `PATCH /bookings/<id>/reschedule`'s success response: `Booking`'s own
 * canonical shape, for the newly-created booking, plus one extra field,
 * `previous_booking_id`, the id of the now-`cancelled` booking this
 * replaced.
 */
export interface RescheduledBooking extends Booking {
  previous_booking_id: number;
}

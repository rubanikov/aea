/**
 * Provider-facing booking types. `GET /bookings?date_from=&date_to=`
 * returns `{id, patient_id, patient_name, appointment_type_name,
 * start_time, end_time, status}[]`, UTC ISO datetimes.
 */

/**
 * Matches `backend/bookings/models.py`'s `Booking.Status` enum. Every row
 * this screen shows should already be `confirmed` or a later terminal
 * status, since bookings auto-accept; `requested` is included only so a
 * stray row (a bug elsewhere) still renders instead of crashing.
 */
export type BookingStatus =
  | "requested"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export interface ProviderBooking {
  id: number;
  patient_id: number;
  patient_name: string;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  /** The provider's written reason for a cancellation, `""` unless
   * `status` is `cancelled` (and even then `""` for rows cancelled before
   * reasons were required). Set via `PATCH /bookings/:id/status`'s
   * `cancellation_reason` body field. */
  cancellation_reason: string;
}

/**
 * `PATCH /bookings/:id/status`'s report of whether the patient was told
 * about a cancellation. Present only on a successful *cancellation*
 * response — absent on completed/no_show changes and on error responses.
 *
 * The shape is final now that the SMS ticket has landed, so all five keys
 * are typed properly (the earlier open index signature is gone).
 * `sms_attempted` is true only when the patient had both a phone number
 * and a carrier on file; `sms_skipped_reason` explains why no text went
 * out: `"no_phone"` / `"no_carrier"` / `"unknown_carrier"` mean SMS was
 * never attempted (expected, not an error), `"send_failed"` means an
 * attempted send failed, `"rate_limited"` means neither channel was tried
 * because the patient hit their hourly notification cap (see
 * `rate_limited` below), and `null` means nothing was skipped.
 */
export interface CancellationNotification {
  email_sent: boolean;
  email_failed: boolean;
  sms_attempted: boolean;
  sms_sent: boolean;
  sms_skipped_reason: string | null;
  /** True when the server declined to notify this patient at all because
   * they've already been sent their hourly limit of cancellation notices
   * (an anti-abuse cap, not a delivery failure — hence `email_failed`
   * false and `sms_skipped_reason` `"rate_limited"`). The cancellation
   * itself still succeeded. The existing "we couldn't reach the patient"
   * warning is deliberately still shown for this case, because the
   * patient genuinely wasn't told; this flag is here for wording that
   * wants to distinguish the two. Optional so older/other response
   * shapes still typecheck. */
  rate_limited?: boolean;
}

/**
 * What a row's `onStatusChange` resolves with: the updated row (the
 * PATCH response's changed fields merged onto the row already in state —
 * see `ProviderCalendar.handleStatusChange`), plus the cancellation
 * notification report when the server sent one.
 */
export interface BookingStatusChangeResult {
  booking: ProviderBooking;
  notification?: CancellationNotification;
}

/**
 * The three actions a provider can take on a booking row, matching
 * `PATCH /bookings/:id/status`'s body `{status: ...}` values. Deliberately
 * excludes `"confirmed"`: bookings arrive pre-confirmed via auto-accept,
 * so there is no confirm/decline action anywhere in this UI.
 */
export type BookingStatusAction = "completed" | "cancelled" | "no_show";

/**
 * Patient-facing booking shape, from `GET /bookings/mine`:
 * `{id, provider_id, provider_name, provider_timezone,
 * appointment_type_id, appointment_type_name, start_time, end_time,
 * status, reminder_sent}[]`, UTC ISO datetimes, ordered by `start_time`.
 * Matches `backend/bookings/serializers.py`'s
 * `PatientBookingListSerializer`.
 *
 * `appointment_type_id` lets a reschedule flow call
 * `GET /scheduling/slots` directly with the id instead of resolving it
 * from `appointment_type_name` via a second request. `reminder_sent`
 * reports whether the 24h-before reminder email has already gone out,
 * driving `AppointmentCard`'s "Reminder sent" indicator.
 */
export interface PatientBooking {
  id: number;
  provider_id: number;
  provider_name: string;
  /** The provider's own IANA zone — the clock this appointment was booked
   * on and the one their office keeps it in. Patient surfaces render times
   * on the patient's own clock, so this is what lets them also show the
   * time the patient actually picked (see `formatProviderClockRange`). */
  provider_timezone: string;
  appointment_type_id: number;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  reminder_sent: boolean;
  /** The provider's written reason when they cancelled this booking, `""`
   * otherwise. Same field as `ProviderBooking.cancellation_reason`. */
  cancellation_reason: string;
}

/**
 * The three tabs "My Appointments" splits a patient's bookings into,
 * derived client-side from the fetched list rather than three separate
 * API calls (see `classifyAppointmentTab` in `./status`), since a
 * demo-sized dataset doesn't justify the extra round trips.
 */
export type AppointmentTab = "upcoming" | "past" | "cancelled";

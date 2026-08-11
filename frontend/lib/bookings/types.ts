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
 * `{id, provider_id, provider_name, appointment_type_id,
 * appointment_type_name, start_time, end_time, status, reminder_sent}[]`,
 * UTC ISO datetimes, ordered by `start_time`. Matches
 * `backend/bookings/serializers.py`'s `PatientBookingListSerializer`.
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
  appointment_type_id: number;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  reminder_sent: boolean;
}

/**
 * The three tabs "My Appointments" splits a patient's bookings into,
 * derived client-side from the fetched list rather than three separate
 * API calls (see `classifyAppointmentTab` in `./status`), since a
 * demo-sized dataset doesn't justify the extra round trips.
 */
export type AppointmentTab = "upcoming" | "past" | "cancelled";

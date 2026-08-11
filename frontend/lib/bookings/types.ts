/**
 * Provider-facing booking types (TICKET-08, frontend half). Neither
 * `GET /bookings?date_from=&date_to=` nor `PATCH /bookings/:id/status`
 * exist in `backend/bookings/` yet as of this ticket -- only
 * `POST /bookings` (`bookings.views.BookingCreateView`) does -- so this
 * shape is taken directly from the brief's assumed contract:
 * `{id, patient_id, patient_name, appointment_type_name, start_time,
 * end_time, status}`, UTC ISO datetimes. Adapt once the real endpoint
 * exists; note any drift (see `ProviderCalendar.tsx`'s docstring).
 */

/**
 * Matches `backend/bookings/models.py`'s `Booking.Status` enum exactly.
 * Every row this screen shows should already be `confirmed` or a later
 * terminal status, per auto-accept (TICKET-07) -- `requested` is included
 * only so a stray row (a bug elsewhere) still renders instead of crashing.
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
 * `PATCH /bookings/:id/status`'s body `{status: ...}` values exactly.
 * Deliberately excludes `"confirmed"`: bookings arrive pre-confirmed
 * (TICKET-07's auto-accept), so there is no confirm/decline action
 * anywhere in this UI (TICKET-08's accept criteria).
 */
export type BookingStatusAction = "completed" | "cancelled" | "no_show";

/**
 * Patient-facing booking shape (TICKET-09, frontend half). Neither a
 * patient-scoped list endpoint nor a patient-initiated cancel endpoint
 * exist in `backend/bookings/` yet as of this ticket -- `GET /bookings`
 * explicitly rejects a patient caller with a 403 ("Patients cannot list
 * bookings from this endpoint", see `BookingListCreateView.get`'s own
 * docstring), by design left for this ticket's backend half to build as
 * its own endpoint -- so this shape is taken directly from the brief's
 * assumed contract: `GET /bookings/mine` ->
 * `{id, provider_id, provider_name, appointment_type_name, start_time,
 * end_time, status}[]`, UTC ISO datetimes, ordered by `start_time`. Adapt
 * once the real endpoint exists; note any drift (see `ProviderBooking`'s
 * own docstring for the same situation on TICKET-08).
 */
export interface PatientBooking {
  id: number;
  provider_id: number;
  provider_name: string;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
}

/**
 * The three tabs "My Appointments" (TICKET-09; wireframe Screen 3) splits
 * a patient's bookings into, derived client-side from the fetched list
 * rather than three separate API calls (see `classifyAppointmentTab` in
 * `./status`) -- a small, demo-sized dataset doesn't justify the extra
 * round trips.
 */
export type AppointmentTab = "upcoming" | "past" | "cancelled";

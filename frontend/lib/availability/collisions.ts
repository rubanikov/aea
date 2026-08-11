import type { BookingStatus } from "@/lib/bookings/types";

/**
 * One existing appointment that falls outside a proposed availability
 * change (a working-hours edit or a new blocked-time range). Returned by
 * `POST /scheduling/availability/check-collisions` and by
 * `POST /scheduling/blocked-time` when the block would strand a booking.
 * Same shape as `ProviderBooking` (`lib/bookings/types.ts`) minus
 * `patient_id`, so this reuses `BookingStatus` and, at render time,
 * `BookingStatusBadge`/`formatBookingTimeRange` rather than inventing a
 * parallel vocabulary.
 */
export interface AvailabilityCollision {
  id: number;
  start_time: string;
  end_time: string;
  patient_name: string;
  appointment_type_name: string;
  status: BookingStatus;
}

/**
 * One weekday's proposed hours, the request body shape for the `windows`
 * array `POST /scheduling/availability/check-collisions` expects. A day
 * simply absent from the array means "no hours that day" (this also
 * covers deleting a day's hours entirely).
 */
export interface AvailabilityWindowInput {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/**
 * The provider's choice once a `CollisionWarningModal` is showing, sent
 * back as the `resolution` field on the follow-up request to whichever
 * endpoint raised the collision.
 */
export type CollisionResolution = "keep_new_hours" | "cancel_change";

interface CollisionResponseBody {
  collisions: AvailabilityCollision[];
}

/**
 * Type guard for a 409 response's body from either collision-checking
 * endpoint; both use this same `{collisions: [...]}` shape. Narrows
 * `ApiError.body` (`unknown`) so callers can tell a real collision
 * response apart from an unrelated error body without a type assertion.
 */
export function isCollisionResponseBody(body: unknown): body is CollisionResponseBody {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { collisions?: unknown }).collisions)
  );
}

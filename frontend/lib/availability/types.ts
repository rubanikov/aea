import type {
  AvailabilityCollision,
  AvailabilityWindowInput,
} from "./collisions";

/**
 * `AppointmentType` as `backend/scheduling/serializers.py`'s
 * `AppointmentTypeSerializer` returns it:
 * `GET /scheduling/appointment-types` -> `AppointmentType[]`. `id` is a
 * JSON number (Django's integer PK), not a string.
 */
export interface AppointmentType {
  id: number;
  name: string;
  /** The provider's chosen slot length for this type: 30 or 60 (the only
   * two values the server accepts or stores). Typed `number` rather than
   * the `SlotDuration` union because it's server data crossing the wire —
   * display code renders whatever arrives. */
  duration_minutes: number;
}

/** Body shape for `POST`/`PATCH /scheduling/appointment-types(/:id)`.
 * `duration_minutes` must be 30 or 60 when present; omitting it keeps the
 * server default (60) on create and the current value on update. A PATCH
 * that changes it while the type has upcoming booked appointments is
 * refused with a `409 {detail, collisions}` (see `AppointmentTypeRow`'s
 * handling). */
export interface AppointmentTypeInput {
  name: string;
  duration_minutes?: number;
}

/**
 * One weekly-recurring working-hours block, as returned by
 * `GET /scheduling/availability` (`backend/scheduling/serializers.py`'s
 * `AvailabilitySerializer`), which now returns only the currently-effective
 * generation's rows. `start_time`/`end_time` serialize as "HH:MM:SS"
 * (DRF's default `TimeField` rendering), normalized to "HH:MM" at the form
 * boundary to match `<input type="time">`'s value format. `day_of_week` is
 * an integer, Monday=0...Sunday=6; see `lib/availability/days.ts`.
 * `effective_from` is the generation's start date (`null` for the
 * baseline generation).
 */
export interface AvailabilityDay {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string | null;
}

/** One window inside a schedule generation, as `GET /scheduling/schedule`
 * returns it (`current.windows`/`pending.windows`). Times serialize as
 * "HH:MM:SS" like `AvailabilityDay`'s. */
export interface ScheduleWindow {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/** One generation of a provider's weekly schedule: the calendar date it
 * takes effect (`null` = the live baseline) plus its windows, sorted by
 * `day_of_week` then `start_time`. */
export interface ScheduleGeneration {
  effective_from: string | null;
  windows: ScheduleWindow[];
}

/**
 * `GET /scheduling/schedule`'s (and a successful `PUT`'s) response body.
 * `today` is the provider-local date ("YYYY-MM-DD"), supplied so the
 * client never derives it from the browser clock. `pending` is `null`
 * when no generation has `effective_from > today`.
 */
export interface ProviderSchedule {
  timezone: string;
  today: string;
  current: ScheduleGeneration;
  pending: ScheduleGeneration | null;
}

/**
 * Body shape for `PUT /scheduling/schedule`: the complete weekly picture
 * (a day absent from `windows` means "no hours that day") plus
 * `effective_from` — `null` to apply immediately, or a future
 * "YYYY-MM-DD" (provider-local) to create/replace the pending generation.
 */
export interface ScheduleWriteBody {
  windows: AvailabilityWindowInput[];
  effective_from: string | null;
}

/**
 * `PUT /scheduling/schedule`'s 409 body: the stranded bookings plus the
 * earliest date the change could safely take effect. `earliest_safe_date`
 * is `null` when no deferral date can clear every collision, in which
 * case the only offered resolution is cancelling the change. See
 * `isScheduleConflictBody` in `lib/availability/collisions.ts`.
 */
export interface ScheduleConflictBody {
  collisions: AvailabilityCollision[];
  earliest_safe_date: string | null;
}

/**
 * A provider's one-off blocked-time range, as returned by
 * `GET /scheduling/blocked-time` (`backend/scheduling/serializers.py`'s
 * `BlockedTimeSerializer`). `start`/`end` are UTC ISO 8601 instants
 * (unlike `AvailabilityDay`'s wall-clock `TimeField`s, a blocked range is
 * anchored to real calendar dates, so it's already resolved to UTC),
 * rendered in the provider's own timezone at display time
 * (`lib/availability/timezone.ts`). `label` is always a string, `""` (not
 * `null`) for an unlabeled block, since `BlockedTime.label` is a plain
 * `CharField(blank=True)`.
 */
export interface BlockedTime {
  id: number;
  label: string;
  start: string;
  end: string;
}

/** Body shape for `POST /scheduling/blocked-time`. `label` is optional;
 * omit it entirely for an unlabeled block rather than sending `""`. */
export interface BlockedTimeInput {
  label?: string;
  start: string;
  end: string;
}

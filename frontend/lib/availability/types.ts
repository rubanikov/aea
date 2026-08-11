/**
 * `AppointmentType` as `backend/scheduling/serializers.py`'s
 * `AppointmentTypeSerializer` returns it:
 * `GET /scheduling/appointment-types` -> `AppointmentType[]`. `id` is a
 * JSON number (Django's integer PK), not a string.
 */
export interface AppointmentType {
  id: number;
  name: string;
  duration_minutes: number;
}

/** Body shape for `POST`/`PATCH /scheduling/appointment-types(/:id)`. */
export interface AppointmentTypeInput {
  name: string;
  duration_minutes: number;
}

/**
 * One weekly-recurring working-hours block, as returned by
 * `GET /scheduling/availability` (`backend/scheduling/serializers.py`'s
 * `AvailabilitySerializer`). `start_time`/`end_time` serialize as
 * "HH:MM:SS" (DRF's default `TimeField` rendering, confirmed against
 * `scheduling/tests/test_availability_api.py`) -- normalized to "HH:MM" at
 * the form boundary (see `normalizeTime` in `WorkingHoursSection.tsx`) to
 * match `<input type="time">`'s value format. `day_of_week` is an integer,
 * Monday=0...Sunday=6 -- see `lib/availability/days.ts`.
 */
export interface AvailabilityDay {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/**
 * Body shape for `POST /scheduling/availability` (creating one row --
 * there is no bulk endpoint and no `PATCH` for an existing row, only
 * `DELETE`; see `WorkingHoursSection.tsx`'s save flow, which reconciles by
 * deleting the day's previous row(s) and creating a new one whenever a
 * day's hours change).
 */
export type AvailabilityDayInput = Omit<AvailabilityDay, "id">;

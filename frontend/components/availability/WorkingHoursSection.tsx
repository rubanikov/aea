"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { isFieldErrorBody, splitFieldErrors } from "@/lib/api/field-errors";
import {
  isCollisionResponseBody,
  type AvailabilityCollision,
  type AvailabilityWindowInput,
} from "@/lib/availability/collisions";
import {
  WEEKDAYS,
  dayOfWeekFromIndex,
  dayOfWeekToIndex,
  type DayOfWeek,
} from "@/lib/availability/days";
import {
  validateWorkingHours,
  type WorkingHoursRow,
} from "@/lib/availability/validation";
import type { AvailabilityDay } from "@/lib/availability/types";
import { CollisionWarningModal } from "./CollisionWarningModal";

const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "17:00";
const AVAILABILITY_PATH = "/scheduling/availability";
const CHECK_COLLISIONS_PATH = "/scheduling/availability/check-collisions";

interface SavedState {
  rows: WorkingHoursRow[];
  /** Every currently-saved row id for a day, keyed by `DayOfWeek`. The
   * backend's model permits more than one `Availability` row per day (for
   * per-day breaks/sub-ranges, a nice-to-have this UI skips); this UI only
   * ever shows/edits one range per day, so saving a change deletes *every*
   * existing row for that day before creating the replacement, keeping
   * the two in sync. */
  idsByDay: Record<DayOfWeek, number[]>;
}

/** One open collision-warning modal's worth of state: the proposed windows
 * it was raised against (resent verbatim on "Keep new hours"), the
 * affected appointments to list, and the change description to show. */
interface CollisionState {
  windows: AvailabilityWindowInput[];
  collisions: AvailabilityCollision[];
  description: string;
}

/** Tolerates "HH:MM:SS" (DRF's default `TimeField` serialization) as well
 * as "HH:MM" (what `<input type="time">` uses). */
function normalizeTime(value: string): string {
  return value.length > 5 ? value.slice(0, 5) : value;
}

function rowsFromApi(days: readonly AvailabilityDay[]): WorkingHoursRow[] {
  const byDayIndex = new Map<number, AvailabilityDay>();
  for (const day of days) {
    // If a day somehow has more than one saved row, this UI only surfaces
    // one range per day. Keep the earliest (the API orders by
    // `day_of_week, start_time`, so the first match wins deterministically).
    if (!byDayIndex.has(day.day_of_week)) {
      byDayIndex.set(day.day_of_week, day);
    }
  }
  return WEEKDAYS.map(({ value }, index) => {
    const match = byDayIndex.get(index);
    return match
      ? {
          day: value,
          enabled: true,
          startTime: normalizeTime(match.start_time),
          endTime: normalizeTime(match.end_time),
        }
      : {
          day: value,
          enabled: false,
          startTime: DEFAULT_START_TIME,
          endTime: DEFAULT_END_TIME,
        };
  });
}

function groupIdsByDay(
  days: readonly AvailabilityDay[]
): Record<DayOfWeek, number[]> {
  const grouped = Object.fromEntries(
    WEEKDAYS.map(({ value }) => [value, [] as number[]])
  ) as Record<DayOfWeek, number[]>;
  for (const day of days) {
    const weekday = dayOfWeekFromIndex(day.day_of_week);
    if (weekday) {
      grouped[weekday].push(day.id);
    }
  }
  return grouped;
}

function buildSavedState(days: readonly AvailabilityDay[]): SavedState {
  return { rows: rowsFromApi(days), idsByDay: groupIdsByDay(days) };
}

/** The complete proposed weekly picture: every currently-enabled row's
 * day/start/end, in the shape `check-collisions`'s `windows` expects. A
 * day toggled off (or never enabled) is simply absent, which the backend
 * takes to mean "no hours that day", covering a day being deleted
 * entirely, not just shortened. */
function buildProposedWindows(rows: readonly WorkingHoursRow[]): AvailabilityWindowInput[] {
  return rows
    .filter((row) => row.enabled)
    .map((row) => ({
      day_of_week: dayOfWeekToIndex(row.day),
      start_time: row.startTime,
      end_time: row.endTime,
    }));
}

function formatRange(row: WorkingHoursRow): string {
  return row.enabled ? `${row.startTime}–${row.endTime}` : "unavailable";
}

/** e.g. "You're changing Friday's hours from 09:00–17:00 to 09:00–13:00."
 * The collision modal's framing sentence, built from a diff between what
 * was last saved and what's about to be submitted. Falls back to a
 * generic sentence in the (unusual) case a collision is raised without any
 * row actually differing. */
function describeWorkingHoursChange(
  previous: readonly WorkingHoursRow[],
  next: readonly WorkingHoursRow[]
): string {
  const changes = WEEKDAYS.map(({ label }, index) => {
    const before = previous[index];
    const after = next[index];
    const changed =
      before.enabled !== after.enabled ||
      (after.enabled &&
        (before.startTime !== after.startTime || before.endTime !== after.endTime));
    return changed ? `${label}'s hours from ${formatRange(before)} to ${formatRange(after)}` : null;
  }).filter((line): line is string => line !== null);

  return changes.length > 0
    ? `You're changing ${changes.join("; ")}.`
    : "This change affects existing bookings.";
}

/**
 * Weekly working hours: a checkbox + start/end time per weekday inside a
 * `<fieldset>`. A single start/end range per day, with no per-day
 * break/sub-range support, a deliberate simplification.
 *
 * `GET /scheduling/availability` on mount. There is no bulk save endpoint
 * and no `PATCH` for an existing row, only `GET`/`POST` on the collection
 * and `DELETE` on a row, so "Save working hours" reconciles day-by-day: a
 * day whose enabled/start/end state hasn't changed since the last load is
 * left alone; a day that changed has its previous row(s) deleted and, if
 * still enabled, a new one created. This keeps the single "Save" button
 * despite the backend being row-oriented.
 *
 * Before that per-day save sequence ever runs, the complete proposed
 * weekly picture is sent to `POST /scheduling/availability/check-collisions`.
 * No collision (`200`) proceeds exactly as before, zero behavior change.
 * A collision (`409`) opens `CollisionWarningModal` instead of saving
 * anything; "Keep new hours" re-calls the same endpoint with
 * `resolution: "keep_new_hours"` and then runs the real save sequence,
 * while "Cancel this change" (also Esc/Go back) discards the proposed
 * edit client-side only, since a second round-trip buys nothing when
 * nothing needs to change server-side.
 */
export function WorkingHoursSection() {
  const authFetch = useAuthenticatedRequest();
  const [rows, setRows] = useState<WorkingHoursRow[] | null>(null); // null = loading
  const [savedState, setSavedState] = useState<SavedState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasSavedAnyDay, setHasSavedAnyDay] = useState(false);
  const [rowErrors, setRowErrors] = useState<Partial<Record<DayOfWeek, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState<string | null>(null);

  const [collisionState, setCollisionState] = useState<CollisionState | null>(null);
  const [collisionTrigger, setCollisionTrigger] = useState<HTMLElement | null>(null);
  const [confirmingCollision, setConfirmingCollision] = useState(false);
  const [collisionError, setCollisionError] = useState<string | null>(null);

  const checkboxRefs = useRef<Partial<Record<DayOfWeek, HTMLInputElement | null>>>({});
  const startRefs = useRef<Partial<Record<DayOfWeek, HTMLInputElement | null>>>({});

  function applyLoaded(days: readonly AvailabilityDay[]) {
    const state = buildSavedState(days);
    setRows(state.rows);
    setSavedState(state);
    setHasSavedAnyDay(days.length > 0);
  }

  useEffect(() => {
    let cancelled = false;

    authFetch<AvailabilityDay[]>(AVAILABILITY_PATH)
      .then((result) => {
        if (!cancelled) {
          applyLoaded(result);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ApiError && error.status === 401)) {
          setLoadError("Couldn't load your working hours — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, reloadKey]);

  useEffect(() => {
    // Same "no shared hook for this yet" pattern as `BlockedTimeSection`.
    // Only needed to render a collision's time in the provider's own
    // timezone, display-only, so a failure here just falls back to UTC
    // rather than breaking this section's main load state.
    let cancelled = false;

    authFetch<{ timezone: string }>("/profile")
      .then((result) => {
        if (!cancelled) {
          setTimezone(result.timezone);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  function retry() {
    setLoadError(null);
    setRows(null);
    setReloadKey((key) => key + 1);
  }

  function updateRow(day: DayOfWeek, patch: Partial<WorkingHoursRow>) {
    setRows((current) =>
      (current ?? []).map((row) => (row.day === day ? { ...row, ...patch } : row))
    );
    setRowErrors((current) => {
      if (!current[day]) {
        return current;
      }
      const next = { ...current };
      delete next[day];
      return next;
    });
  }

  function focusFirstInvalid(errors: Partial<Record<DayOfWeek, string>>) {
    for (const { value } of WEEKDAYS) {
      if (errors[value]) {
        startRefs.current[value]?.focus();
        return;
      }
    }
  }

  function focusMonday() {
    checkboxRefs.current.monday?.focus();
  }

  /** The actual per-day delete/recreate save sequence, extracted so both
   * the no-collision path and "Keep new hours" (after its own resolution
   * round-trip) can run it. */
  async function runSaveSequence() {
    if (!rows || !savedState) {
      return;
    }
    setSaving(true);

    const serverErrors: Partial<Record<DayOfWeek, string>> = {};
    let hadUnexpectedError = false;
    let sessionExpired = false;

    for (let index = 0; index < rows.length; index += 1) {
      if (sessionExpired) {
        break;
      }
      const row = rows[index];
      const previous = savedState.rows[index];
      const existingIds = savedState.idsByDay[row.day] ?? [];
      const changed =
        previous.enabled !== row.enabled ||
        (row.enabled &&
          (previous.startTime !== row.startTime || previous.endTime !== row.endTime));
      if (!changed) {
        continue;
      }

      try {
        for (const id of existingIds) {
          await authFetch(`${AVAILABILITY_PATH}/${id}`, { method: "DELETE" });
        }
        if (row.enabled) {
          await authFetch(AVAILABILITY_PATH, {
            method: "POST",
            body: {
              day_of_week: dayOfWeekToIndex(row.day),
              start_time: row.startTime,
              end_time: row.endTime,
            },
          });
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          sessionExpired = true;
        } else if (
          error instanceof ApiError &&
          error.status === 400 &&
          isFieldErrorBody(error.body)
        ) {
          const { fieldErrors } = splitFieldErrors(
            error.body,
            new Set(["start_time", "end_time", "day_of_week"])
          );
          serverErrors[row.day] =
            fieldErrors.end_time ??
            fieldErrors.start_time ??
            "Couldn't save this day — please try again.";
        } else {
          hadUnexpectedError = true;
        }
      }
    }

    if (sessionExpired) {
      setSaving(false);
      return;
    }

    try {
      const refreshed = await authFetch<AvailabilityDay[]>(AVAILABILITY_PATH);
      applyLoaded(refreshed);
    } catch {
      // Best-effort refresh; if it fails too, keep the last-known local
      // state rather than losing the provider's in-progress edits.
    }

    if (Object.keys(serverErrors).length > 0) {
      setRowErrors(serverErrors);
      focusFirstInvalid(serverErrors);
    } else if (hadUnexpectedError) {
      setFormError("Couldn't save all of your working hours — please try again.");
    } else {
      setSaved(true);
    }
    setSaving(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rows || !savedState) {
      return;
    }

    setSaved(false);
    setFormError(null);
    const clientErrors = validateWorkingHours(rows);
    if (Object.keys(clientErrors).length > 0) {
      setRowErrors(clientErrors);
      focusFirstInvalid(clientErrors);
      return;
    }
    setRowErrors({});
    setSaving(true);

    // Captured before any awaits (and before `disabled` on the Save button
    // can take effect on the next render) so it's still the real triggering
    // element, same technique `BookingConfirmPanel`'s caller uses.
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const windows = buildProposedWindows(rows);

    try {
      await authFetch(CHECK_COLLISIONS_PATH, {
        method: "POST",
        body: { windows },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && isCollisionResponseBody(error.body)) {
        setCollisionState({
          windows,
          collisions: error.body.collisions,
          description: describeWorkingHoursChange(savedState.rows, rows),
        });
        setCollisionTrigger(trigger);
        setSaving(false);
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        setSaving(false);
        return;
      }
      setFormError("Couldn't save your working hours — please try again.");
      setSaving(false);
      return;
    }

    // No collision: proceed with the normal save.
    await runSaveSequence();
  }

  async function handleKeepNewHours() {
    if (!collisionState) {
      return;
    }
    setConfirmingCollision(true);
    setCollisionError(null);
    try {
      await authFetch(CHECK_COLLISIONS_PATH, {
        method: "POST",
        body: { windows: collisionState.windows, resolution: "keep_new_hours" },
      });
    } catch (error) {
      setConfirmingCollision(false);
      if (!(error instanceof ApiError && error.status === 401)) {
        setCollisionError("Couldn't save your working hours — please try again.");
      }
      return;
    }
    setCollisionState(null);
    setConfirmingCollision(false);
    await runSaveSequence();
  }

  function handleCancelCollisionChange() {
    setCollisionState(null);
    setConfirmingCollision(false);
    setCollisionError(null);
    setSaving(false);
    setRowErrors({});
    setFormError(null);
    if (savedState) {
      // "Cancel this change" keeps the provider's current hours: revert
      // the form back to what's actually saved rather than leaving it
      // showing the discarded edit.
      setRows(savedState.rows);
    }
  }

  if (loadError) {
    return (
      <section
        aria-labelledby="working-hours-heading"
        className="flex flex-col gap-3 rounded border border-gray-200 p-6"
      >
        <h2 id="working-hours-heading" className="text-lg font-semibold">
          Weekly working hours
        </h2>
        <p role="alert" className="text-sm text-red-600">
          {loadError}
        </p>
        <button
          type="button"
          onClick={retry}
          className="self-start rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Try again
        </button>
      </section>
    );
  }

  if (!rows) {
    return (
      <section
        aria-labelledby="working-hours-heading"
        className="flex flex-col gap-3 rounded border border-gray-200 p-6"
      >
        <h2 id="working-hours-heading" className="text-lg font-semibold">
          Weekly working hours
        </h2>
        <p className="text-sm text-gray-600">Loading working hours…</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="working-hours-heading"
      className="flex flex-col gap-4 rounded border border-gray-200 p-6"
    >
      <h2 id="working-hours-heading" className="text-lg font-semibold">
        Weekly working hours
      </h2>

      {!hasSavedAnyDay ? (
        <div className="flex flex-col items-start gap-3 rounded border border-dashed border-gray-300 p-4">
          <p className="text-sm text-gray-600">
            You haven&apos;t set your working hours yet.
          </p>
          <button
            type="button"
            onClick={focusMonday}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Set up working hours
          </button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Days available</legend>
          {WEEKDAYS.map(({ value, label }, index) => {
            const row = rows[index];
            const error = rowErrors[value];
            const startId = `${value}-start`;
            const endId = `${value}-end`;
            const errorId = `${value}-error`;

            return (
              <div key={value} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex w-32 shrink-0 items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      ref={(element) => {
                        checkboxRefs.current[value] = element;
                      }}
                      checked={row.enabled}
                      onChange={(event) =>
                        updateRow(value, { enabled: event.target.checked })
                      }
                    />
                    {label}
                  </label>
                  {row.enabled ? (
                    <>
                      <label htmlFor={startId} className="sr-only">
                        {label} start time
                      </label>
                      <input
                        type="time"
                        id={startId}
                        ref={(element) => {
                          startRefs.current[value] = element;
                        }}
                        value={row.startTime}
                        onChange={(event) =>
                          updateRow(value, { startTime: event.target.value })
                        }
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                      />
                      <span className="text-sm text-gray-600">to</span>
                      <label htmlFor={endId} className="sr-only">
                        {label} end time
                      </label>
                      <input
                        type="time"
                        id={endId}
                        value={row.endTime}
                        onChange={(event) =>
                          updateRow(value, { endTime: event.target.value })
                        }
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                      />
                    </>
                  ) : (
                    <span className="text-sm text-gray-500">Unavailable</span>
                  )}
                </div>
                {error ? (
                  <p id={errorId} role="alert" className="text-sm text-red-600">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
        </fieldset>

        {formError ? (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        ) : null}
        {saved ? (
          <p role="status" aria-live="polite" className="text-sm text-green-700">
            Working hours saved.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="self-start rounded bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save working hours"}
        </button>
      </form>

      {collisionState ? (
        <CollisionWarningModal
          description={collisionState.description}
          collisions={collisionState.collisions}
          timezone={timezone ?? "UTC"}
          confirming={confirmingCollision}
          error={collisionError}
          onKeepNewHours={handleKeepNewHours}
          onCancelChange={handleCancelCollisionChange}
          triggerElement={collisionTrigger}
        />
      ) : null}
    </section>
  );
}

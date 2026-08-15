"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import {
  isScheduleConflictBody,
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
  normalizeTime,
  toMinutes,
  validateWorkingHours,
  type WorkingHoursBlock,
  type WorkingHoursDay,
} from "@/lib/availability/validation";
import type {
  ProviderSchedule,
  ScheduleGeneration,
  ScheduleWindow,
} from "@/lib/availability/types";
import { CollisionWarningModal } from "./CollisionWarningModal";
import { PendingScheduleBanner } from "./PendingScheduleBanner";

const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "17:00";
const SCHEDULE_PATH = "/scheduling/schedule";
/** A new block starts this long after the previous block's end (also the
 * minimum gap the validator enforces) and spans this long by default. */
const NEW_BLOCK_OFFSET_MINUTES = 60;

const GENERIC_SAVE_ERROR = "Couldn't save your working hours — please try again.";

/** Client-only React keys for block rows; monotonic so removing a block
 * never re-keys its neighbours. */
let blockKeyCounter = 0;
function newBlockKey(): string {
  blockKeyCounter += 1;
  return `block-${blockKeyCounter}`;
}

function defaultBlock(): WorkingHoursBlock {
  return { key: newBlockKey(), startTime: DEFAULT_START_TIME, endTime: DEFAULT_END_TIME };
}

/** One open collision-warning modal's worth of state: the proposed windows
 * it was raised against (resent verbatim with an `effective_from` on
 * "Apply from"), the affected appointments to list, the server's earliest
 * safe deferral date (`null` = the change can't be deferred at all), and
 * the change description to show. */
interface CollisionState {
  windows: AvailabilityWindowInput[];
  collisions: AvailabilityCollision[];
  earliestSafeDate: string | null;
  description: string;
}

function toTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function byStartTime(a: WorkingHoursBlock, b: WorkingHoursBlock): number {
  return toMinutes(a.startTime) - toMinutes(b.startTime);
}

/** The live generation's windows -> the form's per-day block stacks. A day
 * with no window gets a single default block so checking it reveals
 * 09:00–17:00, same as before. */
function daysFromWindows(windows: readonly ScheduleWindow[]): WorkingHoursDay[] {
  const blocksByDay = new Map<number, WorkingHoursBlock[]>();
  for (const window of windows) {
    const blocks = blocksByDay.get(window.day_of_week) ?? [];
    blocks.push({
      key: newBlockKey(),
      startTime: normalizeTime(window.start_time),
      endTime: normalizeTime(window.end_time),
    });
    blocksByDay.set(window.day_of_week, blocks);
  }
  return WEEKDAYS.map(({ value }, index) => {
    const blocks = blocksByDay.get(index);
    return blocks
      ? { day: value, enabled: true, blocks }
      : { day: value, enabled: false, blocks: [defaultBlock()] };
  });
}

/** The complete proposed weekly picture: every enabled day's blocks in
 * start-time order, in the shape `PUT /scheduling/schedule`'s `windows`
 * expects. A day toggled off (or never enabled) is simply absent, which
 * the backend takes to mean "no hours that day". */
function buildProposedWindows(days: readonly WorkingHoursDay[]): AvailabilityWindowInput[] {
  return days
    .filter((day) => day.enabled)
    .flatMap((day) =>
      [...day.blocks].sort(byStartTime).map((block) => ({
        day_of_week: dayOfWeekToIndex(day.day),
        start_time: block.startTime,
        end_time: block.endTime,
      }))
    );
}

/** e.g. "09:00–12:00 and 14:00–17:00", or "unavailable" for a disabled
 * day. */
function formatDayBlocks(day: WorkingHoursDay): string {
  return day.enabled
    ? [...day.blocks]
        .sort(byStartTime)
        .map((block) => `${block.startTime}–${block.endTime}`)
        .join(" and ")
    : "unavailable";
}

/** e.g. "You're changing Monday's hours from 09:00–17:00 to 09:00–12:00
 * and 14:00–17:00." The collision modal's framing sentence, built from a
 * diff between what was last saved and what's about to be submitted.
 * Falls back to a generic sentence in the (unusual) case a collision is
 * raised without any day actually differing. */
function describeWorkingHoursChange(
  previous: readonly WorkingHoursDay[],
  next: readonly WorkingHoursDay[]
): string {
  const changes = WEEKDAYS.map(({ label }, index) => {
    const before = formatDayBlocks(previous[index]);
    const after = formatDayBlocks(next[index]);
    return before !== after ? `${label}'s hours from ${before} to ${after}` : null;
  }).filter((line): line is string => line !== null);

  return changes.length > 0
    ? `You're changing ${changes.join("; ")}.`
    : "This change affects existing bookings.";
}

/** "2026-08-25" -> "Aug 25, 2026" for the deferred-save confirmation.
 * Pinned to UTC so the browser's timezone can't shift the calendar date. */
function formatEffectiveDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * `PUT /scheduling/schedule`'s 400 keys schedule-rule violations by
 * weekday index (`{"windows": {"0": ["Blocks on the same day can't
 * overlap."]}}`) so they can render as per-day inline errors. Malformed
 * payloads fall through to DRF's default errors (nested objects rather
 * than string lists), which this returns nothing for — the caller shows a
 * form-level message instead.
 */
function scheduleDayErrors(body: unknown): Partial<Record<DayOfWeek, string>> {
  const errors: Partial<Record<DayOfWeek, string>> = {};
  if (typeof body !== "object" || body === null) {
    return errors;
  }
  const windows = (body as { windows?: unknown }).windows;
  if (typeof windows !== "object" || windows === null || Array.isArray(windows)) {
    return errors;
  }
  for (const [key, value] of Object.entries(windows)) {
    const day = dayOfWeekFromIndex(Number(key));
    if (!day) {
      continue;
    }
    if (typeof value === "string") {
      errors[day] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      errors[day] = value.join(" ");
    }
  }
  return errors;
}

/**
 * Weekly working hours: a checkbox per weekday inside a `<fieldset>`,
 * each enabled day holding a stack of start/end time blocks with a
 * per-block "✕ Remove" and one "+ Add block". The form always shows the
 * **live** generation (`GET /scheduling/schedule`'s `current`), loaded on
 * mount.
 *
 * "Save working hours" client-validates every enabled day (end after
 * start, no overlaps, ≥1 hour between blocks) and then sends the whole
 * weekly picture in one `PUT /scheduling/schedule` with
 * `effective_from: null`. A `400` maps the server's weekday-keyed
 * `windows` errors onto the same per-day inline alerts the client
 * validator uses. A `409` means the change would strand existing
 * bookings: `CollisionWarningModal` opens with the deferral option —
 * "Apply from <date>" re-sends the same windows with the chosen
 * `effective_from`, scheduling a pending change while the live hours (and
 * this form) stay as they were, while "Cancel this change" (also
 * Esc/Go back) reverts the form to what's saved. When the server reports
 * `earliest_safe_date: null`, no deferral date can help and the modal is
 * cancel-only.
 *
 * When the response carries a non-null `pending` generation, a
 * `PendingScheduleBanner` sits above the form. "Edit pending change"
 * hydrates the form with the pending windows and flips `editingPending`,
 * so the next save `PUT`s with `effective_from: pending.effective_from` —
 * replacing the pending generation while the live hours stay untouched
 * (a 409 there goes through the same collision modal). A successful
 * cancel in the banner (`DELETE /scheduling/schedule/pending`) drops the
 * banner immediately and re-`GET`s the schedule in place, without
 * bouncing through the loading state.
 */
export function WorkingHoursSection() {
  const authFetch = useAuthenticatedRequest();
  const [days, setDays] = useState<WorkingHoursDay[] | null>(null); // null = loading
  const [savedDays, setSavedDays] = useState<WorkingHoursDay[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasSavedAnyDay, setHasSavedAnyDay] = useState(false);
  const [dayErrors, setDayErrors] = useState<Partial<Record<DayOfWeek, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [currentWindows, setCurrentWindows] = useState<ScheduleWindow[]>([]);
  const [pending, setPending] = useState<ScheduleGeneration | null>(null);
  /** True while the form holds the pending generation's windows (via "Edit
   * pending change"), which redirects the next save's `effective_from`. */
  const [editingPending, setEditingPending] = useState(false);

  const [collisionState, setCollisionState] = useState<CollisionState | null>(null);
  const [collisionTrigger, setCollisionTrigger] = useState<HTMLElement | null>(null);
  const [confirmingCollision, setConfirmingCollision] = useState(false);
  const [collisionError, setCollisionError] = useState<string | null>(null);

  const checkboxRefs = useRef<Partial<Record<DayOfWeek, HTMLInputElement | null>>>({});
  /** Each day's first block's start input, the focus target for that
   * day's inline error. */
  const firstStartRefs = useRef<Partial<Record<DayOfWeek, HTMLInputElement | null>>>({});

  function applyLoaded(schedule: ProviderSchedule) {
    const loaded = daysFromWindows(schedule.current.windows);
    setDays(loaded);
    setSavedDays(loaded);
    setHasSavedAnyDay(schedule.current.windows.length > 0);
    setTimezone(schedule.timezone);
    setCurrentWindows(schedule.current.windows);
    setPending(schedule.pending);
    // Any full reload puts the live hours back in the form, ending a
    // pending edit in progress.
    setEditingPending(false);
  }

  useEffect(() => {
    let cancelled = false;

    authFetch<ProviderSchedule>(SCHEDULE_PATH)
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

  function retry() {
    setLoadError(null);
    setDays(null);
    setReloadKey((key) => key + 1);
  }

  function clearDayError(day: DayOfWeek) {
    setDayErrors((current) => {
      if (!current[day]) {
        return current;
      }
      const next = { ...current };
      delete next[day];
      return next;
    });
  }

  function updateDay(day: DayOfWeek, update: (current: WorkingHoursDay) => WorkingHoursDay) {
    setDays((current) =>
      (current ?? []).map((entry) => (entry.day === day ? update(entry) : entry))
    );
    clearDayError(day);
  }

  function setDayEnabled(day: DayOfWeek, enabled: boolean) {
    updateDay(day, (entry) => ({ ...entry, enabled }));
  }

  function updateBlock(
    day: DayOfWeek,
    key: string,
    patch: Partial<Omit<WorkingHoursBlock, "key">>
  ) {
    updateDay(day, (entry) => ({
      ...entry,
      blocks: entry.blocks.map((block) =>
        block.key === key ? { ...block, ...patch } : block
      ),
    }));
  }

  function addBlock(day: DayOfWeek) {
    updateDay(day, (entry) => {
      const latest = [...entry.blocks].sort(byStartTime).at(-1);
      if (!latest) {
        return { ...entry, blocks: [defaultBlock()] };
      }
      // One hour after the previous block's end (the minimum valid gap),
      // clamped so a late-evening block still yields editable times.
      const start = Math.min(
        toMinutes(latest.endTime) + NEW_BLOCK_OFFSET_MINUTES,
        23 * 60 + 58
      );
      const end = Math.min(start + NEW_BLOCK_OFFSET_MINUTES, 23 * 60 + 59);
      return {
        ...entry,
        blocks: [
          ...entry.blocks,
          { key: newBlockKey(), startTime: toTime(start), endTime: toTime(end) },
        ],
      };
    });
  }

  function removeBlock(day: DayOfWeek, key: string) {
    updateDay(day, (entry) =>
      entry.blocks.length <= 1
        ? // Removing the last block means "no hours that day": uncheck the
          // day and stage a fresh default so re-checking starts clean.
          { ...entry, enabled: false, blocks: [defaultBlock()] }
        : { ...entry, blocks: entry.blocks.filter((block) => block.key !== key) }
    );
  }

  function focusFirstInvalid(errors: Partial<Record<DayOfWeek, string>>) {
    for (const { value } of WEEKDAYS) {
      if (errors[value]) {
        firstStartRefs.current[value]?.focus();
        return;
      }
    }
  }

  function focusMonday() {
    checkboxRefs.current.monday?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!days || !savedDays || saving) {
      return;
    }

    setSavedMessage(null);
    setFormError(null);
    const clientErrors = validateWorkingHours(days);
    if (Object.keys(clientErrors).length > 0) {
      setDayErrors(clientErrors);
      focusFirstInvalid(clientErrors);
      return;
    }
    setDayErrors({});
    setSaving(true);

    // Captured before any awaits (and before `disabled` on the Save button
    // can take effect on the next render) so it's still the real triggering
    // element, same technique `AppointmentCard`'s reschedule button uses.
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const windows = buildProposedWindows(days);
    // Editing the pending generation replaces it (same effective date)
    // rather than overwriting the live hours.
    const effectiveFrom = editingPending ? (pending?.effective_from ?? null) : null;

    try {
      const schedule = await authFetch<ProviderSchedule>(SCHEDULE_PATH, {
        method: "PUT",
        body: { windows, effective_from: effectiveFrom },
      });
      applyLoaded(schedule);
      setSavedMessage(
        effectiveFrom !== null
          ? `New working hours scheduled to take effect ${formatEffectiveDate(effectiveFrom)}.`
          : "Working hours saved."
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && isScheduleConflictBody(error.body)) {
        setCollisionState({
          windows,
          collisions: error.body.collisions,
          earliestSafeDate: error.body.earliest_safe_date,
          description: describeWorkingHoursChange(savedDays, days),
        });
        setCollisionTrigger(trigger);
      } else if (error instanceof ApiError && error.status === 400) {
        const serverErrors = scheduleDayErrors(error.body);
        if (Object.keys(serverErrors).length > 0) {
          setDayErrors(serverErrors);
          focusFirstInvalid(serverErrors);
        } else {
          setFormError(GENERIC_SAVE_ERROR);
        }
      } else if (!(error instanceof ApiError && error.status === 401)) {
        setFormError(GENERIC_SAVE_ERROR);
      }
    }
    setSaving(false);
  }

  /** "Apply from <date>" in the collision modal: re-send the exact same
   * windows with the chosen `effective_from`, scheduling a pending change.
   * On success the response's `current` is unchanged, so the form snaps
   * back to the live hours it always shows. */
  async function handleApplyFrom(date: string) {
    if (!collisionState) {
      return;
    }
    setConfirmingCollision(true);
    setCollisionError(null);
    try {
      const schedule = await authFetch<ProviderSchedule>(SCHEDULE_PATH, {
        method: "PUT",
        body: { windows: collisionState.windows, effective_from: date },
      });
      applyLoaded(schedule);
      setCollisionState(null);
      setSavedMessage(
        `New working hours scheduled to take effect ${formatEffectiveDate(date)}.`
      );
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        setCollisionError(GENERIC_SAVE_ERROR);
      }
    }
    setConfirmingCollision(false);
  }

  function handleCancelCollisionChange() {
    setCollisionState(null);
    setConfirmingCollision(false);
    setCollisionError(null);
    setDayErrors({});
    setFormError(null);
    setEditingPending(false);
    if (savedDays) {
      // "Cancel this change" keeps the provider's current hours: revert
      // the form back to what's actually saved rather than leaving it
      // showing the discarded edit.
      setDays(savedDays);
    }
  }

  /** "Edit pending change" in the banner: hydrate the form with the
   * pending generation's windows. Saving then replaces the pending change
   * (see `handleSubmit`'s `effectiveFrom`). */
  function handleEditPending() {
    if (!pending) {
      return;
    }
    setDays(daysFromWindows(pending.windows));
    setEditingPending(true);
    setSavedMessage(null);
    setFormError(null);
    setDayErrors({});
    focusMonday();
  }

  /** The banner's DELETE succeeded: drop the banner (and a pending edit in
   * progress) right away, then re-sync with the server in place — no
   * loading state, so the form stays put. */
  async function handlePendingCancelled() {
    setPending(null);
    if (editingPending) {
      setEditingPending(false);
      if (savedDays) {
        setDays(savedDays);
      }
    }
    try {
      const schedule = await authFetch<ProviderSchedule>(SCHEDULE_PATH);
      applyLoaded(schedule);
    } catch {
      // The cancel itself succeeded and the local state already matches
      // the server (live hours unchanged, pending gone), so a failed
      // refresh is non-fatal.
    }
  }

  if (loadError) {
    return (
      <section
        aria-labelledby="working-hours-heading"
        className="flex flex-col gap-3 rounded border border-border p-6"
      >
        <h2 id="working-hours-heading" className="text-lg font-semibold">
          Weekly working hours
        </h2>
        <p role="alert" className="text-sm text-danger-text">
          {loadError}
        </p>
        <button
          type="button"
          onClick={retry}
          className="self-start rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </section>
    );
  }

  if (!days) {
    return (
      <section
        aria-labelledby="working-hours-heading"
        className="flex flex-col gap-3 rounded border border-border p-6"
      >
        <h2 id="working-hours-heading" className="text-lg font-semibold">
          Weekly working hours
        </h2>
        <p className="text-sm text-muted-foreground">Loading working hours…</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="working-hours-heading"
      className="flex flex-col gap-4 rounded border border-border p-6"
    >
      <h2 id="working-hours-heading" className="text-lg font-semibold">
        Weekly working hours
      </h2>

      {pending && pending.effective_from !== null ? (
        <PendingScheduleBanner
          effectiveFrom={pending.effective_from}
          pendingWindows={pending.windows}
          currentWindows={currentWindows}
          editingPending={editingPending}
          onEditPending={handleEditPending}
          onCancelled={handlePendingCancelled}
        />
      ) : null}

      {!hasSavedAnyDay ? (
        <div className="flex flex-col items-start gap-3 rounded border border-dashed border-border-strong p-4">
          <p className="text-sm text-muted-foreground">
            You haven&apos;t set your working hours yet.
          </p>
          <button
            type="button"
            onClick={focusMonday}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Set up working hours
          </button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Days available</legend>
          {WEEKDAYS.map(({ value, label }, index) => {
            const day = days[index];
            const error = dayErrors[value];
            const errorId = `${value}-error`;

            return (
              <div key={value} className="flex flex-wrap items-start gap-3">
                <label className="flex w-32 shrink-0 items-center gap-2 pt-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    ref={(element) => {
                      checkboxRefs.current[value] = element;
                    }}
                    checked={day.enabled}
                    onChange={(event) => setDayEnabled(value, event.target.checked)}
                  />
                  {label}
                </label>
                {day.enabled ? (
                  <div className="flex flex-1 flex-col gap-2">
                    {day.blocks.map((block, blockIndex) => {
                      const startId = `${value}-block-${blockIndex}-start`;
                      const endId = `${value}-block-${blockIndex}-end`;

                      return (
                        <div key={block.key} className="flex flex-wrap items-center gap-3">
                          <label htmlFor={startId} className="sr-only">
                            {label} block {blockIndex + 1} start time
                          </label>
                          <input
                            type="time"
                            id={startId}
                            ref={
                              blockIndex === 0
                                ? (element) => {
                                    firstStartRefs.current[value] = element;
                                  }
                                : undefined
                            }
                            value={block.startTime}
                            onChange={(event) =>
                              updateBlock(value, block.key, { startTime: event.target.value })
                            }
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? errorId : undefined}
                            className="rounded border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <span className="text-sm text-muted-foreground">to</span>
                          <label htmlFor={endId} className="sr-only">
                            {label} block {blockIndex + 1} end time
                          </label>
                          <input
                            type="time"
                            id={endId}
                            value={block.endTime}
                            onChange={(event) =>
                              updateBlock(value, block.key, { endTime: event.target.value })
                            }
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? errorId : undefined}
                            className="rounded border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <button
                            type="button"
                            onClick={() => removeBlock(value, block.key)}
                            aria-label={`Remove ${label} block ${blockIndex + 1}`}
                            className="rounded border border-border-strong px-2 py-1.5 text-xs font-medium hover:bg-accent"
                          >
                            ✕ Remove
                          </button>
                        </div>
                      );
                    })}
                    {error ? (
                      <p id={errorId} role="alert" className="text-sm text-danger-text">
                        {error}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => addBlock(value)}
                      aria-label={`Add block to ${label}`}
                      className="self-start text-sm font-medium underline-offset-2 hover:underline"
                    >
                      + Add block
                    </button>
                  </div>
                ) : (
                  <span className="pt-2 text-sm text-muted-foreground">Unavailable</span>
                )}
              </div>
            );
          })}
        </fieldset>

        {formError ? (
          <p role="alert" className="text-sm text-danger-text">
            {formError}
          </p>
        ) : null}
        {savedMessage ? (
          <p role="status" aria-live="polite" className="text-sm text-success-text">
            {savedMessage}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="self-start rounded bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
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
          deferral={
            collisionState.earliestSafeDate !== null
              ? {
                  earliestSafeDate: collisionState.earliestSafeDate,
                  timezone: timezone ?? "UTC",
                  onApplyFrom: handleApplyFrom,
                }
              : { earliestSafeDate: null }
          }
          onCancelChange={handleCancelCollisionChange}
          triggerElement={collisionTrigger}
        />
      ) : null}
    </section>
  );
}

"use client";

import { useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { WEEKDAYS } from "@/lib/availability/days";
import type { ScheduleWindow } from "@/lib/availability/types";
import { normalizeTime } from "@/lib/availability/validation";

const PENDING_SCHEDULE_PATH = "/scheduling/schedule/pending";

const CANCEL_ERROR = "Couldn't cancel the scheduled change — please try again.";
/** `DELETE /scheduling/schedule/pending`'s 404: the pending generation is
 * already gone (applied on its effective date, or cancelled elsewhere), so
 * retrying can't help — only a reload can re-sync the page. */
const GONE_ERROR =
  "This scheduled change no longer exists — please reload the page.";

interface PendingScheduleBannerProps {
  /** The pending generation's effective date, "YYYY-MM-DD"
   * (provider-local). */
  effectiveFrom: string;
  pendingWindows: readonly ScheduleWindow[];
  /** The live generation's windows, for the "what changes" diff line. */
  currentWindows: readonly ScheduleWindow[];
  /** True while the working-hours form below holds the pending windows for
   * editing (the parent flips this via `onEditPending`). */
  editingPending: boolean;
  onEditPending: () => void;
  /** Called after the pending change is successfully deleted server-side;
   * the parent drops the banner and re-syncs the schedule. */
  onCancelled: () => void;
}

/** "2026-08-25" -> "Tuesday, August 25, 2026". Pinned to UTC so the
 * browser's timezone can't shift the calendar date. */
function formatEffectiveFrom(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** One formatted hours string per weekday index (Monday=0...Sunday=6):
 * "09:00–12:00 and 14:00–17:00", or "unavailable" for a day with no
 * windows. Zero-padded "HH:MM" sorts correctly as a string. */
function hoursByDay(windows: readonly ScheduleWindow[]): string[] {
  return WEEKDAYS.map((_, index) => {
    const ranges = windows
      .filter((window) => window.day_of_week === index)
      .map((window) => ({
        start: normalizeTime(window.start_time),
        end: normalizeTime(window.end_time),
      }))
      .sort((a, b) => a.start.localeCompare(b.start));
    return ranges.length > 0
      ? ranges.map((range) => `${range.start}–${range.end}`).join(" and ")
      : "unavailable";
  });
}

/** e.g. "Pending: Mon 10:00–12:00 (currently 09:00–17:00)." — only the
 * days whose hours actually differ. Empty when nothing differs (a pending
 * change identical to the live hours), in which case no diff line shows. */
function describePendingDiff(current: string[], pending: string[]): string {
  const changes = WEEKDAYS.map(({ label }, index) =>
    current[index] !== pending[index]
      ? `${label.slice(0, 3)} ${pending[index]} (currently ${current[index]})`
      : null
  ).filter((line): line is string => line !== null);
  return changes.length > 0 ? `Pending: ${changes.join("; ")}.` : "";
}

/**
 * The "you have a scheduled working-hours change" banner shown above the
 * live-hours form when `GET /scheduling/schedule` returns a non-null
 * `pending`. Shows when the new hours take effect, a short diff of which
 * days change, and an optional read-only Mon–Sun summary behind a
 * "Show full pending schedule" expander.
 *
 * "Edit pending change" hands off to the parent, which hydrates the form
 * with the pending windows (saving then replaces the pending generation).
 * "Cancel pending change" asks an inline one-line confirmation, then
 * `DELETE /scheduling/schedule/pending` — 204 fires `onCancelled`; any
 * failure shows an inline error and keeps the confirm row so the action
 * can be retried without losing the form below.
 */
export function PendingScheduleBanner({
  effectiveFrom,
  pendingWindows,
  currentWindows,
  editingPending,
  onEditPending,
  onCancelled,
}: PendingScheduleBannerProps) {
  const authFetch = useAuthenticatedRequest();
  const [expanded, setExpanded] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const pendingHours = hoursByDay(pendingWindows);
  const diff = describePendingDiff(hoursByDay(currentWindows), pendingHours);

  async function handleConfirmCancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      await authFetch<null>(PENDING_SCHEDULE_PATH, { method: "DELETE" });
      onCancelled();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setCancelError(GONE_ERROR);
      } else if (!(error instanceof ApiError && error.status === 401)) {
        setCancelError(CANCEL_ERROR);
      }
    }
    setCancelling(false);
  }

  function dismissConfirm() {
    setConfirmingCancel(false);
    setCancelError(null);
  }

  return (
    <div
      role="region"
      aria-label="Pending schedule change"
      className="flex flex-col gap-2 rounded border border-warning-border bg-warning-soft p-4 text-warning-soft-foreground"
    >
      <p className="text-sm">
        <strong>
          Scheduled change: new hours take effect {formatEffectiveFrom(effectiveFrom)}
        </strong>{" "}
        (clinic time)
      </p>
      <p className="text-sm">
        Until then, your current hours below stay live for booking.
        {diff ? ` ${diff}` : ""}
      </p>

      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="self-start text-sm font-medium underline-offset-2 hover:underline"
      >
        {expanded ? "Hide full pending schedule ▴" : "Show full pending schedule ▾"}
      </button>
      {expanded ? (
        <ul aria-label="Full pending schedule" className="flex flex-col gap-1 text-sm">
          {WEEKDAYS.map(({ value, label }, index) => (
            <li key={value}>
              <span className="inline-block w-28 font-medium">{label}</span>
              {pendingHours[index]}
            </li>
          ))}
        </ul>
      ) : null}

      {editingPending ? (
        <p role="status" className="text-sm font-medium">
          Editing pending change — saving the form below replaces this scheduled
          change.
        </p>
      ) : null}

      {confirmingCancel ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            Cancel this scheduled change? Your current hours stay live.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={handleConfirmCancel}
              disabled={cancelling}
              className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-danger-foreground hover:opacity-90 disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Yes, cancel it"}
            </button>
            <button
              type="button"
              onClick={dismissConfirm}
              disabled={cancelling}
              className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onEditPending}
            className="rounded border border-border-strong bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            Edit pending change
          </button>
          <button
            type="button"
            onClick={() => setConfirmingCancel(true)}
            className="rounded border border-border-strong bg-background px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-danger-soft"
          >
            Cancel pending change
          </button>
        </div>
      )}

      {cancelError ? (
        <p role="alert" className="text-sm text-danger-text">
          {cancelError}
        </p>
      ) : null}
    </div>
  );
}

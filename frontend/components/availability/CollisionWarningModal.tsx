"use client";

import { useState } from "react";
import { BookingStatusBadge } from "@/components/bookings/BookingStatusBadge";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { formatBookingTimeRange } from "@/lib/bookings/format";
import type {
  AvailabilityCollision,
  CollisionResolution,
} from "@/lib/availability/collisions";

const HEADING_ID = "collision-warning-heading";

/** e.g. `("2026-08-21T18:00:00.000Z", "2026-08-21T18:30:00.000Z",
 * "America/New_York")` -> `"Fri, Aug 21, 2:00–2:30pm"`. Built on
 * `formatBookingTimeRange` (the established booking time-range formatter)
 * plus a short weekday+month+day label, rather than a new
 * date-formatting helper. */
function formatCollisionRow(startIso: string, endIso: string, timeZone: string): string {
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(startIso));
  return `${dateLabel}, ${formatBookingTimeRange(startIso, endIso, timeZone)}`;
}

/** A "YYYY-MM-DD" calendar date is already provider-local wall-clock; pin
 * the formatter to UTC so the browser's own timezone can't shift it a
 * day (the usual date-only `new Date()` hazard). */
function formatDeferralDate(
  date: string,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`)
  );
}

/** "2026-08-25" -> "Aug 25", for the confirm button label. */
function formatDeferralDateShort(date: string): string {
  return formatDeferralDate(date, { month: "short", day: "numeric" });
}

/** "2026-08-25" -> "Tue, Aug 25, 2026", for the earliest-safe-date hint. */
function formatDeferralDateLong(date: string): string {
  return formatDeferralDate(date, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The working-hours caller's deferred-apply option. `earliestSafeDate`
 * is the server's `earliest_safe_date`: the date picker's `min` and
 * default (any later date is allowed, nothing earlier). When the server
 * says the change can't be cleared by deferring (`earliest_safe_date:
 * null`), pass `{ earliestSafeDate: null }`: the modal then offers only
 * "Cancel this change", so `timezone`/`onApplyFrom` have nothing to do
 * and aren't part of that variant.
 */
export type CollisionDeferral =
  | {
      earliestSafeDate: string;
      /** The provider's clinic timezone, named in the earliest-safe-date
       * hint so the date can't be misread as browser-local. */
      timezone: string;
      onApplyFrom: (date: string) => void;
    }
  | { earliestSafeDate: null };

interface CollisionWarningModalProps {
  /** One-sentence description of the proposed change. Wording differs by
   * caller (a working-hours edit vs. a new blocked-time range), so it's
   * supplied by the caller rather than built in here. */
  description: string;
  collisions: readonly AvailabilityCollision[];
  /** The provider's own timezone. Every collision's `start_time`/
   * `end_time` is a UTC instant, rendered here the same way
   * `BlockedTimeRow`/`AgendaRow` render a booking's time. */
  timezone: string;
  /** True while a resolution is being confirmed (the follow-up save runs
   * before this clears). Disables the radios and both buttons so a second
   * click can't fire a second save. */
  confirming: boolean;
  /** A specific, actionable message for a failed confirm attempt. Shown
   * inside the dialog (never behind it, since the background form is
   * covered by the modal's own overlay) so it stays visible until
   * retried. */
  error?: string | null;
  /** The blocked-time caller's resolution: flag the affected bookings as
   * exceptions and save anyway. Its radio renders only when `deferral`
   * is absent — the two resolutions are caller-exclusive. */
  onKeepNewHours?: () => void;
  /** The working-hours caller's resolution: apply the change from a
   * future date instead of now. When present, replaces the "Keep new
   * hours" radio with "Apply the new hours from a future date" plus an
   * embedded date input. */
  deferral?: CollisionDeferral;
  /** "Go back", Esc, the [x], or "Confirm my choice" with "Cancel this
   * change" selected: all four are the same outcome, the proposed change
   * is discarded and nothing is saved. Collapsed into one callback since
   * every caller treats them identically. */
  onCancelChange: () => void;
  /** The Save/Add-block button that opened this modal; focus returns here
   * on close, mirroring `RescheduleDialog`'s dialog pattern. */
  triggerElement: HTMLElement | null;
}

/**
 * Shown instead of saving when either collision-raising endpoint
 * (`PUT /scheduling/schedule` for working hours, `POST
 * /scheduling/blocked-time` for a new blocked range) reports the
 * proposed change would strand existing bookings outside the provider's
 * new availability. Reused by `WorkingHoursSection` (which passes
 * `deferral`) and `BlockedTimeSection` (which passes `onKeepNewHours`);
 * `description`, the affected-appointments list, and the first
 * resolution radio differ between the two callers.
 *
 * A real focus-trapped dialog, sharing `useFocusTrap` with
 * `RescheduleDialog`: focus moves in on open, Tab/Shift+Tab wrap within
 * the dialog's own focusable elements, and focus returns to
 * `triggerElement` on unmount. `role="alertdialog"` rather than
 * `RescheduleDialog`'s `role="dialog"`, since this modal always demands
 * an explicit decision before anything can proceed (an alert dialog is
 * exactly that per the WAI-ARIA APG), where `RescheduleDialog` is a
 * plain confirm/cancel form a user can freely dismiss.
 *
 * The two resolution choices are real `<input type="radio">`s inside a
 * `fieldset`/`legend` (not two similarly-styled buttons), so they're
 * arrow-key switchable and keep their native grouped semantics. Esc and
 * the "Go back"/[x] controls are wired to `onCancelChange` directly, no
 * radio needs to be selected first.
 */
export function CollisionWarningModal({
  description,
  collisions,
  timezone,
  confirming,
  error,
  onKeepNewHours,
  deferral,
  onCancelChange,
  triggerElement,
}: CollisionWarningModalProps) {
  const { ref: dialogRef, onKeyDown: handleKeyDown } = useFocusTrap<HTMLDivElement>({
    triggerElement,
    onEscape: () => {
      if (!confirming) {
        onCancelChange();
      }
    },
  });
  const earliestSafeDate = deferral?.earliestSafeDate ?? null;
  // The deferral radio starts selected (per the wireframe) since it's the
  // resolution the modal exists to offer; the non-deferral caller keeps
  // the original nothing-preselected behaviour.
  const [resolution, setResolution] = useState<CollisionResolution | "apply_from" | null>(
    earliestSafeDate !== null ? "apply_from" : null
  );
  const [applyFromDate, setApplyFromDate] = useState(earliestSafeDate ?? "");

  // "" (cleared input) or a typed-in date earlier than the min: both are
  // dates the server would reject, so the confirm button stays disabled
  // rather than round-tripping for a guaranteed 400.
  const applyFromDateValid =
    earliestSafeDate !== null && applyFromDate >= earliestSafeDate;

  function handleConfirm() {
    if (confirming || resolution === null) {
      return;
    }
    if (resolution === "apply_from") {
      if (deferral && deferral.earliestSafeDate !== null && applyFromDateValid) {
        deferral.onApplyFrom(applyFromDate);
      }
    } else if (resolution === "keep_new_hours") {
      onKeepNewHours?.();
    } else {
      onCancelChange();
    }
  }

  const collisionCountLabel =
    collisions.length === 1
      ? "1 confirmed appointment falls outside the new hours:"
      : `${collisions.length} confirmed appointments fall outside the new hours:`;

  // `deferral` present but `earliestSafeDate: null`: no date can clear
  // every collision, so the only resolution offered is cancelling.
  const cancelOnly = deferral !== undefined && earliestSafeDate === null;

  const confirmDisabled =
    confirming ||
    resolution === null ||
    (resolution === "apply_from" && !applyFromDateValid);

  const confirmLabel = confirming
    ? "Saving…"
    : resolution === "apply_from" && applyFromDateValid
      ? `Apply from ${formatDeferralDateShort(applyFromDate)}`
      : "Confirm my choice";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={HEADING_ID}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex w-full max-w-lg flex-col gap-4 rounded bg-card p-6 text-card-foreground shadow-lg focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id={HEADING_ID}
            className="flex items-center gap-2 text-lg font-semibold text-warning-text"
          >
            <span aria-hidden="true">⚠</span> This change affects existing bookings
          </h2>
          <button
            type="button"
            onClick={onCancelChange}
            disabled={confirming}
            aria-label="Close"
            className="rounded px-1 text-lg leading-none text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <p className="text-sm">{description}</p>
        <p className="text-sm font-medium">{collisionCountLabel}</p>

        <ul className="flex max-h-64 flex-col overflow-y-auto rounded border border-border">
          {collisions.map((collision) => (
            <li
              key={collision.id}
              className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0"
            >
              <BookingStatusBadge status={collision.status} />
              <span className="text-sm">
                {formatCollisionRow(collision.start_time, collision.end_time, timezone)}{" "}
                — Patient: {collision.patient_name} ({collision.appointment_type_name})
              </span>
            </li>
          ))}
        </ul>

        {cancelOnly ? (
          <p className="text-sm text-muted-foreground">
            These will NOT be cancelled or deleted automatically. This change
            can&apos;t be applied from a later date either — no start date would
            clear every affected booking. You can only cancel it and keep your
            current hours.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {deferral
                ? "These appointments will NOT be cancelled. Your new hours can start after the last affected booking instead."
                : "These will NOT be cancelled or deleted automatically. Choose how to proceed:"}
            </p>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">How do you want to proceed?</legend>
              {deferral && deferral.earliestSafeDate !== null ? (
                <div className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    id="collision-apply-from"
                    name="collision-resolution"
                    value="apply_from"
                    checked={resolution === "apply_from"}
                    onChange={() => setResolution("apply_from")}
                    disabled={confirming}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="collision-apply-from" className="font-medium">
                      Apply the new hours from a future date
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="collision-apply-from-date">Start date</label>
                      <input
                        type="date"
                        id="collision-apply-from-date"
                        min={deferral.earliestSafeDate}
                        value={applyFromDate}
                        onChange={(event) => setApplyFromDate(event.target.value)}
                        disabled={confirming}
                        className="rounded border border-input px-3 py-1.5 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Earliest safe date:{" "}
                      {formatDeferralDateLong(deferral.earliestSafeDate)} — the first
                      day after the last affected booking, in your clinic timezone (
                      {deferral.timezone}). Any later date is OK; nothing earlier.
                    </p>
                  </div>
                </div>
              ) : (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="collision-resolution"
                    value="keep_new_hours"
                    checked={resolution === "keep_new_hours"}
                    onChange={() => setResolution("keep_new_hours")}
                    disabled={confirming}
                    className="mt-0.5"
                  />
                  <span>
                    Keep new hours — keep{" "}
                    {collisions.length === 1 ? "this appointment" : `these ${collisions.length} appointments`}{" "}
                    honored as flagged exceptions
                  </span>
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="collision-resolution"
                  value="cancel_change"
                  checked={resolution === "cancel_change"}
                  onChange={() => setResolution("cancel_change")}
                  disabled={confirming}
                  className="mt-0.5"
                />
                <span>Cancel this change — keep my current hours</span>
              </label>
            </fieldset>
          </>
        )}

        {error ? (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        ) : null}

        {cancelOnly ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancelChange}
              disabled={confirming}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              Cancel this change
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancelChange}
              disabled={confirming}
              className="rounded border border-border-strong px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Go back
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmDisabled}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

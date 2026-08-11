"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BookingStatusBadge } from "@/components/bookings/BookingStatusBadge";
import { formatBookingTimeRange } from "@/lib/bookings/format";
import type {
  AvailabilityCollision,
  CollisionResolution,
} from "@/lib/availability/collisions";

const HEADING_ID = "collision-warning-heading";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** e.g. `("2026-08-21T18:00:00.000Z", "2026-08-21T18:30:00.000Z",
 * "America/New_York")` -> `"Fri, Aug 21, 2:00–2:30pm"` -- the wireframe's
 * row format, built on `formatBookingTimeRange` (the established booking
 * time-range formatter) plus a short weekday+month+day label, rather than a
 * new date-formatting helper. */
function formatCollisionRow(startIso: string, endIso: string, timeZone: string): string {
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(startIso));
  return `${dateLabel}, ${formatBookingTimeRange(startIso, endIso, timeZone)}`;
}

interface CollisionWarningModalProps {
  /** One-sentence description of the proposed change -- wording differs by
   * caller (a working-hours edit vs. a new blocked-time range), so it's
   * supplied by the caller rather than built in here. */
  description: string;
  collisions: readonly AvailabilityCollision[];
  /** The provider's own timezone -- every collision's `start_time`/
   * `end_time` is a UTC instant, rendered here the same way
   * `BlockedTimeRow`/`AgendaRow` render a booking's time. */
  timezone: string;
  /** True while "Keep new hours" is being confirmed (the resolution call
   * plus the real save both run before this clears) -- disables the radios
   * and both buttons so a second click can't fire a second save. */
  confirming: boolean;
  /** A specific, actionable message for a failed "Keep new hours" attempt.
   * Shown inside the dialog (never behind it -- the background form is
   * covered by the modal's own overlay) so it stays visible until retried. */
  error?: string | null;
  onKeepNewHours: () => void;
  /** "Go back", Esc, the [x], or "Confirm my choice" with "Cancel this
   * change" selected -- all four are the same outcome: the proposed change
   * is discarded and nothing is saved. Collapsed into one callback since
   * every caller treats them identically. */
  onCancelChange: () => void;
  /** The Save/Add-block button that opened this modal -- focus returns here
   * on close, mirroring `BookingConfirmPanel`'s dialog pattern. */
  triggerElement: HTMLElement | null;
}

/**
 * TICKET-11: shown instead of saving when either collision-checking
 * endpoint (`POST /scheduling/availability/check-collisions` for working
 * hours, `POST /scheduling/blocked-time` for a new blocked range) reports
 * the proposed change would strand existing bookings outside the provider's
 * new availability. Reused verbatim by `WorkingHoursSection` and
 * `BlockedTimeSection` (Screen 7 of the wireframe) -- only `description` and
 * the affected-appointments list differ between the two callers.
 *
 * A real focus-trapped dialog, built on the exact pattern
 * `BookingConfirmPanel` established (the first modal in this codebase --
 * nothing existed before it to reuse instead): focus moves in on open,
 * Tab/Shift+Tab wrap within the dialog's own focusable elements, and focus
 * returns to `triggerElement` on unmount. `role="alertdialog"` rather than
 * `BookingConfirmPanel`'s `role="dialog"` -- this modal always demands an
 * explicit decision before anything can proceed (an alert dialog is exactly
 * that per the WAI-ARIA APG), where `BookingConfirmPanel` is a plain
 * confirm/cancel form a user can freely dismiss.
 *
 * The two resolution choices are real `<input type="radio">`s inside a
 * `fieldset`/`legend` (not two similarly-styled buttons), so they're
 * arrow-key switchable and keep their native grouped semantics. Esc and the
 * "Go back"/[x] controls are wired to `onCancelChange` directly -- no radio
 * needs to be selected first, matching the wireframe's own "Go back" button
 * sitting outside the radio group.
 */
export function CollisionWarningModal({
  description,
  collisions,
  timezone,
  confirming,
  error,
  onKeepNewHours,
  onCancelChange,
  triggerElement,
}: CollisionWarningModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Kept in a ref, updated post-render, so the mount/unmount focus-restore
  // effect below can stay a one-time `[]` effect, matching
  // `BookingConfirmPanel`'s own precedent.
  const triggerElementRef = useRef(triggerElement);
  const [resolution, setResolution] = useState<CollisionResolution | null>(null);

  useEffect(() => {
    triggerElementRef.current = triggerElement;
  }, [triggerElement]);

  useEffect(() => {
    dialogRef.current?.focus();
    return () => {
      const trigger = triggerElementRef.current;
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!confirming) {
        onCancelChange();
      }
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleConfirm() {
    if (confirming || resolution === null) {
      return;
    }
    if (resolution === "keep_new_hours") {
      onKeepNewHours();
    } else {
      onCancelChange();
    }
  }

  const collisionCountLabel =
    collisions.length === 1
      ? "1 confirmed appointment falls outside the new hours:"
      : `${collisions.length} confirmed appointments fall outside the new hours:`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={HEADING_ID}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex w-full max-w-lg flex-col gap-4 rounded bg-white p-6 shadow-lg focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id={HEADING_ID}
            className="flex items-center gap-2 text-lg font-semibold text-amber-800"
          >
            <span aria-hidden="true">⚠</span> This change affects existing bookings
          </h2>
          <button
            type="button"
            onClick={onCancelChange}
            disabled={confirming}
            aria-label="Close"
            className="rounded px-1 text-lg leading-none text-gray-500 hover:text-black disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <p className="text-sm">{description}</p>
        <p className="text-sm font-medium">{collisionCountLabel}</p>

        <ul className="flex max-h-64 flex-col overflow-y-auto rounded border border-gray-200">
          {collisions.map((collision) => (
            <li
              key={collision.id}
              className="flex flex-col gap-1 border-b border-gray-200 px-3 py-2 last:border-b-0"
            >
              <BookingStatusBadge status={collision.status} />
              <span className="text-sm">
                {formatCollisionRow(collision.start_time, collision.end_time, timezone)}{" "}
                — Patient: {collision.patient_name} ({collision.appointment_type_name})
              </span>
            </li>
          ))}
        </ul>

        <p className="text-sm text-gray-600">
          These will NOT be cancelled or deleted automatically. Choose how to proceed:
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">How do you want to proceed?</legend>
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

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancelChange}
            disabled={confirming}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Go back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming || resolution === null}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {confirming ? "Saving…" : "Confirm my choice"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { extractBookingErrorDetail } from "@/lib/bookings/errors";
import {
  formatAppointmentDateTime,
  formatCancellationNoticeMessage,
} from "@/lib/bookings/format";
import { hoursUntilBookingStart, isWithinCancellationNoticeWindow } from "@/lib/bookings/status";
import type { PatientBooking } from "@/lib/bookings/types";
import { BookingStatusBadge } from "./BookingStatusBadge";

interface AppointmentCardProps {
  booking: PatientBooking;
  timezone: string;
  onCancel: (id: number) => Promise<void>;
  /** Defaults to the real clock; a parameter so tests can pin it rather
   * than depending on the real wall clock racing a fixed fixture's start
   * time (matching `AgendaRow`'s own `hasBookingStartPassed` precedent). */
  now?: Date;
}

type Mode = "view" | "confirm-cancel";

/**
 * One appointment card in "My Appointments" (TICKET-09; wireframe Screen
 * 3): status badge, appointment type + provider name, the date/time in the
 * patient's own timezone, and -- on a still-`confirmed` row only --
 * Reschedule and Cancel.
 *
 * Reschedule is rendered as a disabled placeholder rather than omitted
 * entirely: TICKET-10 owns the real behavior, and leaving a real (if
 * inert) button in the layout now means that ticket only has to remove
 * `disabled` and wire up `onClick`, not touch this card's markup at all --
 * the same "leave the seam, don't build behind it" spirit as this ticket's
 * own reminder-sent placeholder below.
 *
 * Cancel is a two-step inline confirm (view -> confirm-cancel -> view),
 * matching `AppointmentTypeRow`'s delete confirmation rather than
 * `BookingConfirmPanel`'s focus-trapped dialog: cancelling one's own
 * already-booked appointment is the same shape of "destructive action a
 * misclick shouldn't be able to trigger" as removing an appointment type,
 * scoped entirely to this one card -- it doesn't need a modal's own
 * overlay, focus trap, and multi-view state machine (built for confirming
 * a *new* booking, with a provider/timezone comparison and a distinct
 * "no longer available" outcome that don't apply here).
 *
 * The 24h notice window is checked client-side first
 * (`isWithinCancellationNoticeWindow`) purely for immediate feedback --
 * Cancel is disabled with a visible, `aria-describedby`-linked reason
 * before a doomed request is ever sent (matching `AgendaRow`'s disabled-
 * "Mark no-show"-with-reason convention). The real enforcement is
 * server-side; if a race lets a click through right at the boundary (the
 * client's clock running a little behind, or the window closing between
 * render and click), the server's own 400 `{"detail": "..."}` message is
 * surfaced verbatim via `extractBookingErrorDetail`, the same pattern
 * `AgendaRow` uses for its own status-update rejections.
 */
export function AppointmentCard({
  booking,
  timezone,
  onCancel,
  now = new Date(),
}: AppointmentCardProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateTimeLabel = formatAppointmentDateTime(booking.start_time, booking.end_time, timezone);
  const actionsAvailable = booking.status === "confirmed";
  const withinNoticeWindow = isWithinCancellationNoticeWindow(booking.start_time, now);
  const actionContext = `${booking.appointment_type_name} with ${booking.provider_name}, ${dateTimeLabel}`;
  const noticeReasonId = `appointment-${booking.id}-notice-reason`;
  const rescheduleReasonId = `appointment-${booking.id}-reschedule-reason`;

  async function handleConfirmCancel() {
    setCancelling(true);
    setError(null);
    try {
      await onCancel(booking.id);
      setMode("view");
    } catch (err) {
      setMode("view");
      if (err instanceof ApiError && err.status === 400) {
        setError(
          extractBookingErrorDetail(err.body) ??
            "Couldn't cancel this appointment — please try again."
        );
      } else if (!(err instanceof ApiError && err.status === 401)) {
        setError("Couldn't cancel this appointment — please try again.");
      }
    } finally {
      setCancelling(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded border border-gray-200 p-4">
      <div aria-live="polite">
        <BookingStatusBadge status={booking.status} />
      </div>
      <p className="font-medium">
        {booking.appointment_type_name} — {booking.provider_name}
      </p>
      <p className="text-sm text-gray-600">
        {dateTimeLabel} (your time, {timezone})
      </p>
      {/* TICKET-12's "reminder sent" indicator renders here, below the time
       * line and above the actions -- this ticket only reserves the spot. */}

      {actionsAvailable && mode === "view" ? (
        <div className="flex flex-wrap items-start gap-3 pt-1">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              disabled
              aria-label={`Reschedule: ${actionContext}`}
              aria-describedby={rescheduleReasonId}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium opacity-50"
            >
              Reschedule
            </button>
            <p id={rescheduleReasonId} className="text-xs text-gray-500">
              Rescheduling isn&apos;t available yet.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setMode("confirm-cancel")}
              disabled={withinNoticeWindow}
              aria-label={`Cancel: ${actionContext}`}
              aria-describedby={withinNoticeWindow ? noticeReasonId : undefined}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Cancel
            </button>
            {withinNoticeWindow ? (
              <p id={noticeReasonId} className="text-xs text-gray-500">
                <span aria-hidden="true">🔒 </span>
                {formatCancellationNoticeMessage(hoursUntilBookingStart(booking.start_time, now))}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {actionsAvailable && mode === "confirm-cancel" ? (
        <div className="flex flex-col gap-2 pt-1">
          <p className="text-sm">
            Cancel {booking.appointment_type_name} with {booking.provider_name} on{" "}
            {dateTimeLabel}? This can&apos;t be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirmCancel}
              disabled={cancelling}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Confirm cancel"}
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              disabled={cancelling}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Never mind
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}

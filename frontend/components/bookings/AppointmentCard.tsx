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
import { RescheduleDialog } from "./RescheduleDialog";

interface AppointmentCardProps {
  booking: PatientBooking;
  timezone: string;
  onCancel: (id: number) => Promise<void>;
  /** Called after a reschedule succeeds and the patient dismisses the
   * dialog's confirmation ("Done"); see `RescheduleDialog`'s own
   * `onRescheduled` doc for why it fires there rather than the instant the
   * PATCH resolves. The parent should refetch its list (see
   * `PatientAppointments`'s `refetchBookings`). */
  onRescheduled: () => void;
  /** Defaults to the real clock; a parameter so tests can pin it rather
   * than depending on the real wall clock racing a fixed fixture's start
   * time (matching `AgendaRow`'s own `hasBookingStartPassed` precedent). */
  now?: Date;
}

type Mode = "view" | "confirm-cancel";

/**
 * One appointment card in "My Appointments": status badge, appointment
 * type + provider name, the date/time in the patient's own timezone, and,
 * on a still-`confirmed` row only, Reschedule and Cancel.
 *
 * Reschedule opens `RescheduleDialog`, a focus-trapped modal launched from
 * this card, chosen over a dedicated route (there is no `GET /bookings/:id`
 * to hydrate one, only the list-returning `GET /bookings/mine` this card's
 * own data already came from) or an in-card expansion (a full month
 * calendar + time grid inside one row of an already-scrollable list reads
 * worse than the same picker in an overlay, and this card is already
 * juggling its own view/confirm-cancel inline modes). See
 * `RescheduleDialog`'s own docstring for the full reasoning.
 *
 * Cancel stays a two-step inline confirm (view -> confirm-cancel -> view),
 * matching `AppointmentTypeRow`'s delete confirmation rather than a modal:
 * cancelling one's own already-booked appointment is a single yes/no
 * question, not a multi-step picker, so it doesn't need a modal's own
 * overlay and focus trap the way Reschedule's real picker does.
 *
 * The 24h notice window is checked client-side first
 * (`isWithinCancellationNoticeWindow`) purely for immediate feedback.
 * Both Reschedule and Cancel are disabled with the same visible,
 * `aria-describedby`-linked reason before a doomed request is ever sent
 * (matching `AgendaRow`'s disabled-"Mark no-show"-with-reason convention),
 * since the notice rule is identical for both actions: one shared reason
 * paragraph, not two copies of the same text. The real enforcement is
 * server-side on both `PATCH /bookings/:id/cancel` and
 * `PATCH /bookings/:id/reschedule`; if a race lets a click through right at
 * the boundary, the server's own 400 `{"detail": "..."}` message is
 * surfaced verbatim via `extractBookingErrorDetail`, here for cancel,
 * inside `RescheduleDialog` for reschedule.
 *
 * "Reminder sent": a small `✉ Reminder sent` note, below the date/time
 * line and above the actions, shown whenever `booking.reminder_sent` is
 * true. Driven by `PatientBookingListSerializer`'s `reminder_sent` field,
 * not derived client-side, since whether the 24h email actually went out
 * is a backend fact (`reminders.models.ReminderLog`), not something this
 * card can infer from `start_time` alone.
 *
 * Cancellation reason: on a `cancelled` booking with a non-empty
 * `cancellation_reason`, a display-only "Cancelled — reason: ..." line
 * renders under the date/time, `whitespace-pre-wrap` so a provider's
 * multi-line reason keeps its line breaks. Patient self-cancels never
 * carry a reason (the field is `""`), so they render no extra line.
 */
export function AppointmentCard({
  booking,
  timezone,
  onCancel,
  onRescheduled,
  now = new Date(),
}: AppointmentCardProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleTrigger, setRescheduleTrigger] = useState<HTMLElement | null>(null);

  const dateTimeLabel = formatAppointmentDateTime(booking.start_time, booking.end_time, timezone);
  const actionsAvailable = booking.status === "confirmed";
  const withinNoticeWindow = isWithinCancellationNoticeWindow(booking.start_time, now);
  const actionContext = `${booking.appointment_type_name} with ${booking.provider_name}, ${dateTimeLabel}`;
  const noticeReasonId = `appointment-${booking.id}-notice-reason`;

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

  function openReschedule() {
    // Captures the clicked `<button>` via `document.activeElement` rather
    // than the click event itself. A real click focuses its target before
    // the handler runs (matching `SlotBrowser`'s own `handleSelectSlot`
    // precedent), purely so `RescheduleDialog` can return focus there on
    // close.
    setRescheduleTrigger(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setRescheduleOpen(true);
  }

  function closeReschedule() {
    setRescheduleOpen(false);
  }

  return (
    <li className="flex flex-col gap-2 rounded border border-border p-4">
      <div aria-live="polite">
        <BookingStatusBadge status={booking.status} />
      </div>
      <p className="font-medium">
        {booking.appointment_type_name} — {booking.provider_name}
      </p>
      <p className="text-sm text-muted-foreground">
        {dateTimeLabel} (your time, {timezone})
      </p>
      {booking.status === "cancelled" && booking.cancellation_reason ? (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          Cancelled — reason: {booking.cancellation_reason}
        </p>
      ) : null}
      {booking.reminder_sent ? (
        <p className="text-xs text-muted-foreground">
          <span aria-hidden="true">✉ </span>
          Reminder sent
        </p>
      ) : null}

      {actionsAvailable && mode === "view" ? (
        <div className="flex flex-col gap-1 pt-1">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={openReschedule}
              disabled={withinNoticeWindow}
              aria-label={`Reschedule: ${actionContext}`}
              aria-describedby={withinNoticeWindow ? noticeReasonId : undefined}
              className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Reschedule
            </button>

            <button
              type="button"
              onClick={() => setMode("confirm-cancel")}
              disabled={withinNoticeWindow}
              aria-label={`Cancel: ${actionContext}`}
              aria-describedby={withinNoticeWindow ? noticeReasonId : undefined}
              className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-danger-soft disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {withinNoticeWindow ? (
            <p id={noticeReasonId} className="text-xs text-muted-foreground">
              <span aria-hidden="true">🔒 </span>
              {formatCancellationNoticeMessage(hoursUntilBookingStart(booking.start_time, now))}
            </p>
          ) : null}
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
              className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-danger-foreground hover:opacity-90 disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Confirm cancel"}
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              disabled={cancelling}
              className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Never mind
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      {rescheduleOpen ? (
        <RescheduleDialog
          booking={booking}
          patientTimeZone={timezone}
          triggerElement={rescheduleTrigger}
          onClose={closeReschedule}
          onRescheduled={onRescheduled}
        />
      ) : null}
    </li>
  );
}

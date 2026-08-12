"use client";

import { formatBookingTimeRange } from "@/lib/bookings/format";
import { hasBookingStartPassed } from "@/lib/bookings/status";
import type { ProviderBooking } from "@/lib/bookings/types";
import {
  useBookingStatusActions,
  type StatusChangeHandler,
} from "@/hooks/use-booking-status-actions";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { CancelConfirmForm } from "./CancelConfirmForm";
import { NotificationWarnings } from "./NotificationWarnings";

interface AgendaRowProps {
  booking: ProviderBooking;
  timezone: string;
  onStatusChange: StatusChangeHandler;
}

/**
 * One appointment row (the narrow-screen agenda fallback under the week
 * grid): time range, status badge, appointment type + patient name, and,
 * on a still-`confirmed` row only, the three role-appropriate status
 * actions (mark completed, mark no-show, cancel), and *never* a
 * confirm/decline action anywhere, since every booking here already
 * arrived pre-confirmed.
 *
 * "Mark no-show" is disabled until the appointment's start time has
 * passed, with a visible (not just `title`-attribute) reason underneath,
 * linked via `aria-describedby`.
 *
 * The status-action state machine — including the two-step
 * reason-required cancel confirm and the post-cancel email/SMS delivery
 * warnings — lives in `useBookingStatusActions`, shared with the week
 * grid's `AppointmentDetailPopover` so the two surfaces can't drift; see
 * that hook, `CancelConfirmForm`, and `NotificationWarnings` for the
 * behavior details.
 */
export function AgendaRow({ booking, timezone, onStatusChange }: AgendaRowProps) {
  const {
    mode,
    acting,
    error,
    cancelReason,
    setCancelReason,
    cancelReasonError,
    emailNotDelivered,
    smsNotDelivered,
    handleAction,
    openConfirmCancel,
    closeConfirmCancel,
    handleConfirmCancel,
  } = useBookingStatusActions(booking, onStatusChange);

  const timeRange = formatBookingTimeRange(booking.start_time, booking.end_time, timezone);
  const actionContext = `${booking.appointment_type_name} with ${booking.patient_name}, ${timeRange}`;
  const noShowAllowed = hasBookingStartPassed(booking.start_time);
  const noShowReasonId = `booking-${booking.id}-no-show-reason`;
  const closed = booking.status !== "confirmed";

  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{timeRange}</span>
          {/* `aria-live` so a status change from an action below (e.g.
           * CONFIRMED -> COMPLETED) is announced without a separate toast. */}
          <div aria-live="polite">
            <BookingStatusBadge status={booking.status} />
          </div>
          <span className="text-sm">
            {booking.appointment_type_name} — {booking.patient_name}
            {closed ? " (closed)" : ""}
          </span>
        </div>

        {booking.status === "confirmed" && mode === "view" ? (
          <div className="flex flex-wrap items-start gap-2">
            <button
              type="button"
              onClick={() => handleAction("completed")}
              disabled={acting !== null}
              aria-label={`Mark completed: ${actionContext}`}
              className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {acting === "completed" ? "Marking…" : "Mark completed"}
            </button>

            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => handleAction("no_show")}
                disabled={acting !== null || !noShowAllowed}
                aria-label={`Mark no-show: ${actionContext}`}
                aria-describedby={!noShowAllowed ? noShowReasonId : undefined}
                className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {acting === "no_show" ? "Marking…" : "Mark no-show"}
              </button>
              {!noShowAllowed ? (
                <p id={noShowReasonId} className="text-xs text-muted-foreground">
                  Available once the appointment&apos;s start time has passed.
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={openConfirmCancel}
              disabled={acting !== null}
              aria-label={`Cancel: ${actionContext}`}
              className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-danger-soft disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>

      {booking.status === "confirmed" && mode === "confirm-cancel" ? (
        <CancelConfirmForm
          idPrefix={`booking-${booking.id}`}
          confirmContext={`${booking.appointment_type_name} with ${booking.patient_name} at ${timeRange}`}
          cancelReason={cancelReason}
          onCancelReasonChange={setCancelReason}
          cancelReasonError={cancelReasonError}
          busy={acting !== null}
          cancelling={acting === "cancelled"}
          onConfirm={handleConfirmCancel}
          onDismiss={closeConfirmCancel}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      <NotificationWarnings
        emailNotDelivered={emailNotDelivered}
        smsNotDelivered={smsNotDelivered}
      />
    </li>
  );
}

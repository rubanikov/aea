"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BookingStatusBadge } from "@/components/bookings/BookingStatusBadge";
import { CancelConfirmForm } from "@/components/bookings/CancelConfirmForm";
import { NotificationWarnings } from "@/components/bookings/NotificationWarnings";
import {
  useBookingStatusActions,
  type StatusChangeHandler,
} from "@/hooks/use-booking-status-actions";
import { formatAppointmentDateTime, formatBookingTimeRange } from "@/lib/bookings/format";
import { hasBookingStartPassed } from "@/lib/bookings/status";
import type { ProviderBooking } from "@/lib/bookings/types";
import type { BlockGeometry } from "@/lib/calendar/layout";
import { AppointmentBlock } from "./AppointmentBlock";

interface AppointmentDetailPopoverProps {
  booking: ProviderBooking;
  timezone: string;
  geometry: BlockGeometry;
  onStatusChange: StatusChangeHandler;
}

/**
 * A grid booking block plus its detail popover: full date/time, status,
 * cancellation reason (when present), and — on a still-`confirmed`
 * booking — the same three role-appropriate status actions as the agenda
 * fallback (mark completed, mark no-show, cancel), with identical
 * `aria-label`s. There is deliberately no confirm/decline action:
 * bookings arrive pre-confirmed via auto-accept.
 *
 * Cancel runs the exact same reason-required confirm flow and post-cancel
 * delivery warnings as `AgendaRow`, via the shared
 * `useBookingStatusActions` / `CancelConfirmForm` /
 * `NotificationWarnings` — one implementation, two surfaces. The action
 * state lives here (not in the popover content), so an in-progress
 * confirm step or a delivered warning survives the popover closing and
 * reopening.
 */
export function AppointmentDetailPopover({
  booking,
  timezone,
  geometry,
  onStatusChange,
}: AppointmentDetailPopoverProps) {
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
  const noShowReasonId = `popover-booking-${booking.id}-no-show-reason`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <AppointmentBlock booking={booking} timezone={timezone} geometry={geometry} />
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">
            {booking.appointment_type_name} — {booking.patient_name}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatAppointmentDateTime(booking.start_time, booking.end_time, timezone)}
          </p>
          {/* `aria-live` so a status change from an action below is
           * announced without a separate toast. */}
          <div aria-live="polite">
            <BookingStatusBadge status={booking.status} />
          </div>
          {booking.status === "cancelled" && booking.cancellation_reason ? (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              Reason: {booking.cancellation_reason}
            </p>
          ) : null}
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

        {booking.status === "confirmed" && mode === "confirm-cancel" ? (
          <CancelConfirmForm
            idPrefix={`popover-booking-${booking.id}`}
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
      </PopoverContent>
    </Popover>
  );
}

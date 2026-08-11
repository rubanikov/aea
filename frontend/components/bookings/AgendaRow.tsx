"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { extractBookingErrorDetail } from "@/lib/bookings/errors";
import { formatBookingTimeRange } from "@/lib/bookings/format";
import { hasBookingStartPassed } from "@/lib/bookings/status";
import type { BookingStatusAction, ProviderBooking } from "@/lib/bookings/types";
import { BookingStatusBadge } from "./BookingStatusBadge";

interface AgendaRowProps {
  booking: ProviderBooking;
  timezone: string;
  onStatusChange: (
    id: number,
    status: BookingStatusAction
  ) => Promise<ProviderBooking>;
}

/**
 * One appointment row: time range, status badge, appointment type +
 * patient name, and -- on a still-`confirmed` row only -- the three
 * role-appropriate status actions (TICKET-08's accept criteria: mark
 * completed, mark no-show, cancel, and *never* a confirm/decline action
 * anywhere, since every booking here already arrived pre-confirmed).
 *
 * "Mark no-show" is disabled until the appointment's start time has
 * passed, with a visible (not just `title`-attribute) reason underneath,
 * linked via `aria-describedby` -- there's no established
 * disabled-button-with-reason component elsewhere in this codebase yet to
 * reuse, so that pairing is established here.
 *
 * Each button carries its own `id`+action+`Marking…` busy label rather
 * than a single shared "saving" flag, since a row can only ever have one
 * action in flight at a time but three different buttons to disable
 * together while it runs.
 */
export function AgendaRow({ booking, timezone, onStatusChange }: AgendaRowProps) {
  const [acting, setActing] = useState<BookingStatusAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const timeRange = formatBookingTimeRange(booking.start_time, booking.end_time, timezone);
  const actionContext = `${booking.appointment_type_name} with ${booking.patient_name}, ${timeRange}`;
  const noShowAllowed = hasBookingStartPassed(booking.start_time);
  const noShowReasonId = `booking-${booking.id}-no-show-reason`;
  const closed = booking.status !== "confirmed";

  async function handleAction(action: BookingStatusAction) {
    if (acting) {
      return;
    }
    setActing(action);
    setError(null);
    try {
      await onStatusChange(booking.id, action);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(
          extractBookingErrorDetail(err.body) ??
            "Couldn't update this appointment — please try again."
        );
      } else if (!(err instanceof ApiError && err.status === 401)) {
        setError("Couldn't update this appointment — please try again.");
      }
    } finally {
      setActing(null);
    }
  }

  return (
    <li className="flex flex-col gap-2 border-b border-gray-200 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">{timeRange}</span>
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

        {booking.status === "confirmed" ? (
          <div className="flex flex-wrap items-start gap-2">
            <button
              type="button"
              onClick={() => handleAction("completed")}
              disabled={acting !== null}
              aria-label={`Mark completed: ${actionContext}`}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
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
                className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                {acting === "no_show" ? "Marking…" : "Mark no-show"}
              </button>
              {!noShowAllowed ? (
                <p id={noShowReasonId} className="text-xs text-gray-500">
                  Available once the appointment&apos;s start time has passed.
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => handleAction("cancelled")}
              disabled={acting !== null}
              aria-label={`Cancel: ${actionContext}`}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {acting === "cancelled" ? "Cancelling…" : "Cancel"}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}

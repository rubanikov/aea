"use client";

import type { BookingStatusAction, ProviderBooking } from "@/lib/bookings/types";
import { AgendaRow } from "./AgendaRow";

interface DayAgendaProps {
  /** e.g. "Tuesday, August 18, 2026", the selected day's `<h2>`. */
  dateLabel: string;
  /** Already filtered to the selected day and sorted by start time. */
  bookings: readonly ProviderBooking[];
  timezone: string;
  onStatusChange: (
    id: number,
    status: BookingStatusAction
  ) => Promise<ProviderBooking>;
}

/**
 * The day-grouped agenda list underneath the week-strip: a real `<h2>`
 * date heading, then one `AgendaRow` per booking, or a clean
 * "no appointments on this day" message instead of a blank list.
 */
export function DayAgenda({ dateLabel, bookings, timezone, onStatusChange }: DayAgendaProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{dateLabel}</h2>
      {bookings.length === 0 ? (
        <p className="text-sm text-gray-600">No appointments on {dateLabel}.</p>
      ) : (
        <ul className="flex flex-col">
          {bookings.map((booking) => (
            <AgendaRow
              key={booking.id}
              booking={booking}
              timezone={timezone}
              onStatusChange={onStatusChange}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

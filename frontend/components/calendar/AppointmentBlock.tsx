"use client";

import type { ComponentProps } from "react";
import { BOOKING_STATUS_DISPLAY, formatBookingTimeRange } from "@/lib/bookings/format";
import type { ProviderBooking } from "@/lib/bookings/types";
import type { BlockGeometry } from "@/lib/calendar/layout";
import { cn } from "@/lib/utils";

/**
 * `...buttonProps` is spread onto the <button>, so the type deliberately
 * drops the props a caller must never smuggle through: the block renders
 * its own content (`children`) and must never accept raw HTML
 * (`dangerouslySetInnerHTML`).
 */
interface AppointmentBlockProps
  extends Omit<ComponentProps<"button">, "children" | "dangerouslySetInnerHTML"> {
  booking: ProviderBooking;
  timezone: string;
  geometry: BlockGeometry;
}

/**
 * One positioned booking block on the week grid: absolutely positioned
 * from `lib/calendar/layout.ts`'s percentage geometry, status-styled per
 * the calendar tokens (confirmed = solid brand left border, completed =
 * dashed success surface, cancelled/no-show = muted + struck-through),
 * and a real `<button>` so it can act as the detail popover's trigger
 * (extra props/ref spread through for Radix `asChild`).
 *
 * The accessible name carries type, patient, time range, and status, so
 * the block is meaningful without the grid's visual position, and status
 * is never conveyed by color alone (the styled border/strike is on top of
 * the labelled status, matching `BookingStatusBadge`'s icon+text rule).
 */
export function AppointmentBlock({
  booking,
  timezone,
  geometry,
  className,
  ...buttonProps
}: AppointmentBlockProps) {
  const timeRange = formatBookingTimeRange(booking.start_time, booking.end_time, timezone);
  const statusText = BOOKING_STATUS_DISPLAY[booking.status].text;
  const closed = booking.status === "cancelled" || booking.status === "no_show";
  const completed = booking.status === "completed";

  return (
    <button
      type="button"
      aria-label={`${booking.appointment_type_name} with ${booking.patient_name}, ${timeRange}, ${statusText}`}
      style={{
        top: `${geometry.topPercent}%`,
        height: `${geometry.heightPercent}%`,
        left: `${geometry.leftPercent}%`,
        width: `${geometry.widthPercent}%`,
      }}
      className={cn(
        "absolute overflow-hidden rounded-sm border px-1 py-0.5 text-left text-xs leading-tight",
        "min-h-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        !closed &&
          !completed &&
          "border-(--slot-open-border) border-l-4 border-l-(--status-confirmed-border) bg-(--slot-open-bg)",
        completed &&
          "border-dashed border-(--success-border) bg-(--status-completed-bg) text-(--status-completed-foreground)",
        closed &&
          "border-(--grid-line) bg-(--status-cancelled-bg) text-(--status-cancelled-foreground) line-through",
        className
      )}
      {...buttonProps}
    >
      <span className="block truncate font-medium" aria-hidden="true">
        {timeRange}
      </span>
      <span className="block truncate" aria-hidden="true">
        {booking.appointment_type_name} — {booking.patient_name}
      </span>
    </button>
  );
}

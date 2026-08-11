import { BOOKING_STATUS_DISPLAY } from "@/lib/bookings/format";
import type { BookingStatus } from "@/lib/bookings/types";

interface BookingStatusBadgeProps {
  status: BookingStatus;
}

/**
 * Icon + text status indicator for a booking -- `● CONFIRMED`,
 * `✓ COMPLETED`, `✕ CANCELLED`, `⊘ NO-SHOW` (TICKET-08's accept criteria:
 * status shown with text/icon, never color alone). The icon is
 * `aria-hidden`; the text alone is what a screen reader announces, so an
 * unsupported glyph never loses the actual status information.
 */
export function BookingStatusBadge({ status }: BookingStatusBadgeProps) {
  const display = BOOKING_STATUS_DISPLAY[status];
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium">
      <span aria-hidden="true">{display.icon}</span>
      {display.text}
    </span>
  );
}

import { ProviderCalendar } from "@/components/bookings/ProviderCalendar";

/**
 * Provider calendar/agenda route (TICKET-08, frontend half) -- a new route,
 * deliberately separate from `/provider` (availability settings, TICKET-04/
 * 05/14). The approved wireframe splits these into two distinct screens
 * (Screen 5 vs. Screen 8): availability *rules* (working hours, appointment
 * types, blocked time) vs. the actual booked appointments against them --
 * a different concern each, not a tab within the same page.
 */
export default function ProviderCalendarPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">My Calendar</h1>
      <ProviderCalendar />
    </div>
  );
}

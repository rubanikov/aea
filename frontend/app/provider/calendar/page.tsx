import { ProviderCalendar } from "@/components/bookings/ProviderCalendar";

/**
 * Provider calendar/agenda route, deliberately separate from `/provider`
 * (availability settings). Availability *rules* (working hours,
 * appointment types, blocked time) and the actual booked appointments
 * against them are a different concern each, not a tab within the same
 * page.
 */
export default function ProviderCalendarPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">My Calendar</h1>
      <ProviderCalendar />
    </div>
  );
}

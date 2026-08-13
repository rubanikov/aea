import { PatientCalendar } from "@/components/bookings/PatientCalendar";

/**
 * Patient dashboard: the patient's own week-grid calendar, mirroring the
 * provider's `/provider/calendar`. Booking moved to its own route
 * (`/patient/book`, reached via the calendar's "+ Book appointment" CTA)
 * when this route stopped mounting the wizard directly.
 */
export default function PatientDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">My Calendar</h1>
      <PatientCalendar />
    </div>
  );
}

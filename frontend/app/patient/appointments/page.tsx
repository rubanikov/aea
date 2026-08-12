import Link from "next/link";
import { PatientAppointments } from "@/components/bookings/PatientAppointments";

/**
 * Patient "My Appointments" route, deliberately separate from `/patient`
 * (the booking flow), the same reasoning `ProviderCalendarPage` used to
 * split `/provider/calendar` from `/provider`. "+ Book new" links straight
 * back to `/patient`, the existing booking flow, rather than duplicating
 * it here.
 */
export default function PatientAppointmentsPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">My Appointments</h1>
        <Link
          href="/patient"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          + Book new
        </Link>
      </div>
      <PatientAppointments />
    </div>
  );
}

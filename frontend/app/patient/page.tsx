"use client";

import { BookingWizard } from "@/components/booking/BookingWizard";

/**
 * Patient dashboard: the four-step booking wizard (Provider → Service →
 * Date & time → Confirm) with its persistent summary rail.
 */
export default function PatientDashboardPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Book an appointment</h1>
      <BookingWizard />
    </div>
  );
}

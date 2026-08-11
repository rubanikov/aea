"use client";

import { BookingFlow } from "@/components/booking/BookingFlow";

/**
 * Patient dashboard: the provider/service picker and open-slot browser.
 */
export default function PatientDashboardPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Book an appointment</h1>
      <BookingFlow />
    </div>
  );
}

"use client";

import { BookingWizard } from "@/components/booking/BookingWizard";

/**
 * Patient booking route: the four-step booking wizard (Provider → Service →
 * Date & time → Confirm) with its persistent summary rail. Moved here from
 * `/patient` when that route became the patient's own calendar — the
 * calendar's "+ Book appointment" CTA (and the appointment list's
 * empty-state links) point here.
 */
export default function PatientBookPage() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Book an appointment</h1>
      <BookingWizard />
    </div>
  );
}

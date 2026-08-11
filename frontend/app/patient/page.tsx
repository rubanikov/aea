"use client";

import { BookingFlow } from "@/components/booking/BookingFlow";

/**
 * Patient dashboard (TICKET-06): the provider/service picker and open-slot
 * browser, replacing TICKET-01's placeholder. Booking a slot (TICKET-07)
 * and any "upcoming appointments" summary are later tickets' scope.
 */
export default function PatientDashboardPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Book an appointment</h1>
      <BookingFlow />
    </div>
  );
}

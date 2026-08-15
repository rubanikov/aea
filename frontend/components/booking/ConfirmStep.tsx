"use client";

import { useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { formatDurationShort } from "@/lib/availability/durations";
import type { AppointmentType } from "@/lib/availability/types";
import { extractBookingErrorDetail } from "@/lib/bookings/errors";
import { formatAppointmentDateTime } from "@/lib/bookings/format";
import type { Booking, Provider, Slot } from "@/lib/scheduling/types";
import { formatTimezone } from "@/lib/timezones";
import { Button } from "@/components/ui/button";

const BOOKINGS_PATH = "/bookings";
const REASON_ID = "booking-confirm-reason";

/** Matches `backend/bookings/views.py`'s `BookingCreateView`: the
 * idempotency key is a request header, not a body field. A plain retry
 * that resends the identical JSON body still carries the same header
 * automatically, with no extra work by the caller beyond generating the
 * key once (see `idempotencyKey` below). */
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

type StepStatus = "form" | "submitting" | "success" | "conflict" | "error";

interface ConfirmStepProps {
  provider: Provider;
  appointmentType: AppointmentType;
  slot: Slot;
  patientTimeZone: string;
  /** The booking succeeded. Called once, right when the success view first
   * renders, so the wizard can mark the flow complete (freeze the rail's
   * "Change" buttons, mark every step done). */
  onBooked: (booking: Booking) => void;
  /** The booking lost the race (409) and the patient chose "Choose another
   * time". The wizard clears the slot and returns to the Date & time step,
   * which refetches on mount — the slot list this session loaded is now
   * known to be stale. */
  onSlotUnavailable: () => void;
  /** From the success view: reset the wizard for a fresh booking. */
  onStartOver: () => void;
}

/**
 * Wizard step 4: the full summary plus the "Confirm booking" action —
 * `POST /bookings`, ported from the retired pre-wizard confirm panel. An
 * inline step rather than a modal dialog now, so the dialog-specific
 * chrome (focus trap, Esc, close/cancel buttons) is gone; navigation away
 * happens through the summary rail instead. Everything about the
 * submission itself is preserved:
 *
 * - One idempotency key per mount of this step, not per click or per
 *   attempt: a retry of the *same* booking attempt after a transient error
 *   reuses the same key, so even a genuine client-side double-fire is safe
 *   server-side. The disable-on-click guard is the first line of defense;
 *   this is the backstop. Leaving and re-entering the step remounts it,
 *   which is a genuinely new attempt and gets a new key.
 * - Auto-accept means no "held for you" countdown and no pending state:
 *   confirming either succeeds immediately (`status: "confirmed"`) or
 *   fails, most interestingly with a 409 when someone else books the same
 *   slot first — rendered as its own distinct "no longer available" view,
 *   not a form error, since the form is no longer actionable at that point.
 * - The "reason for visit" field is collected but intentionally never
 *   sent: `BookingCreateSerializer` (`backend/bookings/serializers.py`)
 *   has no field for it, and there's no reason to send data the API
 *   doesn't define. Kept in the UI per the approved wireframe, a
 *   client-side-only nicety until a real field exists to send it to.
 *
 * The provider's clock leads in the summary, matching the slot button just
 * clicked (`TimeSlotGrid` labels on that same clock) — then the same
 * window on the patient's own, so neither reading is left to guesswork.
 * The success view carries both for the same reason: a confirmation that
 * answers a 10:00am slot with "9:00am" reads as though the wrong time was
 * booked. Timezone names go through `formatTimezone`; raw IANA ids are
 * never shown.
 */
export function ConfirmStep({
  provider,
  appointmentType,
  slot,
  patientTimeZone,
  onBooked,
  onSlotUnavailable,
  onStartOver,
}: ConfirmStepProps) {
  const authFetch = useAuthenticatedRequest();

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<StepStatus>("form");
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);

  async function handleConfirm() {
    if (status === "submitting") {
      return;
    }
    // Disables the button on this same tick, before the request even
    // starts: the client-side half of the double-submit guard.
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const created = await authFetch<Booking>(BOOKINGS_PATH, {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        body: {
          provider_id: provider.id,
          appointment_type_id: appointmentType.id,
          start_time: slot.start,
        },
      });
      setBooking(created);
      setStatus("success");
      onBooked(created);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflictMessage(extractBookingErrorDetail(error.body));
        setStatus("conflict");
      } else if (error instanceof ApiError && error.status === 401) {
        // The shared auth hook is already handling this (refresh-and-retry,
        // then redirect on failure). Just stop showing "Booking…" so the
        // button isn't left disabled if the redirect is delayed.
        setStatus("form");
      } else {
        setStatus("error");
        setErrorMessage("Couldn't book this appointment — please try again.");
      }
    }
  }

  const patientRange = formatAppointmentDateTime(slot.start, slot.end, patientTimeZone);
  const providerRange = formatAppointmentDateTime(slot.start, slot.end, provider.timezone);

  if (status === "conflict") {
    return (
      <div role="alert" className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-danger-text">
          <span aria-hidden="true">⚠</span> This time is no longer available
        </h2>
        <p className="text-sm text-danger-soft-foreground">
          {conflictMessage ??
            "Someone else just booked it. Nothing was booked. Pick another time."}
        </p>
        <Button onClick={onSlotUnavailable} className="self-start">
          Choose another time
        </Button>
      </div>
    );
  }

  if (status === "success" && booking) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-success-text">{"✓ You're booked"}</h2>
        <div className="rounded border border-success-border bg-success-soft p-4 text-sm text-success-soft-foreground">
          <p className="font-medium">
            {appointmentType.name} with {provider.name}
          </p>
          {providerRange === patientRange ? null : (
            <p>
              {providerRange} — provider&apos;s local time (
              {formatTimezone(provider.timezone)})
            </p>
          )}
          <p>
            {patientRange} — your time ({formatTimezone(patientTimeZone)})
          </p>
          <p className="mt-2 text-xs">Confirmation #{booking.id}</p>
        </div>
        <Button onClick={onStartOver} className="self-start">
          Book another appointment
        </Button>
      </div>
    );
  }

  const submitting = status === "submitting";

  return (
    <section aria-labelledby="confirm-step-heading" className="flex flex-col gap-4">
      <h2 id="confirm-step-heading" className="text-lg font-semibold">
        Confirm your appointment
      </h2>

      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">
          {appointmentType.name} ({formatDurationShort(appointmentType.duration_minutes)})
          with {provider.name}
        </p>
        <p>
          {providerRange} — provider&apos;s local time (
          {formatTimezone(provider.timezone)})
        </p>
        <p className="text-muted-foreground">
          Your local time: {patientRange} ({formatTimezone(patientTimeZone)})
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={REASON_ID} className="text-sm font-medium">
          Reason for visit (optional)
        </label>
        <textarea
          id={REASON_ID}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={submitting}
          rows={3}
          className="rounded border border-input bg-card px-3 py-2 text-sm focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        />
      </div>

      {errorMessage ? (
        <p role="alert" className="text-sm text-danger-text">
          {errorMessage}
        </p>
      ) : null}

      <Button onClick={handleConfirm} disabled={submitting} className="self-start">
        {submitting ? "Booking…" : "Confirm booking"}
      </Button>
    </section>
  );
}

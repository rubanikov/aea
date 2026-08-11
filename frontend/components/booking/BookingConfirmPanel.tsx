"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { zonedDateKey, zonedTimeLabel } from "@/lib/availability/timezone";
import type { AppointmentType } from "@/lib/availability/types";
import { formatFullDate, parseDateKey } from "@/lib/scheduling/calendar";
import type { Booking, Provider, Slot } from "@/lib/scheduling/types";

const BOOKINGS_PATH = "/bookings";
const HEADING_ID = "booking-confirm-heading";
const REASON_ID = "booking-confirm-reason";

/** Matches `backend/bookings/views.py`'s `BookingCreateView`: the
 * idempotency key is a request header, not a body field. A plain retry
 * that resends the identical JSON body still carries the same header
 * automatically, with no extra work by the caller beyond generating the
 * key once (see `idempotencyKey` below). */
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** e.g. `("2026-08-18T15:00:00.000Z", "2026-08-18T15:30:00.000Z", "America/Chicago")`
 * -> `"Tuesday, August 18, 2026, 10:00am–10:30am"`. The confirm panel's
 * per-timezone line, built from the same zoned-conversion helpers
 * `SlotBrowser`/`TimeSlotGrid` already use (`lib/availability/timezone.ts`,
 * `lib/scheduling/calendar.ts`) rather than a new date library. */
function formatSlotRange(startIso: string, endIso: string, timeZone: string): string {
  const { year, month, day } = parseDateKey(zonedDateKey(startIso, timeZone));
  const dateLabel = formatFullDate(year, month, day);
  return `${dateLabel}, ${zonedTimeLabel(startIso, timeZone)}–${zonedTimeLabel(endIso, timeZone)}`;
}

type PanelStatus = "form" | "submitting" | "success" | "conflict" | "error";

interface BookingConfirmPanelProps {
  provider: Provider;
  appointmentType: AppointmentType;
  slot: Slot;
  patientTimeZone: string;
  /** The slot `<button>` that opened this panel (captured by the caller via
   * `document.activeElement` at click time, since a real click focuses its
   * target before the click handler runs). Focus returns here when the
   * panel closes, per the WAI-ARIA dialog pattern; if it's no longer in the
   * document by then (a successful booking removes its slot button from the
   * grid underneath), focus is simply left wherever the browser puts it. */
  triggerElement: HTMLElement | null;
  /** Cancel, the [x], or Esc/backdrop-equivalent close: no booking was
   * made (or, from the success view, the user is done looking at the
   * confirmation). Never called while a request is in flight. */
  onClose: () => void;
  /** The booking succeeded. Called once, right when the success view first
   * renders, so the caller can remove this slot from the open list
   * immediately, independent of whether the user has dismissed the
   * confirmation yet. */
  onBooked: (bookedSlot: Slot) => void;
  /** The booking lost the race (409) and the user chose "Choose another
   * time". The caller should close its own reference to this slot and
   * refresh the open slot list, since this slot is now known to be taken. */
  onSlotUnavailable: () => void;
}

/**
 * The booking confirm panel: opened by clicking an open slot in
 * `SlotBrowser`/`TimeSlotGrid`. A real focus-trapped dialog (`role="dialog"`,
 * `aria-modal`, focus moves in on open and back to the triggering slot
 * button on close, Esc closes/cancels, Tab/Shift+Tab wrap within the
 * dialog's own focusable elements).
 *
 * Auto-accept means there's no "held for you" countdown and no pending
 * state: clicking "Confirm booking" either succeeds immediately (the
 * booking comes back already `status: "confirmed"`) or fails, most
 * interestingly with a 409 when someone else books the same slot first.
 * That's rendered as its own distinct "no longer available" view, not a
 * form error, since the form itself is no longer actionable at that point.
 *
 * The "reason for visit" field is collected but intentionally never sent:
 * `BookingCreateSerializer` (`backend/bookings/serializers.py`) has no
 * field for it. It's a plain `serializers.Serializer`, so an extra body
 * key would just be silently ignored rather than rejected, but there's
 * still no reason to send data the API doesn't define anywhere. Kept in
 * the UI because the approved wireframe shows it, a client-side-only
 * nicety for now until a real field exists to send it to.
 */
export function BookingConfirmPanel({
  provider,
  appointmentType,
  slot,
  patientTimeZone,
  triggerElement,
  onClose,
  onBooked,
  onSlotUnavailable,
}: BookingConfirmPanelProps) {
  const authFetch = useAuthenticatedRequest();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Kept in a ref, updated post-render, so the mount/unmount focus-restore
  // effect below can stay a one-time `[]` effect (matching
  // `useAuthenticatedRequest`'s own `routerRef` precedent) instead of
  // re-running (and re-focusing the dialog) if this prop ever changed.
  const triggerElementRef = useRef(triggerElement);

  // One idempotency key per confirm-panel-open (this component's mount),
  // not per click or per attempt. A retry of the *same* booking attempt
  // after a transient error reuses this *same* key, so even a genuine
  // client-side double-fire is safe server-side. The disable-on-click guard
  // below is the first line of defense; this is the backstop.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<PanelStatus>("form");
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);

  useEffect(() => {
    triggerElementRef.current = triggerElement;
  }, [triggerElement]);

  useEffect(() => {
    dialogRef.current?.focus();
    return () => {
      const trigger = triggerElementRef.current;
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, []);

  function closeOrChooseAnother() {
    if (status === "submitting") {
      // Nothing to cancel client-side: the request is already in flight
      // and the idempotency key makes it safe either way. Ignore rather
      // than let Esc abandon the dialog mid-request.
      return;
    }
    if (status === "conflict") {
      onSlotUnavailable();
      return;
    }
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeOrChooseAnother();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

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
      onBooked(slot);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
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

  const patientRange = formatSlotRange(slot.start, slot.end, patientTimeZone);
  const providerRange = formatSlotRange(slot.start, slot.end, provider.timezone);

  let content: ReactNode;

  if (status === "conflict") {
    content = (
      <div role="alert" className="flex flex-col gap-4">
        <h2
          id={HEADING_ID}
          className="flex items-center gap-2 text-lg font-semibold text-red-700"
        >
          <span aria-hidden="true">⚠</span> This time is no longer available
        </h2>
        <p className="text-sm text-red-800">
          Someone else just booked it. Nothing was booked. Pick another time.
        </p>
        <button
          type="button"
          onClick={onSlotUnavailable}
          className="self-start rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Choose another time
        </button>
      </div>
    );
  } else if (status === "success" && booking) {
    content = (
      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        <h2 id={HEADING_ID} className="text-lg font-semibold text-green-700">
          {"✓ You're booked"}
        </h2>
        <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-medium">
            {appointmentType.name} with {provider.name}
          </p>
          <p>
            {patientRange} — your time ({patientTimeZone})
          </p>
          <p className="mt-2 text-xs text-green-800">Confirmation #{booking.id}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="self-start rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Done
        </button>
      </div>
    );
  } else {
    const submitting = status === "submitting";
    content = (
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={HEADING_ID} className="text-lg font-semibold">
            Confirm your appointment
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="rounded px-1 text-lg leading-none text-gray-500 hover:text-black disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">
            {appointmentType.name} with {provider.name}
          </p>
          <p>
            {patientRange} — your time ({patientTimeZone})
          </p>
          <p className="text-gray-600">
            Provider&apos;s local time: {providerRange} ({provider.timezone})
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
            className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50"
          />
        </div>

        {errorMessage ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Booking…" : "Confirm booking"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={HEADING_ID}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded bg-white p-6 shadow-lg focus:outline-none"
      >
        {content}
      </div>
    </div>
  );
}

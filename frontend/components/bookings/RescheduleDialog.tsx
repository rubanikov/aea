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
import { formatDurationShort } from "@/lib/availability/durations";
import { zonedDateKey } from "@/lib/availability/timezone";
import type { AppointmentType } from "@/lib/availability/types";
import { extractBookingErrorDetail } from "@/lib/bookings/errors";
import { formatAppointmentDateTime } from "@/lib/bookings/format";
import type { PatientBooking } from "@/lib/bookings/types";
import {
  addMonths,
  dateKey,
  formatFullDate,
  monthGrid,
  parseDateKey,
  type YearMonth,
} from "@/lib/scheduling/calendar";
import type {
  Provider,
  RescheduledBooking,
  Slot,
  SlotsResponse,
} from "@/lib/scheduling/types";
import { groupSlotsByLocalDate } from "@/lib/scheduling/slots";
import { Calendar } from "../booking/Calendar";
import { TimeSlotGrid } from "../booking/TimeSlotGrid";

const PROVIDERS_PATH = "/scheduling/providers";
const SLOTS_PATH = "/scheduling/slots";
const HEADING_ID = "reschedule-heading";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

type ConfirmStatus = "form" | "submitting" | "success" | "conflict";

/** What the dialog has to resolve before it can render a slot picker at
 * all: which appointment type to ask `GET /scheduling/slots` for, and which
 * clock to plot the answer on. */
interface Schedule {
  appointmentType: AppointmentType;
  /** The provider's own zone -- the one their calendar and working hours
   * are kept in, and therefore the one this picker labels slots in (see
   * `SlotBrowser`'s docstring for why it can't be the patient's). */
  timeZone: string;
}

interface Nav {
  visibleMonth: YearMonth;
  selectedDateKey: string;
}

function monthOf(key: string): YearMonth {
  const { year, month } = parseDateKey(key);
  return { year, month };
}

interface RescheduleDialogProps {
  booking: PatientBooking;
  patientTimeZone: string;
  /** The card's Reschedule button that opened this dialog; focus returns
   * here on close, matching `BookingConfirmPanel`'s dialog pattern. */
  triggerElement: HTMLElement | null;
  /** Esc, the [x], or "Choose a different time"/"Close" from any
   * non-success view: no reschedule happened. Also called, right after
   * `onRescheduled`, when "Done" is clicked on the success view. */
  onClose: () => void;
  /** The reschedule PATCH succeeded. Called once, when "Done" is clicked on
   * the success view, deliberately *not* the instant the request resolves,
   * unlike `BookingConfirmPanel`'s `onBooked`. That panel's own success
   * reaction just filters one slot out of a list rendered *alongside* it;
   * this dialog is rendered *inside* the very `AppointmentCard` for the
   * booking being rescheduled, and `PatientAppointments`' own reaction to
   * this callback is a full refetch of the list (see its docstring),
   * which would unmount this dialog's still-open success confirmation
   * right out from under the patient if it fired immediately. Firing on
   * "Done" instead means the confirmation is always seen before the list
   * underneath changes.
   */
  onRescheduled: () => void;
}

/**
 * Lets a patient move a `confirmed` appointment to another open slot for
 * the *same* provider and appointment type, launched from
 * `AppointmentCard`'s Reschedule button.
 *
 * A modal, not a new route or an in-card expansion: there is no
 * `GET /bookings/:id` to hydrate a fresh route with (only the
 * list-returning `GET /bookings/mine` this booking's own data already came
 * from, and `PATCH`-only mutation endpoints), so a route would have to
 * either refetch the whole list anyway or thread the one booking across a
 * navigation some other way; and an in-card expansion would put a full
 * month calendar + time grid inside one row of an already-scrollable list,
 * which reads worse than the same picker lifted into an overlay. A modal
 * also gets this dialog `BookingConfirmPanel`'s already-established
 * focus-trap pattern (`role="dialog"`, `aria-modal`, Tab-wrap,
 * Esc/return-focus) for free, the same pattern `CollisionWarningModal`
 * already reuses rather than inventing a third one. The trap itself is
 * duplicated here (not extracted into a shared hook), matching both of
 * those components' own precedent of duplicating it rather than factoring
 * out a generic one.
 *
 * One dialog, not two: rather than nesting a second modal for the confirm
 * step (the way the fresh-booking flow splits `SlotBrowser`'s picker from
 * a separate `BookingConfirmPanel`), this dialog's own content just
 * switches between "resolving" / "browsing" / "confirming" / "conflict" /
 * "success", the same way `BookingConfirmPanel` itself already switches
 * content by internal `status` rather than mounting a second dialog for
 * its own success/conflict views.
 *
 * `GET /bookings/mine` (`PatientBookingListSerializer`,
 * `backend/bookings/serializers.py`), this booking's own data source,
 * does not include `appointment_type_id`, only `appointment_type_name`.
 * `GET /scheduling/slots` needs the id, not the name, so it's resolved
 * once on open via `GET /scheduling/providers/:id/appointment-types` (the
 * same endpoint `ServicePicker` already uses for the fresh-booking flow),
 * matched by name, which is safe because an appointment type's name is
 * unique per provider (`unique_appointment_type_name_per_provider`,
 * `backend/scheduling/models.py`). The provider's own timezone is resolved
 * in the same pass, from `GET /scheduling/providers` (it isn't on
 * `GET /bookings/mine`), because the slot picker below renders on the
 * provider's clock exactly as `SlotBrowser` does -- see that component's
 * docstring for why any other clock puts this picker out of step with the
 * provider's calendar. The booking's own `provider_id` is used directly for
 * every request below.
 *
 * The reschedule PATCH carries no idempotency key, unlike `POST /bookings`:
 * `BookingRescheduleSerializer`'s body is `{start_time}` only, with no
 * header the view reads either, so the only double-submit guard here is
 * the client-side "already submitting" check before the request fires,
 * same as every other disable-on-click button in this codebase, without a
 * fabricated backstop the contract doesn't define.
 */
export function RescheduleDialog({
  booking,
  patientTimeZone,
  triggerElement,
  onClose,
  onRescheduled,
}: RescheduleDialogProps) {
  const authFetch = useAuthenticatedRequest();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerElementRef = useRef(triggerElement);

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolveReloadKey, setResolveReloadKey] = useState(0);

  // Null until the patient navigates; the "month containing today, today
  // selected" default is computed from `schedule` on every render instead of
  // being copied into state by an effect, the same shape `ProviderCalendar`
  // uses for the identical "the zone arrives from a fetch, then every day
  // key derives from it" situation.
  const [nav, setNav] = useState<Nav | null>(null);
  const [slotsResponse, setSlotsResponse] = useState<SlotsResponse | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsReloadKey, setSlotsReloadKey] = useState(0);

  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<ConfirmStatus>("form");
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [newBooking, setNewBooking] = useState<RescheduledBooking | null>(null);

  const todayKey = schedule ? zonedDateKey(new Date().toISOString(), schedule.timeZone) : null;
  const effectiveNav: Nav | null =
    nav ??
    (todayKey ? { visibleMonth: monthOf(todayKey), selectedDateKey: todayKey } : null);
  const appointmentTypeId = schedule?.appointmentType.id ?? null;
  // Pulled out as primitives so the slot-fetch effect below can depend on
  // them directly: `effectiveNav` is a fresh object every render, and
  // depending on it would refetch on every same-month day selection too.
  const visibleMonthKey = effectiveNav
    ? `${effectiveNav.visibleMonth.year}-${effectiveNav.visibleMonth.month}`
    : null;

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

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      authFetch<AppointmentType[]>(`${PROVIDERS_PATH}/${booking.provider_id}/appointment-types`),
      authFetch<Provider[]>(PROVIDERS_PATH),
    ])
      .then(([types, providers]) => {
        if (cancelled) {
          return;
        }
        const match = types.find((type) => type.name === booking.appointment_type_name);
        const provider = providers.find(({ id }) => id === booking.provider_id);
        if (!match || !provider) {
          setResolveError(
            "Couldn't find this appointment's service — it may have changed. Please try again."
          );
          return;
        }
        setSchedule({ appointmentType: match, timeZone: provider.timezone });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ApiError && error.status === 401)) {
          setResolveError("Couldn't load rescheduling options — please try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authFetch, booking.provider_id, booking.appointment_type_name, resolveReloadKey]);

  useEffect(() => {
    if (!appointmentTypeId || !visibleMonthKey) {
      return;
    }
    let cancelled = false;
    const [year, month] = visibleMonthKey.split("-").map(Number);
    const grid = monthGrid({ year, month });
    const dateFrom = grid[0].dateKey;
    const dateTo = grid[grid.length - 1].dateKey;

    authFetch<SlotsResponse>(
      `${SLOTS_PATH}?provider_id=${booking.provider_id}&appointment_type_id=${appointmentTypeId}&date_from=${dateFrom}&date_to=${dateTo}`
    )
      .then((result) => {
        if (!cancelled) {
          setSlotsResponse(result);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ApiError && error.status === 401)) {
          setSlotsError("Couldn't load open slots — please try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authFetch, booking.provider_id, appointmentTypeId, visibleMonthKey, slotsReloadKey]);

  function retryResolve() {
    setResolveError(null);
    setResolveReloadKey((key) => key + 1);
  }

  /** Clears the currently-loaded slots and bumps `slotsReloadKey`, forcing a
   * fresh `GET` of the same date range. Mirrors `SlotBrowser`'s own
   * `refreshSlots`. */
  function refreshSlots() {
    setSlotsResponse(null);
    setSlotsReloadKey((key) => key + 1);
  }

  function retrySlots() {
    setSlotsError(null);
    refreshSlots();
  }

  function goToMonth(nextMonth: YearMonth) {
    setSlotsResponse(null);
    setSlotsError(null);
    setNav({
      visibleMonth: nextMonth,
      selectedDateKey: dateKey(nextMonth.year, nextMonth.month, 1),
    });
  }

  function handlePrevMonth() {
    if (effectiveNav) {
      goToMonth(addMonths(effectiveNav.visibleMonth, -1));
    }
  }

  function handleNextMonth() {
    if (effectiveNav) {
      goToMonth(addMonths(effectiveNav.visibleMonth, 1));
    }
  }

  /** Selecting a different day within the already-loaded month: only the
   * filter changes, so this deliberately doesn't clear or refetch slots. */
  function handleSelectDate(nextDateKey: string) {
    if (effectiveNav) {
      setNav({ visibleMonth: effectiveNav.visibleMonth, selectedDateKey: nextDateKey });
    }
  }

  function handleSelectSlot(slot: Slot) {
    setConfirmStatus("form");
    setSubmitErrorMessage(null);
    setConflictMessage(null);
    setSelectedSlot(slot);
  }

  /** "Choose a different time" from the confirm step: back to browsing
   * without treating the already-loaded slot list as stale (unlike a lost
   * race, nothing here indicates it actually is). */
  function handleBackToBrowse() {
    setSelectedSlot(null);
    setConfirmStatus("form");
    setSubmitErrorMessage(null);
  }

  /** Lost the race (409) and the patient chose "Choose another time": the
   * currently-loaded slot list is now known to be stale (some *other*
   * booking took this slot first), so refetch it rather than just dropping
   * the one slot, mirroring `SlotBrowser`'s own `handleSlotUnavailable`. */
  function handleSlotUnavailable() {
    setSelectedSlot(null);
    refreshSlots();
  }

  function handleDone() {
    onRescheduled();
    onClose();
  }

  async function handleConfirmReschedule() {
    if (!selectedSlot || confirmStatus === "submitting") {
      return;
    }
    setConfirmStatus("submitting");
    setSubmitErrorMessage(null);
    try {
      const result = await authFetch<RescheduledBooking>(`/bookings/${booking.id}/reschedule`, {
        method: "PATCH",
        body: { start_time: selectedSlot.start },
      });
      setNewBooking(result);
      setConfirmStatus("success");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflictMessage(extractBookingErrorDetail(error.body));
        setConfirmStatus("conflict");
      } else if (error instanceof ApiError && error.status === 400) {
        setConfirmStatus("form");
        setSubmitErrorMessage(
          extractBookingErrorDetail(error.body) ??
            "Couldn't reschedule this appointment — please try again."
        );
      } else if (error instanceof ApiError && error.status === 401) {
        // The shared auth hook is already handling this (refresh-and-retry,
        // then redirect on failure). Just stop showing "Rescheduling…" so
        // the button isn't left disabled if the redirect is delayed.
        setConfirmStatus("form");
      } else {
        setConfirmStatus("form");
        setSubmitErrorMessage("Couldn't reschedule this appointment — please try again.");
      }
    }
  }

  function closeOrGoBack() {
    if (selectedSlot && confirmStatus === "submitting") {
      // Nothing to cancel client-side; ignore rather than let Esc abandon
      // the dialog mid-request.
      return;
    }
    if (selectedSlot && confirmStatus === "conflict") {
      handleSlotUnavailable();
      return;
    }
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeOrGoBack();
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

  const currentRange = formatAppointmentDateTime(
    booking.start_time,
    booking.end_time,
    patientTimeZone
  );

  let content: ReactNode;

  if (selectedSlot && confirmStatus === "conflict") {
    content = (
      <div role="alert" className="flex flex-col gap-4">
        <h2
          id={HEADING_ID}
          className="flex items-center gap-2 text-lg font-semibold text-danger-text"
        >
          <span aria-hidden="true">⚠</span> This time is no longer available
        </h2>
        <p className="text-sm text-danger-soft-foreground">
          {conflictMessage ??
            "Someone else just booked it. Nothing about this appointment changed. Pick another time."}
        </p>
        <button
          type="button"
          onClick={handleSlotUnavailable}
          className="self-start rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Choose another time
        </button>
      </div>
    );
  } else if (selectedSlot && confirmStatus === "success" && newBooking) {
    content = (
      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        <h2 id={HEADING_ID} className="text-lg font-semibold text-success-text">
          {"✓ Appointment rescheduled"}
        </h2>
        <div className="rounded border border-success-border bg-success-soft p-4 text-sm text-success-soft-foreground">
          <p className="font-medium">
            {booking.appointment_type_name} with {booking.provider_name}
          </p>
          <p>
            {formatAppointmentDateTime(newBooking.start_time, newBooking.end_time, patientTimeZone)}{" "}
            (your time, {patientTimeZone})
          </p>
        </div>
        <button
          type="button"
          onClick={handleDone}
          className="self-start rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Done
        </button>
      </div>
    );
  } else if (selectedSlot) {
    const submitting = confirmStatus === "submitting";
    content = (
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={HEADING_ID} className="text-lg font-semibold">
            Confirm new time
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="rounded px-1 text-lg leading-none text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">
            {booking.appointment_type_name} with {booking.provider_name}
          </p>
          <p className="text-muted-foreground">From: {currentRange}</p>
          <p>
            To: {formatAppointmentDateTime(selectedSlot.start, selectedSlot.end, patientTimeZone)}
          </p>
          <p className="text-xs text-muted-foreground">Your time ({patientTimeZone})</p>
        </div>

        {submitErrorMessage ? (
          <p role="alert" className="text-sm text-danger-text">
            {submitErrorMessage}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirmReschedule}
            disabled={submitting}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? "Rescheduling…" : "Confirm new time"}
          </button>
          <button
            type="button"
            onClick={handleBackToBrowse}
            disabled={submitting}
            className="rounded border border-border-strong px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Choose a different time
          </button>
        </div>
      </div>
    );
  } else {
    let body: ReactNode;

    if (resolveError) {
      body = (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-danger-text">
            {resolveError}
          </p>
          <button
            type="button"
            onClick={retryResolve}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      );
    } else if (!schedule || !effectiveNav) {
      body = <p className="text-sm text-muted-foreground">Loading rescheduling options…</p>;
    } else if (slotsError) {
      body = (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-danger-text">
            {slotsError}
          </p>
          <button
            type="button"
            onClick={retrySlots}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      );
    } else if (slotsResponse === null) {
      body = <p className="text-sm text-muted-foreground">Loading open slots…</p>;
    } else if (!slotsResponse.bookable) {
      body = (
        <p
          role="status"
          className="rounded border border-dashed border-border-strong p-4 text-sm text-muted-foreground"
        >
          {slotsResponse.reason ?? "This provider doesn't have any open availability right now."}
        </p>
      );
    } else {
      // Same clock as `SlotBrowser` and as the provider's own calendar --
      // the provider's, never the patient's browser zone (see
      // `SlotBrowser`'s docstring).
      const slotsByDate = groupSlotsByLocalDate(slotsResponse.slots, schedule.timeZone);
      const datesWithSlots = new Set(slotsByDate.keys());
      const selectedDaySlots = slotsByDate.get(effectiveNav.selectedDateKey) ?? [];
      const { year, month, day } = parseDateKey(effectiveNav.selectedDateKey);
      const selectedDateLabel = formatFullDate(year, month, day);

      body = (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <Calendar
            visibleMonth={effectiveNav.visibleMonth}
            selectedDateKey={effectiveNav.selectedDateKey}
            todayKey={todayKey ?? effectiveNav.selectedDateKey}
            datesWithSlots={datesWithSlots}
            onSelectDate={handleSelectDate}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
          />
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Dates and times shown in {booking.provider_name}&apos;s timezone:{" "}
              <strong>{schedule.timeZone}</strong>
              {patientTimeZone === schedule.timeZone
                ? " (your timezone too)"
                : ` — yours is ${patientTimeZone}`}
            </p>
            <TimeSlotGrid
              slots={selectedDaySlots}
              scheduleTimeZone={schedule.timeZone}
              viewerTimeZone={patientTimeZone}
              selectedDateLabel={selectedDateLabel}
              isToday={effectiveNav.selectedDateKey === todayKey}
              onSelectSlot={handleSelectSlot}
            />
          </div>
        </div>
      );
    }

    content = (
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={HEADING_ID} className="text-lg font-semibold">
            Reschedule appointment
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-1 text-lg leading-none text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          {booking.appointment_type_name} with {booking.provider_name}
          {schedule
            ? ` (${formatDurationShort(schedule.appointmentType.duration_minutes)})`
            : ""}
          {" — currently "}
          {currentRange}
        </p>
        {body}
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
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded bg-card p-6 text-card-foreground shadow-lg focus:outline-none"
      >
        {content}
      </div>
    </div>
  );
}

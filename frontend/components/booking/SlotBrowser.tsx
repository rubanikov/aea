"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { formatDurationShort } from "@/lib/availability/durations";
import { zonedDateKey } from "@/lib/availability/timezone";
import type { AppointmentType } from "@/lib/availability/types";
import {
  addMonths,
  dateKey,
  formatFullDate,
  monthGrid,
  parseDateKey,
  type YearMonth,
} from "@/lib/scheduling/calendar";
import type { Provider, Slot, SlotsResponse } from "@/lib/scheduling/types";
import { BookingConfirmPanel } from "./BookingConfirmPanel";
import { Calendar } from "./Calendar";
import { TimeSlotGrid } from "./TimeSlotGrid";

interface SlotBrowserProps {
  provider: Provider;
  appointmentType: AppointmentType;
  patientTimeZone: string;
  onBack: () => void;
}

const SLOTS_PATH = "/scheduling/slots";

/** Groups a flat slot list by the calendar date each slot's *start* falls
 * on in `timeZone`, sorted within each date by start time. Exported for
 * `RescheduleDialog` (TICKET-10), which needs the exact same grouping over
 * its own (differently-sourced) slot list -- real grouping/sorting logic,
 * not a one-line formatter, so it's shared rather than re-derived. */
export function groupSlotsByLocalDate(
  slots: readonly Slot[],
  timeZone: string
): Map<string, Slot[]> {
  const grouped = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = zonedDateKey(slot.start, timeZone);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(slot);
    } else {
      grouped.set(key, [slot]);
    }
  }
  for (const dateSlots of grouped.values()) {
    dateSlots.sort((a, b) => a.start.localeCompare(b.start));
  }
  return grouped;
}

/**
 * Screen 2 of the wireframe (date/slot browser half): a month calendar
 * (bold = has open slots) next to a time-slot grid for whichever date is
 * selected, both in the patient's own timezone, with the provider's zone
 * surfaced alongside for context. Clicking an open slot (TICKET-07) opens
 * `BookingConfirmPanel`, which owns the actual `POST /bookings` call; this
 * component's own role in booking is just tracking which slot/panel is
 * open and reacting to the two outcomes that affect the list underneath --
 * a success removes that slot immediately, a lost race (409) triggers a
 * refetch of the whole list.
 *
 * Fetches `GET /scheduling/slots` once per visible month (not once per
 * selected date) -- the calendar's bold/dimmed markers need the whole
 * month's data anyway, so selecting a different date within that month
 * only re-filters the already-loaded response, firing no new request.
 * `date_from`/`date_to` are the visible month's full 6-week grid bounds
 * (`monthGrid`, `lib/scheduling/calendar.ts`), which already extends into
 * the adjacent months on both sides -- more than enough padding for a slot
 * near a month boundary to land on a different local calendar date than
 * the provider-local date the API bounds it by (see `SlotsView` in
 * `backend/scheduling/views.py`, which reasons about the same kind of
 * boundary padding for `BlockedTime`).
 */
export function SlotBrowser({
  provider,
  appointmentType,
  patientTimeZone,
  onBack,
}: SlotBrowserProps) {
  const authFetch = useAuthenticatedRequest();

  const [todayKey] = useState(() => zonedDateKey(new Date().toISOString(), patientTimeZone));
  const [visibleMonth, setVisibleMonth] = useState<YearMonth>(() => {
    const { year, month } = parseDateKey(todayKey);
    return { year, month };
  });
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);

  const [slotsResponse, setSlotsResponse] = useState<SlotsResponse | null>(null); // null = loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The slot a patient has clicked to open `BookingConfirmPanel`, plus the
  // `<button>` that opened it (so the panel can return focus there on
  // close) -- both null when the panel is closed.
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const grid = monthGrid(visibleMonth);
    const dateFrom = grid[0].dateKey;
    const dateTo = grid[grid.length - 1].dateKey;

    authFetch<SlotsResponse>(
      `${SLOTS_PATH}?provider_id=${provider.id}&appointment_type_id=${appointmentType.id}&date_from=${dateFrom}&date_to=${dateTo}`
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
          setLoadError("Couldn't load open slots — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, provider.id, appointmentType.id, visibleMonth, reloadKey]);

  /** Clears the currently-loaded slots and bumps `reloadKey`, which the
   * fetch effect above is keyed on -- forces a fresh `GET` of the same
   * date range. */
  function refreshSlots() {
    setSlotsResponse(null);
    setReloadKey((key) => key + 1);
  }

  function retry() {
    setLoadError(null);
    refreshSlots();
  }

  function goToMonth(nextMonth: YearMonth) {
    setSlotsResponse(null);
    setLoadError(null);
    setVisibleMonth(nextMonth);
    // Navigating months moves the selected date to that month's 1st --
    // whatever was selected before almost certainly isn't in the new
    // month, and the newly-loaded response has no data for it yet anyway.
    setSelectedDateKey(dateKey(nextMonth.year, nextMonth.month, 1));
  }

  function handlePrevMonth() {
    goToMonth(addMonths(visibleMonth, -1));
  }

  function handleNextMonth() {
    goToMonth(addMonths(visibleMonth, 1));
  }

  function handleSelectSlot(slot: Slot) {
    // Captures the clicked slot `<button>` via `document.activeElement`
    // rather than threading the DOM event through `TimeSlotGrid`'s
    // `onSelectSlot={(slot: Slot) => void}` prop -- a real click focuses
    // its target before the click handler runs (the browser's own default,
    // and `@testing-library/user-event`'s `click()` reproduces the same
    // sequence), so this reliably is that button. Handed to
    // `BookingConfirmPanel` purely so it can return focus there on close.
    setTriggerElement(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelectedSlot(slot);
  }

  function closeConfirmPanel() {
    setSelectedSlot(null);
  }

  /** The booking succeeded -- remove it from the open list right away so it
   * can't be selected again in this session, independent of the next
   * background refetch (e.g. a month navigation). */
  function handleBookingSuccess(bookedSlot: Slot) {
    setSlotsResponse((previous) =>
      previous
        ? {
            ...previous,
            slots: previous.slots.filter((existing) => existing.start !== bookedSlot.start),
          }
        : previous
    );
  }

  /** Lost the race (409) and the patient chose "Choose another time" --
   * close the panel and refetch, since the slot list this session loaded is
   * now known to be stale. */
  function handleSlotUnavailable() {
    setSelectedSlot(null);
    refreshSlots();
  }

  const slotsByDate = slotsResponse
    ? groupSlotsByLocalDate(slotsResponse.slots, patientTimeZone)
    : new Map<string, Slot[]>();
  const datesWithSlots = new Set(slotsByDate.keys());
  const selectedDaySlots = slotsByDate.get(selectedDateKey) ?? [];
  const { year: selectedYear, month: selectedMonth, day: selectedDay } =
    parseDateKey(selectedDateKey);
  const selectedDateLabel = formatFullDate(selectedYear, selectedMonth, selectedDay);

  return (
    <div className="flex flex-col gap-6">
      <button type="button" onClick={onBack} className="self-start text-sm underline">
        ← Back to services
      </button>

      <h1 className="text-xl font-semibold">
        Book: {appointmentType.name} with {provider.name}
      </h1>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 p-4 text-sm">
        <p>
          Service: {appointmentType.name} (
          {formatDurationShort(appointmentType.duration_minutes)}) — Provider:{" "}
          {provider.name}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Change service/provider
        </button>
      </div>

      {loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-red-600">
            {loadError}
          </p>
          <button
            type="button"
            onClick={retry}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Try again
          </button>
        </div>
      ) : slotsResponse === null ? (
        <p className="text-sm text-gray-600">Loading open slots…</p>
      ) : !slotsResponse.bookable ? (
        <p role="status" className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-600">
          {slotsResponse.reason ?? "This provider doesn't have any open availability yet."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <Calendar
            visibleMonth={visibleMonth}
            selectedDateKey={selectedDateKey}
            todayKey={todayKey}
            datesWithSlots={datesWithSlots}
            onSelectDate={setSelectedDateKey}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
          />

          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">
              Shown in your timezone: <strong>{patientTimeZone}</strong> (detected from
              your browser)
            </p>
            <p className="text-sm text-gray-600">Provider is in {provider.timezone}</p>

            <TimeSlotGrid
              slots={selectedDaySlots}
              patientTimeZone={patientTimeZone}
              selectedDateLabel={selectedDateLabel}
              isToday={selectedDateKey === todayKey}
              onSelectSlot={handleSelectSlot}
            />
          </div>
        </div>
      )}

      {selectedSlot ? (
        <BookingConfirmPanel
          provider={provider}
          appointmentType={appointmentType}
          slot={selectedSlot}
          patientTimeZone={patientTimeZone}
          triggerElement={triggerElement}
          onClose={closeConfirmPanel}
          onBooked={handleBookingSuccess}
          onSlotUnavailable={handleSlotUnavailable}
        />
      ) : null}
    </div>
  );
}

"use client";

import { addMonths, formatFullDate, parseDateKey, type YearMonth } from "@/lib/scheduling/calendar";
import { groupSlotsByLocalDate } from "@/lib/scheduling/slots";
import type { Slot, SlotsResponse } from "@/lib/scheduling/types";
import { Calendar } from "../booking/Calendar";
import { TimeSlotGrid } from "../booking/TimeSlotGrid";

interface RescheduleSlotPickerProps {
  providerName: string;
  /** The provider's own zone -- the one their calendar and working hours
   * are kept in, and therefore the one this picker labels slots in (see
   * `SlotBrowser`'s docstring for why it can't be the patient's). */
  timeZone: string;
  patientTimeZone: string;
  visibleMonth: YearMonth;
  selectedDateKey: string;
  todayKey: string | null;
  /** `null` while the visible month's slots are loading. */
  slotsResponse: SlotsResponse | null;
  slotsError: string | null;
  onRetry: () => void;
  onChangeMonth: (month: YearMonth) => void;
  onSelectDate: (dateKey: string) => void;
  onSelectSlot: (slot: Slot) => void;
}

/**
 * The browsing half of `RescheduleDialog`: month calendar + time grid for
 * the same provider and appointment type, with the slot-loading, slot-error
 * and not-bookable states in front of it. Purely presentational -- the
 * dialog owns the month/day navigation state and the slot fetch, so that
 * stepping to the confirm view and back doesn't lose or refetch the loaded
 * slot list.
 */
export function RescheduleSlotPicker({
  providerName,
  timeZone,
  patientTimeZone,
  visibleMonth,
  selectedDateKey,
  todayKey,
  slotsResponse,
  slotsError,
  onRetry,
  onChangeMonth,
  onSelectDate,
  onSelectSlot,
}: RescheduleSlotPickerProps) {
  if (slotsError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-danger-text">
          {slotsError}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </div>
    );
  }
  if (slotsResponse === null) {
    return <p className="text-sm text-muted-foreground">Loading open slots…</p>;
  }
  if (!slotsResponse.bookable) {
    return (
      <p
        role="status"
        className="rounded border border-dashed border-border-strong p-4 text-sm text-muted-foreground"
      >
        {slotsResponse.reason ?? "This provider doesn't have any open availability right now."}
      </p>
    );
  }

  // Same clock as `SlotBrowser` and as the provider's own calendar --
  // the provider's, never the patient's browser zone (see
  // `SlotBrowser`'s docstring).
  const slotsByDate = groupSlotsByLocalDate(slotsResponse.slots, timeZone);
  const datesWithSlots = new Set(slotsByDate.keys());
  const selectedDaySlots = slotsByDate.get(selectedDateKey) ?? [];
  const { year, month, day } = parseDateKey(selectedDateKey);
  const selectedDateLabel = formatFullDate(year, month, day);

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
      <Calendar
        visibleMonth={visibleMonth}
        selectedDateKey={selectedDateKey}
        todayKey={todayKey ?? selectedDateKey}
        datesWithSlots={datesWithSlots}
        onSelectDate={onSelectDate}
        onPrevMonth={() => onChangeMonth(addMonths(visibleMonth, -1))}
        onNextMonth={() => onChangeMonth(addMonths(visibleMonth, 1))}
      />
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Dates and times shown in {providerName}&apos;s timezone: <strong>{timeZone}</strong>
          {patientTimeZone === timeZone ? " (your timezone too)" : ` — yours is ${patientTimeZone}`}
        </p>
        <TimeSlotGrid
          slots={selectedDaySlots}
          scheduleTimeZone={timeZone}
          viewerTimeZone={patientTimeZone}
          selectedDateLabel={selectedDateLabel}
          isToday={selectedDateKey === todayKey}
          onSelectSlot={onSelectSlot}
        />
      </div>
    </div>
  );
}

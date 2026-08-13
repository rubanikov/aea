"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { zonedDateKey, zonedDateTimeToUtcIso } from "@/lib/availability/timezone";
import type { AppointmentType } from "@/lib/availability/types";
import { monthGrid, parseDateKey } from "@/lib/scheduling/calendar";
import { groupSlotsByLocalDate } from "@/lib/scheduling/slots";
import type { Provider, Slot, SlotsResponse } from "@/lib/scheduling/types";
import { addWeeks, formatWeekRange, startOfWeek, weekDates } from "@/lib/bookings/week";
import { DEFAULT_HOUR_RANGE, visibleHourRange, type HourRange } from "@/lib/calendar/hours";
import {
  layoutBlockedRegion,
  layoutDayBlocks,
  type BlockedRegionGeometry,
} from "@/lib/calendar/layout";
import { formatTimezone } from "@/lib/timezones";
import { minutesRangeLabel } from "@/components/calendar/BlockedTimeRegion";
import { MiniMonth } from "@/components/calendar/MiniMonth";
import { TimeGrid } from "@/components/calendar/TimeGrid";
import { SlotBlock } from "./SlotBlock";

interface DateTimeStepProps {
  provider: Provider;
  appointmentType: AppointmentType;
  /** Browser-detected; already resolved (non-null) by the time
   * `BookingWizard` renders this step. */
  patientTimeZone: string;
  /** The patient picked an open slot; the wizard advances to Confirm. */
  onSelectSlot: (slot: Slot) => void;
}

const SLOTS_PATH = "/scheduling/slots";

/**
 * The complement of a day's open slots within the grid's visible-hour
 * window, as UTC instants — the ranges to hatch as unavailable. Slots are
 * clamped to the window, and adjacent slots (each slot's `end` is the
 * next one's `start`) produce no zero-length gap between them.
 *
 * The window bounds convert the provider's wall-clock hours back to UTC
 * via `zonedDateTimeToUtcIso`; an `endHour` of 24 becomes "24:00", which
 * that helper's `Date.UTC` arithmetic rolls over to the next day's
 * midnight.
 */
function unavailableRanges(
  daySlots: readonly Slot[],
  dayKey: string,
  timeZone: string,
  range: HourRange
): { start: string; end: string }[] {
  const wallHour = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  const windowStart = Date.parse(
    zonedDateTimeToUtcIso(dayKey, wallHour(range.startHour), timeZone)
  );
  const windowEnd = Date.parse(zonedDateTimeToUtcIso(dayKey, wallHour(range.endHour), timeZone));

  const gaps: { start: string; end: string }[] = [];
  let cursor = windowStart;
  for (const slot of daySlots) {
    const slotStart = Date.parse(slot.start);
    const slotEnd = Date.parse(slot.end);
    if (slotEnd <= windowStart || slotStart >= windowEnd) {
      continue;
    }
    if (slotStart > cursor) {
      gaps.push({
        start: new Date(cursor).toISOString(),
        end: new Date(Math.min(slotStart, windowEnd)).toISOString(),
      });
    }
    cursor = Math.max(cursor, slotEnd);
  }
  if (cursor < windowEnd) {
    gaps.push({ start: new Date(cursor).toISOString(), end: new Date(windowEnd).toISOString() });
  }
  return gaps;
}

/**
 * One hatched not-bookable region within a day column. Same visual and
 * accessibility pattern as the provider calendar's `BlockedTimeRegion`
 * (the shared `.hatch-unavailable` texture, `aria-hidden` on the purely
 * visual element, `pointer-events: none` so it never intercepts a click
 * meant for a slot, and a visually-hidden sibling naming the clipped
 * range) — just with patient-facing copy: "Unavailable", not "Blocked".
 */
function UnavailableRegion({ geometry }: { geometry: BlockedRegionGeometry }) {
  const rangeLabel = minutesRangeLabel(geometry.clippedStartMin, geometry.clippedEndMin);
  return (
    <>
      <div
        aria-hidden="true"
        className="hatch-unavailable pointer-events-none absolute inset-x-0"
        style={{
          top: `${geometry.topPercent}%`,
          height: `${geometry.heightPercent}%`,
        }}
      />
      <span className="sr-only">Unavailable, {rangeLabel}</span>
    </>
  );
}

/**
 * Wizard step 3: the same week-grid skeleton as the provider's own
 * calendar — hour ruler + day columns (`TimeGrid`), a `MiniMonth` sidebar
 * for date jumping — but with the blocks being *open slots* (tappable,
 * advancing the wizard) and everything else hatched as unavailable via
 * the shared `.hatch-unavailable` texture.
 *
 * Both the grid and every label are rendered on the *provider's* clock,
 * with the patient's own local time shown alongside each slot when it
 * differs. The schedule being browsed is the provider's — their working
 * hours, their calendar, their blocked time are all kept and displayed in
 * `provider.timezone` — so bucketing days or labelling times in the
 * patient's browser zone instead would shift every slot off that schedule
 * by the offset between the two zones: a provider booked 1:00–1:15 on
 * their own calendar would still see a "1:00pm" block offered here (their
 * 2:00pm, which really is free), and the far end of their working day
 * would drop off the grid entirely. Same rows, same endpoint, two clocks
 * — so it's one clock, the provider's.
 *
 * Fetches `GET /scheduling/slots` once per visible MONTH, not per week:
 * `date_from`/`date_to` are always a full 6-week month-grid's bounds
 * (`monthGrid`, `lib/scheduling/calendar.ts`), keeping the exact fetch
 * pattern the previous month-calendar implementation used — the
 * mini-month's has-open-slots markers need the whole month's data anyway,
 * and week navigation within that range only re-filters the
 * already-loaded response, firing no new request. The fetched month is
 * the one containing the visible week's THURSDAY: a Monday-first week
 * overhangs a month by at most 3 days on either side of its Thursday,
 * and a 6-week Sunday-first month grid always covers at least 4 leading
 * days before the 1st (when the 1st falls late in its week) and 5
 * trailing days after month-end, so the whole visible week is always
 * inside the fetched range.
 *
 * The grid's visible hours are derived from the loaded slots themselves
 * (`visibleHourRange` with no availability rows — patients can't read the
 * provider's availability config), so the grid spans exactly the working
 * hours that produced the month's slots, falling back to
 * `DEFAULT_HOUR_RANGE` only when nothing is open at all.
 *
 * This component fetches fresh on every mount, and `BookingWizard` mounts
 * it only while it's the active step — so returning here after a lost
 * booking race (409 on Confirm) automatically refetches the now-stale
 * slot list, with no explicit refresh plumbing.
 */
export function DateTimeStep({
  provider,
  appointmentType,
  patientTimeZone,
  onSelectSlot,
}: DateTimeStepProps) {
  const authFetch = useAuthenticatedRequest();

  // Every calendar key below — "today", the visible week's days, the days
  // marked as having slots — is a date on the provider's clock, so they
  // all compare against each other and against the slot buckets.
  const scheduleTimeZone = provider.timezone;
  const [todayKey] = useState(() => zonedDateKey(new Date().toISOString(), scheduleTimeZone));
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayKey));

  const [slotsResponse, setSlotsResponse] = useState<SlotsResponse | null>(null); // null = loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /** The month whose 6-week grid the current response covers: the month
   * containing the visible week's Thursday (see the component docstring
   * for why that always contains the whole week). */
  function fetchMonthOf(weekStartKey: string): { year: number; month: number } {
    const { year, month } = parseDateKey(weekDates(weekStartKey)[3]);
    return { year, month };
  }

  const { year: fetchYear, month: fetchMonth } = fetchMonthOf(weekStart);

  useEffect(() => {
    let cancelled = false;
    const grid = monthGrid({ year: fetchYear, month: fetchMonth });
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
  }, [authFetch, provider.id, appointmentType.id, fetchYear, fetchMonth, reloadKey]);

  function retry() {
    setLoadError(null);
    setSlotsResponse(null);
    setReloadKey((key) => key + 1);
  }

  /** Shared by prev/next/Today/mini-month. Navigating within the fetched
   * month keeps the loaded response (the grid just re-filters); crossing
   * into a different month clears it, so the effect above refetches that
   * month's 6-week range — the same navigate-means-refetch shape the
   * previous month calendar used. */
  function goToWeek(nextWeekStart: string) {
    const next = fetchMonthOf(nextWeekStart);
    if (next.year !== fetchYear || next.month !== fetchMonth) {
      setSlotsResponse(null);
      setLoadError(null);
    }
    setWeekStart(nextWeekStart);
  }

  const slotsByDate = slotsResponse
    ? groupSlotsByLocalDate(slotsResponse.slots, scheduleTimeZone)
    : new Map<string, Slot[]>();
  const datesWithSlots = new Set(slotsByDate.keys());
  const days = weekDates(weekStart);
  const weekSlots = days.flatMap((day) => slotsByDate.get(day) ?? []);
  const weekHasSlots = weekSlots.length > 0;
  // Bound the grid by this week's slots, not the whole fetched month: a
  // 6-week month grid can straddle a pending hours switch, and using the
  // month union would paint the old 8–3pm day onto a November week that
  // already runs 8–1 and 4–6.
  const range = slotsResponse
    ? (visibleHourRange(
        [],
        weekSlots.map((slot) => ({ start_time: slot.start, end_time: slot.end })),
        scheduleTimeZone
      ) ?? DEFAULT_HOUR_RANGE)
    : DEFAULT_HOUR_RANGE;

  return (
    <section aria-labelledby="datetime-step-heading" className="flex flex-col gap-4">
      <h2 id="datetime-step-heading" className="text-lg font-semibold">
        Pick a date &amp; time
      </h2>

      {loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-danger-text">
            {loadError}
          </p>
          <button
            type="button"
            onClick={retry}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      ) : slotsResponse === null ? (
        <p className="text-sm text-muted-foreground">Loading open slots…</p>
      ) : !slotsResponse.bookable ? (
        <p
          role="status"
          className="rounded border border-dashed border-border-strong p-4 text-sm text-muted-foreground"
        >
          {slotsResponse.reason ?? "This provider doesn't have any open availability yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Dates and times shown in {provider.name}&apos;s timezone:{" "}
            <strong>{formatTimezone(scheduleTimeZone)}</strong>
          </p>
          {patientTimeZone === scheduleTimeZone ? (
            <p className="text-sm text-muted-foreground">
              That&apos;s your timezone too (detected from your browser).
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your timezone is {formatTimezone(patientTimeZone)} (detected from your
              browser) — each open time also shows what it is on your clock.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => goToWeek(startOfWeek(todayKey))}
              className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => goToWeek(addWeeks(weekStart, -1))}
              aria-label="Go to previous week"
              className="rounded border border-border-strong px-2 py-1 text-sm font-medium hover:bg-accent"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => goToWeek(addWeeks(weekStart, 1))}
              aria-label="Go to next week"
              className="rounded border border-border-strong px-2 py-1 text-sm font-medium hover:bg-accent"
            >
              »
            </button>
            <p aria-live="polite" className="text-base font-semibold">
              {formatWeekRange(weekStart)}
            </p>
          </div>

          <div className="flex flex-col gap-5 md:flex-row md:gap-6">
            <div className="md:w-56 md:shrink-0">
              {/* `key={weekStart}` re-seeds the mini month to follow week
                  navigation, same as the provider calendar. */}
              <MiniMonth
                key={weekStart}
                weekStartKey={weekStart}
                todayKey={todayKey}
                markedDays={datesWithSlots}
                onSelectDay={(dateKey) => goToWeek(startOfWeek(dateKey))}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Dotted = has open slots. Hatched grid areas aren&apos;t bookable.
              </p>
            </div>

            <div className="min-w-0 flex-1 overflow-x-auto">
              <div className="min-w-[36rem]">
                <TimeGrid
                  days={days}
                  todayKey={todayKey}
                  range={range}
                  overlay={
                    weekHasSlots ? null : (
                      <p className="rounded border border-dashed border-border-strong bg-card px-4 py-2 text-sm text-muted-foreground">
                        No open times this week — try another week.
                      </p>
                    )
                  }
                  renderDay={(dayKey) => {
                    const daySlots = slotsByDate.get(dayKey) ?? [];
                    const geometryByIndex = layoutDayBlocks(
                      daySlots.map((slot, index) => ({
                        id: index,
                        start_time: slot.start,
                        end_time: slot.end,
                      })),
                      dayKey,
                      scheduleTimeZone,
                      range
                    );
                    return (
                      <>
                        {unavailableRanges(daySlots, dayKey, scheduleTimeZone, range).map(
                          (gap) => {
                            const region = layoutBlockedRegion(
                              gap,
                              dayKey,
                              scheduleTimeZone,
                              range
                            );
                            return region ? (
                              <UnavailableRegion key={gap.start} geometry={region} />
                            ) : null;
                          }
                        )}
                        {daySlots.map((slot, index) => {
                          const geometry = geometryByIndex.get(index);
                          return geometry ? (
                            <SlotBlock
                              key={slot.start}
                              slot={slot}
                              scheduleTimeZone={scheduleTimeZone}
                              viewerTimeZone={patientTimeZone}
                              geometry={geometry}
                              onSelect={onSelectSlot}
                            />
                          ) : null;
                        })}
                      </>
                    );
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

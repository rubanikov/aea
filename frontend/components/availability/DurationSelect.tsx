"use client";

import type { Ref } from "react";
import { durationOptions, formatDuration } from "@/lib/availability/durations";

interface DurationSelectProps {
  id: string;
  label?: string;
  value: number;
  onChange: (value: number) => void;
  selectRef?: Ref<HTMLSelectElement>;
}

/**
 * Labeled "duration in minutes" dropdown, shared by the add-appointment-type
 * and per-row edit forms in `AppointmentTypesSection`. Options are the
 * curated `DURATION_OPTIONS` preset list rather than free entry, so a
 * selected value is always a sane, clearly-labeled duration ("45 minutes",
 * never a bare "45").
 */
export function DurationSelect({
  id,
  label = "Duration",
  value,
  onChange,
  selectRef,
}: DurationSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        ref={selectRef}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {durationOptions(value).map((minutes) => (
          <option key={minutes} value={minutes}>
            {formatDuration(minutes)}
          </option>
        ))}
      </select>
    </div>
  );
}

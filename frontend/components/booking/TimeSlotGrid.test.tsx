import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeSlotGrid } from "./TimeSlotGrid";
import type { Slot } from "@/lib/scheduling/types";

const SLOTS: Slot[] = [
  { start: "2026-08-24T13:00:00.000Z", end: "2026-08-24T13:30:00.000Z" }, // 9:00am EDT
  { start: "2026-08-24T13:30:00.000Z", end: "2026-08-24T14:00:00.000Z" }, // 9:30am EDT
];

describe("TimeSlotGrid", () => {
  it("renders each slot converted to the patient's timezone, in a labeled group", () => {
    render(
      <TimeSlotGrid
        slots={SLOTS}
        patientTimeZone="America/New_York"
        selectedDateLabel="Monday, August 24, 2026"
        isToday={false}
        onSelectSlot={vi.fn()}
      />
    );

    const group = screen.getByRole("group", {
      name: "Available times for Monday, August 24, 2026",
    });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "9:00am" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "9:30am" })).toBeInTheDocument();
  });

  it("shows each slot in a different viewer's zone when patientTimeZone differs", () => {
    render(
      <TimeSlotGrid
        slots={SLOTS}
        patientTimeZone="America/Chicago"
        selectedDateLabel="Monday, August 24, 2026"
        isToday={false}
        onSelectSlot={vi.fn()}
      />
    );

    // Same UTC instants, one hour earlier in Chicago (CDT, UTC-5) than in
    // New York (EDT, UTC-4).
    expect(screen.getByRole("button", { name: "8:00am" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "8:30am" })).toBeInTheDocument();
  });

  it("calls onSelectSlot with the clicked slot", async () => {
    const user = userEvent.setup();
    const onSelectSlot = vi.fn();
    render(
      <TimeSlotGrid
        slots={SLOTS}
        patientTimeZone="America/New_York"
        selectedDateLabel="Monday, August 24, 2026"
        isToday={false}
        onSelectSlot={onSelectSlot}
      />
    );

    await user.click(screen.getByRole("button", { name: "9:00am" }));

    expect(onSelectSlot).toHaveBeenCalledWith(SLOTS[0]);
  });

  it("shows a today-specific empty message when there are no slots left today", () => {
    render(
      <TimeSlotGrid
        slots={[]}
        patientTimeZone="America/New_York"
        selectedDateLabel="Monday, August 24, 2026"
        isToday
        onSelectSlot={vi.fn()}
      />
    );

    expect(screen.getByText(/no slots left today/i)).toBeInTheDocument();
  });

  it("shows a generic empty message for a future date with nothing open", () => {
    render(
      <TimeSlotGrid
        slots={[]}
        patientTimeZone="America/New_York"
        selectedDateLabel="Wednesday, August 26, 2026"
        isToday={false}
        onSelectSlot={vi.fn()}
      />
    );

    expect(screen.getByText(/no open slots on this date/i)).toBeInTheDocument();
  });
});

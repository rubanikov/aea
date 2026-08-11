import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Calendar } from "./Calendar";

const VISIBLE_MONTH = { year: 2026, month: 8 };

function renderCalendar(overrides: Partial<React.ComponentProps<typeof Calendar>> = {}) {
  const onSelectDate = vi.fn();
  const onPrevMonth = vi.fn();
  const onNextMonth = vi.fn();
  render(
    <Calendar
      visibleMonth={VISIBLE_MONTH}
      selectedDateKey="2026-08-18"
      todayKey="2026-08-17"
      datesWithSlots={new Set(["2026-08-18", "2026-08-19"])}
      onSelectDate={onSelectDate}
      onPrevMonth={onPrevMonth}
      onNextMonth={onNextMonth}
      {...overrides}
    />
  );
  return { onSelectDate, onPrevMonth, onNextMonth };
}

describe("Calendar", () => {
  it("shows the visible month heading and weekday headers", () => {
    renderCalendar();
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.getByText("Su")).toBeInTheDocument();
    expect(screen.getByText("Sa")).toBeInTheDocument();
  });

  it("labels a bookable day with its full date and that it has open slots, and marks it selected", () => {
    renderCalendar();
    const day18 = screen.getByRole("button", {
      name: "Tuesday, August 18, 2026, has open slots",
    });
    expect(day18).toHaveAttribute("aria-pressed", "true");
    expect(day18).toHaveAttribute("aria-disabled", "false");
  });

  it("labels a past day as in the past and not bookable, but keeps it a real, enabled button", () => {
    renderCalendar();
    const pastDay = screen.getByRole("button", {
      name: "Sunday, August 16, 2026, in the past, not bookable",
    });
    expect(pastDay).toHaveAttribute("aria-disabled", "true");
    // Dimmed/past days stay keyboard-reachable -- aria-disabled, not the
    // native `disabled` attribute, which would drop them from the tab
    // order.
    expect(pastDay).not.toBeDisabled();
  });

  it("labels a future day with no slots as fully booked and not bookable", () => {
    renderCalendar();
    expect(
      screen.getByRole("button", {
        name: "Wednesday, August 26, 2026, fully booked, not bookable",
      })
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("calls onSelectDate when a bookable day is clicked", async () => {
    const user = userEvent.setup();
    const { onSelectDate } = renderCalendar();

    await user.click(
      screen.getByRole("button", { name: "Tuesday, August 18, 2026, has open slots" })
    );

    expect(onSelectDate).toHaveBeenCalledWith("2026-08-18");
  });

  it("does not call onSelectDate when a non-bookable day is clicked", async () => {
    const user = userEvent.setup();
    const { onSelectDate } = renderCalendar();

    await user.click(
      screen.getByRole("button", {
        name: "Wednesday, August 26, 2026, fully booked, not bookable",
      })
    );

    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it("calls onPrevMonth / onNextMonth from the nav buttons", async () => {
    const user = userEvent.setup();
    const { onPrevMonth, onNextMonth } = renderCalendar();

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Next month" }));

    expect(onPrevMonth).toHaveBeenCalledTimes(1);
    expect(onNextMonth).toHaveBeenCalledTimes(1);
  });
});

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppointmentTabs } from "./AppointmentTabs";
import type { AppointmentTab } from "@/lib/bookings/types";

/** A tiny controlled wrapper so tests exercise the tablist's own roving-
 * tabindex/focus behavior against real, re-rendering state -- a fully
 * static `active` prop wouldn't let a click/keypress actually move
 * selection. */
function ControlledTabs({ initial }: { initial: AppointmentTab }) {
  const [active, setActive] = useState<AppointmentTab>(initial);
  return <AppointmentTabs active={active} onChange={setActive} />;
}

describe("AppointmentTabs", () => {
  it("renders a real tablist with three tabs, the active one selected", () => {
    render(<ControlledTabs initial="upcoming" />);

    expect(screen.getByRole("tablist", { name: "Appointments" })).toBeInTheDocument();
    const upcoming = screen.getByRole("tab", { name: "Upcoming" });
    const past = screen.getByRole("tab", { name: "Past" });
    const cancelled = screen.getByRole("tab", { name: "Cancelled" });

    expect(upcoming).toHaveAttribute("aria-selected", "true");
    expect(past).toHaveAttribute("aria-selected", "false");
    expect(cancelled).toHaveAttribute("aria-selected", "false");

    // Roving tabindex: only the selected tab is in the Tab order.
    expect(upcoming).toHaveAttribute("tabIndex", "0");
    expect(past).toHaveAttribute("tabIndex", "-1");
    expect(cancelled).toHaveAttribute("tabIndex", "-1");
  });

  it("switches tabs on click", async () => {
    const user = userEvent.setup();
    render(<ControlledTabs initial="upcoming" />);

    await user.click(screen.getByRole("tab", { name: "Past" }));

    expect(screen.getByRole("tab", { name: "Past" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Upcoming" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
  });

  it("moves selection and focus with the arrow keys, wrapping at both ends", async () => {
    const user = userEvent.setup();
    render(<ControlledTabs initial="upcoming" />);

    screen.getByRole("tab", { name: "Upcoming" }).focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Past" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Past" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Cancelled" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Cancelled" })).toHaveFocus();

    // Wraps back around to the first tab.
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Upcoming" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Upcoming" })).toHaveFocus();

    // Wraps backward too.
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Cancelled" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Cancelled" })).toHaveFocus();
  });

  it("Home/End jump to the first/last tab", async () => {
    const user = userEvent.setup();
    render(<ControlledTabs initial="past" />);

    screen.getByRole("tab", { name: "Past" }).focus();

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Cancelled" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Upcoming" })).toHaveFocus();
  });
});

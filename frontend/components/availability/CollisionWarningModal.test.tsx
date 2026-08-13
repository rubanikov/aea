import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollisionWarningModal } from "./CollisionWarningModal";

const COLLISIONS = [
  {
    id: 501,
    start_time: "2026-08-21T18:00:00.000Z",
    end_time: "2026-08-21T18:30:00.000Z",
    patient_name: "J. Alvarez",
    appointment_type_name: "Follow-up",
    status: "confirmed" as const,
  },
  {
    id: 502,
    start_time: "2026-08-21T19:00:00.000Z",
    end_time: "2026-08-21T19:30:00.000Z",
    patient_name: "M. Chen",
    appointment_type_name: "Annual Physical",
    status: "confirmed" as const,
  },
];

function renderModal(overrides: Partial<ComponentProps<typeof CollisionWarningModal>> = {}) {
  const onKeepNewHours = vi.fn();
  const onCancelChange = vi.fn();
  render(
    <CollisionWarningModal
      description="You're changing Friday's hours from 09:00–17:00 to 09:00–13:00."
      collisions={COLLISIONS}
      timezone="America/New_York"
      confirming={false}
      onKeepNewHours={onKeepNewHours}
      onCancelChange={onCancelChange}
      triggerElement={null}
      {...overrides}
    />
  );
  return { onKeepNewHours, onCancelChange };
}

describe("CollisionWarningModal", () => {
  it("renders a labeled alertdialog with the change description and every affected appointment, status shown via BookingStatusBadge", () => {
    renderModal();

    const dialog = screen.getByRole("alertdialog", {
      name: /this change affects existing bookings/i,
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByText("You're changing Friday's hours from 09:00–17:00 to 09:00–13:00.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 confirmed appointments fall outside the new hours:")
    ).toBeInTheDocument();

    const badges = screen.getAllByText("CONFIRMED");
    expect(badges).toHaveLength(2);
    expect(
      screen.getByText("Fri, Aug 21, 2:00–2:30pm — Patient: J. Alvarez (Follow-up)")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fri, Aug 21, 3:00–3:30pm — Patient: M. Chen (Annual Physical)")
    ).toBeInTheDocument();
  });

  it("uses singular wording for exactly one affected appointment", () => {
    renderModal({ collisions: [COLLISIONS[0]] });

    expect(
      screen.getByText("1 confirmed appointment falls outside the new hours:")
    ).toBeInTheDocument();
  });

  it("presents the resolution choice as two real radio buttons inside a labeled fieldset", () => {
    renderModal();

    const group = screen.getByRole("group", { name: /how do you want to proceed/i });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    radios.forEach((radio) => expect(group).toContainElement(radio));
    expect(
      screen.getByRole("radio", { name: /keep new hours/i })
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: /cancel this change/i })
    ).not.toBeChecked();
  });

  it("disables 'Confirm my choice' until a resolution is selected", async () => {
    const user = userEvent.setup();
    renderModal();

    const confirmButton = screen.getByRole("button", { name: "Confirm my choice" });
    expect(confirmButton).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /keep new hours/i }));
    expect(confirmButton).not.toBeDisabled();
  });

  it("'Keep new hours' selected, then 'Confirm my choice', calls onKeepNewHours", async () => {
    const user = userEvent.setup();
    const { onKeepNewHours, onCancelChange } = renderModal();

    await user.click(screen.getByRole("radio", { name: /keep new hours/i }));
    await user.click(screen.getByRole("button", { name: "Confirm my choice" }));

    expect(onKeepNewHours).toHaveBeenCalledTimes(1);
    expect(onCancelChange).not.toHaveBeenCalled();
  });

  it("'Cancel this change' selected, then 'Confirm my choice', calls onCancelChange", async () => {
    const user = userEvent.setup();
    const { onKeepNewHours, onCancelChange } = renderModal();

    await user.click(screen.getByRole("radio", { name: /cancel this change/i }));
    await user.click(screen.getByRole("button", { name: "Confirm my choice" }));

    expect(onCancelChange).toHaveBeenCalledTimes(1);
    expect(onKeepNewHours).not.toHaveBeenCalled();
  });

  it("'Go back' calls onCancelChange without requiring a resolution to be selected first", async () => {
    const user = userEvent.setup();
    const { onCancelChange } = renderModal();

    await user.click(screen.getByRole("button", { name: "Go back" }));

    expect(onCancelChange).toHaveBeenCalledTimes(1);
  });

  it("Escape calls onCancelChange", async () => {
    const user = userEvent.setup();
    const { onCancelChange } = renderModal();

    await user.keyboard("{Escape}");

    expect(onCancelChange).toHaveBeenCalledTimes(1);
  });

  it("Escape is ignored while confirming", async () => {
    const user = userEvent.setup();
    const { onCancelChange } = renderModal({ confirming: true });

    await user.keyboard("{Escape}");

    expect(onCancelChange).not.toHaveBeenCalled();
  });

  it("shows a specific, actionable error inside the dialog when one is passed", () => {
    renderModal({ error: "Couldn't save your working hours — please try again." });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't save your working hours — please try again."
    );
  });

  it("moves focus into the dialog on open", () => {
    renderModal();

    expect(screen.getByRole("alertdialog")).toHaveFocus();
  });

  it("traps Tab focus within the dialog, wrapping from the last focusable element to the first", async () => {
    const user = userEvent.setup();
    renderModal();

    const closeButton = screen.getByRole("button", { name: "Close" });
    // Confirm my choice is disabled until a resolution is picked (and so
    // excluded from the tab order); select one so it's the real last
    // focusable element the wrap needs to land past.
    await user.click(screen.getByRole("radio", { name: /keep new hours/i }));
    const confirmButton = screen.getByRole("button", { name: "Confirm my choice" });

    confirmButton.focus();
    expect(confirmButton).toHaveFocus();

    await user.tab();
    expect(closeButton).toHaveFocus();
  });

  it("traps Shift+Tab, wrapping from the first focusable element to the last", async () => {
    const user = userEvent.setup();
    renderModal();

    const closeButton = screen.getByRole("button", { name: "Close" });
    await user.click(screen.getByRole("radio", { name: /keep new hours/i }));
    const confirmButton = screen.getByRole("button", { name: "Confirm my choice" });

    closeButton.focus();
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirmButton).toHaveFocus();
  });

  describe("deferral prop (working-hours caller)", () => {
    function renderDeferralModal(earliestSafeDate = "2026-08-25") {
      const onApplyFrom = vi.fn();
      const callbacks = renderModal({
        deferral: { earliestSafeDate, timezone: "America/New_York", onApplyFrom },
      });
      return { ...callbacks, onApplyFrom };
    }

    it("replaces 'Keep new hours' with a pre-selected 'Apply from a future date' radio, a date input defaulting to (and floored at) the earliest safe date, and a hint naming it with the clinic timezone", () => {
      renderDeferralModal();

      expect(
        screen.getByRole("radio", { name: /apply the new hours from a future date/i })
      ).toBeChecked();
      expect(
        screen.queryByRole("radio", { name: /keep new hours/i })
      ).not.toBeInTheDocument();

      const dateInput = screen.getByLabelText("Start date");
      expect(dateInput).toHaveValue("2026-08-25");
      expect(dateInput).toHaveAttribute("min", "2026-08-25");
      expect(
        screen.getByText(/earliest safe date: tue, aug 25, 2026/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/america\/new_york/i)).toBeInTheDocument();
    });

    it("labels the confirm button with the chosen date and calls onApplyFrom with it", async () => {
      const user = userEvent.setup();
      const { onApplyFrom, onCancelChange } = renderDeferralModal();

      expect(
        screen.getByRole("button", { name: "Apply from Aug 25" })
      ).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Start date"), {
        target: { value: "2026-09-01" },
      });
      await user.click(screen.getByRole("button", { name: "Apply from Sep 1" }));

      expect(onApplyFrom).toHaveBeenCalledWith("2026-09-01");
      expect(onCancelChange).not.toHaveBeenCalled();
    });

    it("disables confirm while the date is cleared or before the earliest safe date", () => {
      renderDeferralModal();

      fireEvent.change(screen.getByLabelText("Start date"), {
        target: { value: "2026-08-20" },
      });
      expect(screen.getByRole("button", { name: "Confirm my choice" })).toBeDisabled();

      fireEvent.change(screen.getByLabelText("Start date"), {
        target: { value: "" },
      });
      expect(screen.getByRole("button", { name: "Confirm my choice" })).toBeDisabled();
    });

    it("'Cancel this change' selected, then confirm, calls onCancelChange instead of onApplyFrom", async () => {
      const user = userEvent.setup();
      const { onApplyFrom, onCancelChange } = renderDeferralModal();

      await user.click(screen.getByRole("radio", { name: /cancel this change/i }));
      await user.click(screen.getByRole("button", { name: "Confirm my choice" }));

      expect(onCancelChange).toHaveBeenCalledTimes(1);
      expect(onApplyFrom).not.toHaveBeenCalled();
    });

    it("renders cancel-only when the change can't be deferred (earliestSafeDate null): no radios, no date input, an explanation, and a single Cancel button", async () => {
      const user = userEvent.setup();
      const { onCancelChange } = renderModal({ deferral: { earliestSafeDate: null } });

      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
      expect(
        screen.getByText(/can't be applied from a later date/i)
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel this change" }));

      expect(onCancelChange).toHaveBeenCalledTimes(1);
    });
  });

  it("returns focus to the triggering element when the modal unmounts", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Save working hours";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <CollisionWarningModal
        description="You're changing Friday's hours from 09:00–17:00 to 09:00–13:00."
        collisions={COLLISIONS}
        timezone="America/New_York"
        confirming={false}
        onKeepNewHours={vi.fn()}
        onCancelChange={vi.fn()}
        triggerElement={trigger}
      />
    );

    unmount();

    expect(trigger).toHaveFocus();
    document.body.removeChild(trigger);
  });
});

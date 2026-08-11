import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api/client";
import type { PatientBooking } from "@/lib/bookings/types";
import { AppointmentCard } from "./AppointmentCard";

const NOW = new Date("2026-08-12T09:00:00.000Z");

// Starts 24h+ from NOW -- Cancel should be enabled.
const ANNUAL_PHYSICAL: PatientBooking = {
  id: 1,
  provider_id: 10,
  provider_name: "Dr. Amara Osei",
  appointment_type_name: "Annual Physical",
  start_time: "2026-08-18T15:00:00.000Z",
  end_time: "2026-08-18T15:30:00.000Z",
  status: "confirmed",
};

// Starts 14h from NOW -- inside the 24h notice window, matching the
// wireframe's own sample row.
const LAB_REVIEW: PatientBooking = {
  id: 2,
  provider_id: 10,
  provider_name: "Dr. Amara Osei",
  appointment_type_name: "Lab Review",
  start_time: "2026-08-12T23:00:00.000Z",
  end_time: "2026-08-12T23:15:00.000Z",
  status: "confirmed",
};

const CANCELLED_VISIT: PatientBooking = {
  ...ANNUAL_PHYSICAL,
  id: 3,
  status: "cancelled",
};

describe("AppointmentCard", () => {
  it("shows the status badge, type, provider, and time in the given timezone", () => {
    render(
      <AppointmentCard
        booking={ANNUAL_PHYSICAL}
        timezone="America/Chicago"
        onCancel={vi.fn()}
        now={NOW}
      />
    );

    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
    expect(screen.getByText("Annual Physical — Dr. Amara Osei")).toBeInTheDocument();
    // 15:00Z-15:30Z on Aug 18 is 10:00-10:30am in America/Chicago (CDT, UTC-5).
    expect(
      screen.getByText(
        "Tuesday, August 18, 2026, 10:00–10:30am (your time, America/Chicago)"
      )
    ).toBeInTheDocument();
  });

  it("shows no actions on a non-confirmed (e.g. cancelled) booking", () => {
    render(
      <AppointmentCard
        booking={CANCELLED_VISIT}
        timezone="America/Chicago"
        onCancel={vi.fn()}
        now={NOW}
      />
    );

    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reschedule/i })).not.toBeInTheDocument();
  });

  it("renders Reschedule as a disabled coming-soon placeholder", () => {
    render(
      <AppointmentCard
        booking={ANNUAL_PHYSICAL}
        timezone="America/Chicago"
        onCancel={vi.fn()}
        now={NOW}
      />
    );

    const reschedule = screen.getByRole("button", { name: /reschedule/i });
    expect(reschedule).toBeDisabled();
    expect(screen.getByText("Rescheduling isn't available yet.")).toBeInTheDocument();
  });

  it("enables Cancel and hides the notice-window message outside the 24h window", () => {
    render(
      <AppointmentCard
        booking={ANNUAL_PHYSICAL}
        timezone="America/Chicago"
        onCancel={vi.fn()}
        now={NOW}
      />
    );

    expect(screen.getByRole("button", { name: /^cancel:/i })).toBeEnabled();
    expect(screen.queryByText(/inside the 24h change window/)).not.toBeInTheDocument();
  });

  it("disables Cancel with a visible, linked notice-window reason inside the 24h window", () => {
    render(
      <AppointmentCard
        booking={LAB_REVIEW}
        timezone="America/Chicago"
        onCancel={vi.fn()}
        now={NOW}
      />
    );

    const cancelButton = screen.getByRole("button", { name: /^cancel:/i });
    expect(cancelButton).toBeDisabled();
    // 23:00Z on Aug 12 is 14h after 09:00Z -- matching the wireframe's own
    // "Starts in 14h" sample framing exactly.
    const reason = screen.getByText(
      /Starts in 14h — inside the 24h change window\. Call the office to change this visit\./
    );
    expect(reason).toBeInTheDocument();
    expect(cancelButton).toHaveAttribute("aria-describedby", reason.id);
  });

  it("requires a confirm step before cancelling, and does not call onCancel on 'Never mind'", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <AppointmentCard
        booking={ANNUAL_PHYSICAL}
        timezone="America/Chicago"
        onCancel={onCancel}
        now={NOW}
      />
    );

    await user.click(screen.getByRole("button", { name: /^cancel:/i }));
    expect(
      screen.getByText(
        /Cancel Annual Physical with Dr\. Amara Osei on .*\? This can't be undone\./
      )
    ).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Never mind" }));
    expect(screen.queryByText(/This can't be undone/)).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on confirm, calling onCancel with the booking id", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <AppointmentCard
        booking={ANNUAL_PHYSICAL}
        timezone="America/Chicago"
        onCancel={onCancel}
        now={NOW}
      />
    );

    await user.click(screen.getByRole("button", { name: /^cancel:/i }));
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(onCancel).toHaveBeenCalledWith(ANNUAL_PHYSICAL.id);
  });

  it("surfaces the server's specific rejection message on a 400 (the notice-window race)", async () => {
    // Exact wording from `backend/bookings/exceptions.py`'s
    // `CancellationNoticeTooShort`, confirmed against the real endpoint.
    const onCancel = vi.fn().mockRejectedValue(
      new ApiError(400, {
        detail: "This booking cannot be cancelled within 24 hours of its start time.",
      })
    );
    const user = userEvent.setup();
    render(
      <AppointmentCard
        booking={ANNUAL_PHYSICAL}
        timezone="America/Chicago"
        onCancel={onCancel}
        now={NOW}
      />
    );

    await user.click(screen.getByRole("button", { name: /^cancel:/i }));
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This booking cannot be cancelled within 24 hours of its start time."
    );
  });

  it("falls back to a generic message when cancelling fails without a specific server error", async () => {
    const onCancel = vi.fn().mockRejectedValue(new ApiError(500, null));
    const user = userEvent.setup();
    render(
      <AppointmentCard
        booking={ANNUAL_PHYSICAL}
        timezone="America/Chicago"
        onCancel={onCancel}
        now={NOW}
      />
    );

    await user.click(screen.getByRole("button", { name: /^cancel:/i }));
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't cancel this appointment/i
    );
  });
});

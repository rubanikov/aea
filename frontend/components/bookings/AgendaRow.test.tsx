import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api/client";
import type {
  BookingStatusChangeResult,
  ProviderBooking,
} from "@/lib/bookings/types";
import { AgendaRow } from "./AgendaRow";

const TIMEZONE = "America/New_York";

// A past date, so `hasBookingStartPassed` (the "Mark no-show" gate, not
// under test here) is deterministically true on the real clock.
const FOLLOW_UP: ProviderBooking = {
  id: 2,
  patient_id: 102,
  patient_name: "S. Patel",
  appointment_type_name: "Follow-up",
  start_time: "2024-08-18T14:00:00.000Z", // 10:00am ET
  end_time: "2024-08-18T14:15:00.000Z", // 10:15am ET
  status: "confirmed",
  cancellation_reason: "",
};

const CANCEL_CONTEXT = "Cancel: Follow-up with S. Patel, 10:00–10:15am";

describe("AgendaRow provider cancel", () => {
  it("clicking Cancel shows the confirm step with a reason textarea instead of cancelling immediately", async () => {
    const onStatusChange = vi.fn();
    const user = userEvent.setup();
    render(
      <AgendaRow booking={FOLLOW_UP} timezone={TIMEZONE} onStatusChange={onStatusChange} />
    );

    await user.click(screen.getByRole("button", { name: CANCEL_CONTEXT }));

    expect(onStatusChange).not.toHaveBeenCalled();
    const textarea = screen.getByLabelText("Reason for cancelling");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute("maxlength", "500");
    expect(
      screen.getByText(
        "The patient will be told the appointment was cancelled and given this reason. Keep it brief — it may be sent by text message."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("500 characters left")).toBeInTheDocument();
  });

  it("keeps 'Confirm cancel' disabled while the reason is empty or whitespace-only", async () => {
    const user = userEvent.setup();
    render(
      <AgendaRow booking={FOLLOW_UP} timezone={TIMEZONE} onStatusChange={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: CANCEL_CONTEXT }));

    const confirmButton = screen.getByRole("button", { name: "Confirm cancel" });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText("Reason for cancelling"), "   ");
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText("Reason for cancelling"), "Clinic closed");
    expect(confirmButton).toBeEnabled();
  });

  it("updates the live remaining-character count as the reason is typed", async () => {
    const user = userEvent.setup();
    render(
      <AgendaRow booking={FOLLOW_UP} timezone={TIMEZONE} onStatusChange={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: CANCEL_CONTEXT }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "Flu");

    expect(screen.getByText("497 characters left")).toBeInTheDocument();
  });

  it("confirming sends (id, 'cancelled', the typed reason) and shows a busy label while in flight", async () => {
    let resolvePatch!: (result: BookingStatusChangeResult) => void;
    const onStatusChange = vi.fn(
      () => new Promise<BookingStatusChangeResult>((resolve) => (resolvePatch = resolve))
    );
    const user = userEvent.setup();
    render(
      <AgendaRow booking={FOLLOW_UP} timezone={TIMEZONE} onStatusChange={onStatusChange} />
    );

    await user.click(screen.getByRole("button", { name: CANCEL_CONTEXT }));
    await user.type(
      screen.getByLabelText("Reason for cancelling"),
      "Provider is out sick today"
    );
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(onStatusChange).toHaveBeenCalledWith(
      2,
      "cancelled",
      "Provider is out sick today"
    );
    expect(
      screen.getByRole("button", { name: "Cancelling…" })
    ).toBeDisabled();

    resolvePatch({
      booking: {
        ...FOLLOW_UP,
        status: "cancelled",
        cancellation_reason: "Provider is out sick today",
      },
    });
    // On success the confirm step closes (in the real screen the parent's
    // state update then re-renders this row as closed).
    await screen.findByRole("button", { name: CANCEL_CONTEXT });
    expect(screen.queryByLabelText("Reason for cancelling")).not.toBeInTheDocument();
  });

  it("'Never mind' returns to the view state without cancelling", async () => {
    const onStatusChange = vi.fn();
    const user = userEvent.setup();
    render(
      <AgendaRow booking={FOLLOW_UP} timezone={TIMEZONE} onStatusChange={onStatusChange} />
    );

    await user.click(screen.getByRole("button", { name: CANCEL_CONTEXT }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "typo");
    await user.click(screen.getByRole("button", { name: "Never mind" }));

    expect(onStatusChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Reason for cancelling")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: CANCEL_CONTEXT })).toBeInTheDocument();
  });

  it("shows a role=status warning with the exact copy when the cancel result reports the email wasn't sent", async () => {
    const onStatusChange = vi.fn().mockResolvedValue({
      booking: { ...FOLLOW_UP, status: "cancelled", cancellation_reason: "Out sick" },
      notification: {
        email_sent: false,
        email_failed: true,
        sms_attempted: true,
        sms_sent: true,
        sms_skipped_reason: null,
      },
    } satisfies BookingStatusChangeResult);
    const user = userEvent.setup();
    render(
      <AgendaRow booking={FOLLOW_UP} timezone={TIMEZONE} onStatusChange={onStatusChange} />
    );

    await user.click(screen.getByRole("button", { name: CANCEL_CONTEXT }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "Out sick");
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    const warning = await screen.findByRole("status");
    expect(warning).toHaveTextContent(
      "Appointment cancelled, but we couldn't reach the patient by email. Please call them."
    );
    // The SMS went through, so the email warning is the only one.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(warning).not.toHaveTextContent("text message");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders no warning when the cancel result carries no notification", async () => {
    const onStatusChange = vi.fn().mockResolvedValue({
      booking: { ...FOLLOW_UP, status: "cancelled", cancellation_reason: "Out sick" },
    } satisfies BookingStatusChangeResult);
    const user = userEvent.setup();
    render(
      <AgendaRow booking={FOLLOW_UP} timezone={TIMEZONE} onStatusChange={onStatusChange} />
    );

    await user.click(screen.getByRole("button", { name: CANCEL_CONTEXT }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "Out sick");
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    await screen.findByRole("button", { name: CANCEL_CONTEXT });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a 400 cancellation_reason field error inline near the textarea", async () => {
    const onStatusChange = vi
      .fn()
      .mockRejectedValue(
        new ApiError(400, { cancellation_reason: ["This field is required."] })
      );
    const user = userEvent.setup();
    render(
      <AgendaRow booking={FOLLOW_UP} timezone={TIMEZONE} onStatusChange={onStatusChange} />
    );

    await user.click(screen.getByRole("button", { name: CANCEL_CONTEXT }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "reason");
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    const fieldError = await screen.findByText("This field is required.");
    // Inline near the textarea: linked to it via aria-describedby, and the
    // confirm step (textarea included) is still on screen to fix and retry.
    const textarea = screen.getByLabelText("Reason for cancelling");
    expect(textarea).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining(fieldError.id)
    );
  });

  it("falls back to the generic error message on a 400 without a field error", async () => {
    const onStatusChange = vi
      .fn()
      .mockRejectedValue(new ApiError(400, { detail: "Booking already closed." }));
    const user = userEvent.setup();
    render(
      <AgendaRow booking={FOLLOW_UP} timezone={TIMEZONE} onStatusChange={onStatusChange} />
    );

    await user.click(screen.getByRole("button", { name: CANCEL_CONTEXT }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "reason");
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Booking already closed."
    );
  });
});

describe("AgendaRow post-cancel SMS warning", () => {
  const EMAIL_WARNING =
    "Appointment cancelled, but we couldn't reach the patient by email. Please call them.";
  const SMS_WARNING =
    "Appointment cancelled, but we couldn't send the text message. Please call the patient.";

  /** Runs the full cancel flow with a successful PATCH whose response
   * carries the given notification report, then resolves once the confirm
   * step has closed so warning assertions run against the settled row. */
  async function cancelWithNotification(
    notification: BookingStatusChangeResult["notification"]
  ) {
    const onStatusChange = vi.fn().mockResolvedValue({
      booking: { ...FOLLOW_UP, status: "cancelled", cancellation_reason: "Out sick" },
      notification,
    } satisfies BookingStatusChangeResult);
    const user = userEvent.setup();
    render(
      <AgendaRow booking={FOLLOW_UP} timezone={TIMEZONE} onStatusChange={onStatusChange} />
    );

    await user.click(screen.getByRole("button", { name: CANCEL_CONTEXT }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "Out sick");
    await user.click(screen.getByRole("button", { name: "Confirm cancel" }));
    await screen.findByRole("button", { name: CANCEL_CONTEXT });
  }

  it("warns about the failed text (and not about email) when SMS was attempted but failed", async () => {
    await cancelWithNotification({
      email_sent: true,
      email_failed: false,
      sms_attempted: true,
      sms_sent: false,
      sms_skipped_reason: "send_failed",
    });

    const warnings = screen.getAllByRole("status");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toHaveTextContent(SMS_WARNING);
    expect(screen.queryByText(EMAIL_WARNING)).not.toBeInTheDocument();
  });

  it("shows both warnings when both the email and the text failed", async () => {
    await cancelWithNotification({
      email_sent: false,
      email_failed: true,
      sms_attempted: true,
      sms_sent: false,
      sms_skipped_reason: "send_failed",
    });

    const warnings = screen.getAllByRole("status");
    expect(warnings).toHaveLength(2);
    expect(screen.getByText(EMAIL_WARNING)).toBeInTheDocument();
    expect(screen.getByText(SMS_WARNING)).toBeInTheDocument();
  });

  it("shows no warning when SMS was skipped because the patient has no phone on file", async () => {
    await cancelWithNotification({
      email_sent: true,
      email_failed: false,
      sms_attempted: false,
      sms_sent: false,
      sms_skipped_reason: "no_phone",
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows no warning when SMS was skipped because the patient has no carrier on file", async () => {
    await cancelWithNotification({
      email_sent: true,
      email_failed: false,
      sms_attempted: false,
      sms_sent: false,
      sms_skipped_reason: "no_carrier",
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows no warning when both the email and the text were delivered", async () => {
    await cancelWithNotification({
      email_sent: true,
      email_failed: false,
      sms_attempted: true,
      sms_sent: true,
      sms_skipped_reason: null,
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

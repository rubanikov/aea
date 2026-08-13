/**
 * Cancellation with reason and patient notification -- frontend acceptance tests
 * (doctor-cancel-reason-notify feature tickets 01-05).
 *
 * This suite exercises the full USER JOURNEY through the real component surface:
 * - Provider: navigates to their calendar, clicks Cancel, enters a reason, confirms
 * - Patient: receives notification (mocked at the API boundary), sees reason on their appointment
 *
 * The ticket builders have already unit-tested the individual component behaviors
 * (textarea validation, warning rendering, etc.) in AgendaRow.test.tsx and
 * AppointmentCard.test.tsx. This suite's job is to prove the pieces work together
 * as a coherent user experience end-to-end.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  BookingStatusChangeResult,
  ProviderBooking,
  PatientBooking,
} from "@/lib/bookings/types";
import { AgendaRow } from "./AgendaRow";
import { AppointmentCard } from "./AppointmentCard";

const TIMEZONE = "America/Chicago";
const NOW = new Date("2026-08-12T09:00:00.000Z");

// A future appointment that allows cancellation (outside 24h window)
const PROVIDER_BOOKING: ProviderBooking = {
  id: 1,
  patient_id: 101,
  patient_name: "Sam Anderson",
  appointment_type_name: "Follow-up",
  start_time: "2026-08-18T15:00:00.000Z", // Well in future, outside 24h window
  end_time: "2026-08-18T15:15:00.000Z",
  status: "confirmed",
  cancellation_reason: "",
};

const PATIENT_BOOKING: PatientBooking = {
  id: 1,
  provider_id: 10,
  provider_name: "Dr. Smith",
  provider_timezone: "UTC",
  appointment_type_id: 100,
  appointment_type_name: "Follow-up",
  start_time: "2026-08-18T15:00:00.000Z",
  end_time: "2026-08-18T15:15:00.000Z",
  status: "confirmed",
  reminder_sent: false,
  cancellation_reason: "",
};

describe("Cancellation flow acceptance tests", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Provider cancel flow with reason", () => {
    /**
     * TEST: Acceptance criteria 1 & 2 composition
     * Provider clicks Cancel → sees reason textarea → enters reason →
     * confirms → success response includes notification dict with email_sent →
     * reason persists in the response
     */
    it("provider enters reason, cancellation succeeds with notification status in response", async () => {
      const reason = "Emergency procedure; please rebook.";
      const onStatusChange = vi
        .fn()
        .mockResolvedValue({
          booking: {
            ...PROVIDER_BOOKING,
            status: "cancelled",
            cancellation_reason: reason,
          },
          notification: {
            email_sent: true,
            email_failed: false,
            sms_attempted: false,
            sms_sent: false,
            sms_skipped_reason: "no_phone",
          },
        } satisfies BookingStatusChangeResult);

      const user = userEvent.setup();
      render(
        <AgendaRow
          booking={PROVIDER_BOOKING}
          timezone={TIMEZONE}
          onStatusChange={onStatusChange}
        />
      );

      // Click Cancel
      await user.click(
        screen.getByRole("button", { name: /^Cancel:/i })
      );

      // Reason textarea appears
      const textarea = screen.getByLabelText("Reason for cancelling");
      expect(textarea).toBeInTheDocument();

      // Enter the reason
      await user.type(textarea, reason);

      // Confirm button is enabled
      const confirmButton = screen.getByRole("button", { name: "Confirm cancel" });
      expect(confirmButton).toBeEnabled();

      // Click confirm
      await user.click(confirmButton);

      // Verify the callback was called with the reason
      expect(onStatusChange).toHaveBeenCalledWith(
        PROVIDER_BOOKING.id,
        "cancelled",
        reason
      );

      // Wait for the cancel step to close (success case)
      await screen.findByRole("button", { name: /^Cancel:/i });

      // Verify no warnings (email succeeded, no SMS attempted)
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    /**
     * TEST: Acceptance criterion 3 composition
     * Provider cancels → response shows sms_attempted=true, sms_sent=true →
     * no SMS warning appears (because both email and SMS succeeded)
     */
    it("shows no SMS warning when SMS was sent successfully", async () => {
      const reason = "Out sick today";
      const onStatusChange = vi
        .fn()
        .mockResolvedValue({
          booking: {
            ...PROVIDER_BOOKING,
            status: "cancelled",
            cancellation_reason: reason,
          },
          notification: {
            email_sent: true,
            email_failed: false,
            sms_attempted: true,
            sms_sent: true,
            sms_skipped_reason: null,
          },
        } satisfies BookingStatusChangeResult);

      const user = userEvent.setup();
      render(
        <AgendaRow
          booking={PROVIDER_BOOKING}
          timezone={TIMEZONE}
          onStatusChange={onStatusChange}
        />
      );

      await user.click(screen.getByRole("button", { name: /^Cancel:/i }));
      await user.type(screen.getByLabelText("Reason for cancelling"), reason);
      await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

      // Both email and SMS succeeded → no warnings
      await screen.findByRole("button", { name: /^Cancel:/i });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    /**
     * TEST: Acceptance criterion 5
     * Provider cancels → response shows email_failed=true → email warning appears
     */
    it("shows email warning when email send failed", async () => {
      const reason = "Clinic is closed";
      const onStatusChange = vi
        .fn()
        .mockResolvedValue({
          booking: {
            ...PROVIDER_BOOKING,
            status: "cancelled",
            cancellation_reason: reason,
          },
          notification: {
            email_sent: false,
            email_failed: true,
            sms_attempted: false,
            sms_sent: false,
            sms_skipped_reason: "no_phone",
          },
        } satisfies BookingStatusChangeResult);

      const user = userEvent.setup();
      render(
        <AgendaRow
          booking={PROVIDER_BOOKING}
          timezone={TIMEZONE}
          onStatusChange={onStatusChange}
        />
      );

      await user.click(screen.getByRole("button", { name: /^Cancel:/i }));
      await user.type(screen.getByLabelText("Reason for cancelling"), reason);
      await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

      // Email warning appears
      const warning = await screen.findByRole("status");
      expect(warning).toHaveTextContent(
        "Appointment cancelled, but we couldn't reach the patient by email."
      );

      // Only one warning (email only, SMS not attempted)
      expect(screen.getAllByRole("status")).toHaveLength(1);
    });

    /**
     * TEST: Acceptance criterion 6
     * Provider cancels → both email and SMS fail → both warnings appear
     * independently
     */
    it("shows both email and SMS warnings when both fail", async () => {
      const reason = "Emergency procedure";
      const onStatusChange = vi
        .fn()
        .mockResolvedValue({
          booking: {
            ...PROVIDER_BOOKING,
            status: "cancelled",
            cancellation_reason: reason,
          },
          notification: {
            email_sent: false,
            email_failed: true,
            sms_attempted: true,
            sms_sent: false,
            sms_skipped_reason: "send_failed",
          },
        } satisfies BookingStatusChangeResult);

      const user = userEvent.setup();
      render(
        <AgendaRow
          booking={PROVIDER_BOOKING}
          timezone={TIMEZONE}
          onStatusChange={onStatusChange}
        />
      );

      await user.click(screen.getByRole("button", { name: /^Cancel:/i }));
      await user.type(screen.getByLabelText("Reason for cancelling"), reason);
      await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

      // Both warnings appear
      const warnings = await screen.findAllByRole("status");
      expect(warnings).toHaveLength(2);

      expect(screen.getByText(
        /couldn't reach the patient by email/
      )).toBeInTheDocument();
      expect(screen.getByText(
        /couldn't send the text message/
      )).toBeInTheDocument();
    });

    /**
     * TEST: Acceptance criterion 6 (SMS-only failure)
     * Provider cancels → email succeeds but SMS fails → only SMS warning appears
     */
    it("shows only SMS warning when SMS fails but email succeeds", async () => {
      const reason = "Provider is unwell";
      const onStatusChange = vi
        .fn()
        .mockResolvedValue({
          booking: {
            ...PROVIDER_BOOKING,
            status: "cancelled",
            cancellation_reason: reason,
          },
          notification: {
            email_sent: true,
            email_failed: false,
            sms_attempted: true,
            sms_sent: false,
            sms_skipped_reason: "send_failed",
          },
        } satisfies BookingStatusChangeResult);

      const user = userEvent.setup();
      render(
        <AgendaRow
          booking={PROVIDER_BOOKING}
          timezone={TIMEZONE}
          onStatusChange={onStatusChange}
        />
      );

      await user.click(screen.getByRole("button", { name: /^Cancel:/i }));
      await user.type(screen.getByLabelText("Reason for cancelling"), reason);
      await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

      // Only SMS warning appears
      const warnings = await screen.findAllByRole("status");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toHaveTextContent(/couldn't send the text message/);
      expect(screen.queryByText(/couldn't reach the patient by email/)).not.toBeInTheDocument();
    });

    /**
     * TEST: Acceptance criterion 4
     * Provider cancels → SMS is skipped (no_phone or no_carrier) → no warning appears
     */
    it("shows no warning when SMS skipped due to missing phone", async () => {
      const reason = "Need to reschedule";
      const onStatusChange = vi
        .fn()
        .mockResolvedValue({
          booking: {
            ...PROVIDER_BOOKING,
            status: "cancelled",
            cancellation_reason: reason,
          },
          notification: {
            email_sent: true,
            email_failed: false,
            sms_attempted: false,
            sms_sent: false,
            sms_skipped_reason: "no_phone",
          },
        } satisfies BookingStatusChangeResult);

      const user = userEvent.setup();
      render(
        <AgendaRow
          booking={PROVIDER_BOOKING}
          timezone={TIMEZONE}
          onStatusChange={onStatusChange}
        />
      );

      await user.click(screen.getByRole("button", { name: /^Cancel:/i }));
      await user.type(screen.getByLabelText("Reason for cancelling"), reason);
      await user.click(screen.getByRole("button", { name: "Confirm cancel" }));

      // No warnings (silent skip is expected and correct)
      await screen.findByRole("button", { name: /^Cancel:/i });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("Patient view of cancelled appointment with reason", () => {
    /**
     * TEST: Acceptance criteria 7 & 2 composition (patient-facing)
     * Patient views their cancelled appointment → reason is displayed
     * in the appointment card
     */
    it("patient sees cancellation reason on their cancelled appointment card", () => {
      const reason = "Emergency procedure; please rebook.";
      const cancelledBooking: PatientBooking = {
        ...PATIENT_BOOKING,
        status: "cancelled",
        cancellation_reason: reason,
      };

      render(
        <AppointmentCard
          booking={cancelledBooking}
          timezone={TIMEZONE}
          onCancel={vi.fn()}
          onRescheduled={vi.fn()}
          now={NOW}
        />
      );

      // Status badge shows "CANCELLED"
      expect(screen.getByText("CANCELLED")).toBeInTheDocument();

      // Reason is visible
      expect(
        screen.getByText(`Cancelled — reason: ${reason}`)
      ).toBeInTheDocument();
    });

    /**
     * TEST: Acceptance criterion 9 composition (patient-facing)
     * Patient self-cancelled their own appointment → no reason text appears
     * (self-cancellation never has a reason)
     */
    it("patient self-cancelled appointment shows no reason", () => {
      const cancelledBooking: PatientBooking = {
        ...PATIENT_BOOKING,
        status: "cancelled",
        cancellation_reason: "", // No reason for self-cancel
      };

      render(
        <AppointmentCard
          booking={cancelledBooking}
          timezone={TIMEZONE}
          onCancel={vi.fn()}
          onRescheduled={vi.fn()}
          now={NOW}
        />
      );

      // Status shows CANCELLED but without a reason line
      expect(screen.getByText("CANCELLED")).toBeInTheDocument();
      expect(screen.queryByText(/Cancelled — reason:/)).not.toBeInTheDocument();
    });

    /**
     * TEST: Edge case from criterion 7
     * Multi-line cancellation reason preserves line breaks
     */
    it("cancellation reason with line breaks displays correctly", () => {
      const multiLineReason = "Office flooded.\nFront desk will call to rebook.";
      const cancelledBooking: PatientBooking = {
        ...PATIENT_BOOKING,
        status: "cancelled",
        cancellation_reason: multiLineReason,
      };

      render(
        <AppointmentCard
          booking={cancelledBooking}
          timezone={TIMEZONE}
          onCancel={vi.fn()}
          onRescheduled={vi.fn()}
          now={NOW}
        />
      );

      const reasonLine = screen.getByText(/Cancelled — reason:/);
      // Line breaks are preserved in the text content
      expect(reasonLine.textContent).toContain("Office flooded.");
      expect(reasonLine.textContent).toContain("Front desk will call to rebook.");
      // CSS class ensures line breaks are rendered visually
      expect(reasonLine).toHaveClass("whitespace-pre-wrap");
    });
  });

  describe("Cancellation reason validation and constraints", () => {
    /**
     * TEST: Acceptance criterion 1 (client-side validation)
     * Provider clicks Cancel → reason textarea requires non-empty, non-whitespace input
     */
    it("confirm button disabled while reason is empty or whitespace-only", async () => {
      const onStatusChange = vi.fn().mockResolvedValue({
        booking: { ...PROVIDER_BOOKING, status: "cancelled" },
      });

      const user = userEvent.setup();
      render(
        <AgendaRow
          booking={PROVIDER_BOOKING}
          timezone={TIMEZONE}
          onStatusChange={onStatusChange}
        />
      );

      // Open cancel confirm step
      await user.click(screen.getByRole("button", { name: /^Cancel:/i }));

      const confirmButton = screen.getByRole("button", { name: "Confirm cancel" });
      const textarea = screen.getByLabelText("Reason for cancelling");

      // Initially disabled (empty)
      expect(confirmButton).toBeDisabled();

      // Whitespace-only is still disabled
      await user.type(textarea, "   ");
      expect(confirmButton).toBeDisabled();

      // Non-empty enables it
      await user.clear(textarea);
      await user.type(textarea, "Rescheduling");
      expect(confirmButton).toBeEnabled();
    });

    /**
     * TEST: Acceptance criterion 1 (character limit & counter)
     * Reason textarea enforces 500-char max, shows character count
     */
    it("reason textarea enforces 500-char limit and shows character count", async () => {
      const onStatusChange = vi.fn().mockResolvedValue({
        booking: { ...PROVIDER_BOOKING, status: "cancelled" },
      });

      const user = userEvent.setup();
      render(
        <AgendaRow
          booking={PROVIDER_BOOKING}
          timezone={TIMEZONE}
          onStatusChange={onStatusChange}
        />
      );

      await user.click(screen.getByRole("button", { name: /^Cancel:/i }));

      const textarea = screen.getByLabelText("Reason for cancelling") as HTMLTextAreaElement;

      // Textarea has maxlength attribute enforcing the 500-char limit server-side
      expect(textarea).toHaveAttribute("maxlength", "500");

      // Character counter shows initial state
      expect(screen.getByText("500 characters left")).toBeInTheDocument();

      // Typing updates the character counter
      await user.type(textarea, "Clinic closed today");
      expect(screen.getByText("481 characters left")).toBeInTheDocument();
    });
  });
});

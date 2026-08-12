"use client";

/**
 * The post-cancel delivery warnings, shared verbatim between `AgendaRow`
 * and `AppointmentDetailPopover`. Each is `role="status"` (deliberately
 * not `role="alert"`: the cancellation itself succeeded, this is
 * informational). Email and SMS lines are independent — 0, 1, or 2
 * render depending on what actually failed; the expected
 * no-phone/no-carrier skip case shows neither (see
 * `useBookingStatusActions`).
 */
export function NotificationWarnings({
  emailNotDelivered,
  smsNotDelivered,
}: {
  emailNotDelivered: boolean;
  smsNotDelivered: boolean;
}) {
  return (
    <>
      {emailNotDelivered ? (
        <p role="status" className="text-sm text-warning-text">
          Appointment cancelled, but we couldn&apos;t reach the patient by email.
          Please call them.
        </p>
      ) : null}

      {smsNotDelivered ? (
        <p role="status" className="text-sm text-warning-text">
          Appointment cancelled, but we couldn&apos;t send the text message. Please
          call the patient.
        </p>
      ) : null}
    </>
  );
}

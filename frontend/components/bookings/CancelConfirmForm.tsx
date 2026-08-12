"use client";

import { CANCELLATION_REASON_MAX_LENGTH } from "@/hooks/use-booking-status-actions";

interface CancelConfirmFormProps {
  /** Prefixes the form's element ids so the agenda row and the grid
   * popover never mint colliding ids for the same booking. */
  idPrefix: string;
  /** e.g. "Follow-up with S. Patel at 10:00–10:15am" — the confirm
   * prompt's subject line. */
  confirmContext: string;
  cancelReason: string;
  onCancelReasonChange: (value: string) => void;
  cancelReasonError: string | null;
  /** True while any status action is in flight (all controls disable). */
  busy: boolean;
  /** True while the cancel itself is in flight (drives "Cancelling…"). */
  cancelling: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

/**
 * The reason-required cancel confirm step, shared verbatim between
 * `AgendaRow` (narrow-screen fallback) and `AppointmentDetailPopover`
 * (week grid): prompt, required reason textarea (maxLength 500) with help
 * text and live character count, inline field error, and Confirm
 * cancel / Never mind. "Confirm cancel" stays disabled while the reason
 * is empty or whitespace-only. State lives in
 * `useBookingStatusActions`; this is the one rendering of it.
 */
export function CancelConfirmForm({
  idPrefix,
  confirmContext,
  cancelReason,
  onCancelReasonChange,
  cancelReasonError,
  busy,
  cancelling,
  onConfirm,
  onDismiss,
}: CancelConfirmFormProps) {
  const inputId = `${idPrefix}-cancel-reason`;
  const helpId = `${idPrefix}-cancel-reason-help`;
  const errorId = `${idPrefix}-cancel-reason-error`;
  const charactersLeft = CANCELLATION_REASON_MAX_LENGTH - cancelReason.length;

  return (
    <div className="flex flex-col gap-2 pt-1">
      <p className="text-sm">
        Cancel {confirmContext}? This can&apos;t be undone.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          Reason for cancelling
        </label>
        <textarea
          id={inputId}
          value={cancelReason}
          onChange={(event) => onCancelReasonChange(event.target.value)}
          required
          maxLength={CANCELLATION_REASON_MAX_LENGTH}
          rows={3}
          disabled={busy}
          aria-describedby={cancelReasonError ? `${helpId} ${errorId}` : helpId}
          aria-invalid={cancelReasonError ? true : undefined}
          className="rounded border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-50"
        />
        <p id={helpId} className="text-xs text-muted-foreground">
          The patient will be told the appointment was cancelled and given this
          reason. Keep it brief — it may be sent by text message.
        </p>
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {charactersLeft} characters left
        </p>
        {cancelReasonError ? (
          <p id={errorId} role="alert" className="text-sm text-danger-text">
            {cancelReasonError}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || cancelReason.trim() === ""}
          className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-danger-foreground hover:opacity-90 disabled:opacity-50"
        >
          {cancelling ? "Cancelling…" : "Confirm cancel"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          Never mind
        </button>
      </div>
    </div>
  );
}

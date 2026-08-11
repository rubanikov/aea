"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PasswordField } from "@/components/forms/PasswordField";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { isFieldErrorBody, splitFieldErrors } from "@/lib/api/field-errors";
import { loginPathWithAccountDeleted } from "@/lib/auth/account-deleted";
import { validateDeleteAccount } from "@/lib/auth/validation";

const KNOWN_SERVER_FIELDS = new Set(["password"]);

type Mode = "idle" | "confirming";

/**
 * "Danger zone" card: request account & data deletion.
 *
 * Calls `POST /profile/delete-account` with `{password}`, matching
 * `backend/accounts/views.py`'s `DeleteAccountView` and
 * `backend/accounts/serializers.py`'s `DeleteAccountSerializer`. Success
 * is `200` with `{cancelled_appointments_count: number}`, and ends the
 * session server-side the same way `LogoutView` does (blacklist the
 * refresh token, clear both auth cookies on the response). Wrong-password
 * is `400` with `{"password": ["Incorrect password."]}`.
 *
 * Regardless of what the server does with cookies, this component doesn't
 * rely on being able to read or clear an httpOnly cookie itself (it can't).
 * On success it drives the same client-side "end the session" sequence
 * `UserBadge`'s logout uses, `router.push` then `router.refresh()`, so the
 * visit actually ends here even if the cookie-clearing assumption above
 * turns out to be wrong. The confirmation message survives the redirect via
 * a `/login?account_deleted=1` query param, the same handoff mechanism
 * `lib/auth/session-expired.ts` already uses for "your session expired".
 */
export function DeleteAccountSection() {
  const router = useRouter();
  const authFetch = useAuthenticatedRequest();
  const [mode, setMode] = useState<Mode>("idle");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  function startConfirm() {
    setPassword("");
    setPasswordError(undefined);
    setFormError(null);
    setMode("confirming");
  }

  function cancelConfirm() {
    setMode("idle");
    setPassword("");
    setPasswordError(undefined);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors = validateDeleteAccount({ currentPassword: password });
    if (errors.currentPassword) {
      setPasswordError(errors.currentPassword);
      return;
    }

    setPasswordError(undefined);
    setSubmitting(true);
    try {
      await authFetch("/profile/delete-account", {
        method: "POST",
        body: { password },
      });
      setDeleted(true);
      router.push(loginPathWithAccountDeleted());
      router.refresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        isFieldErrorBody(error.body)
      ) {
        const { fieldErrors, formError: serverFormError } = splitFieldErrors(
          error.body,
          KNOWN_SERVER_FIELDS
        );
        setPasswordError(fieldErrors.password);
        setFormError(serverFormError);
      } else if (!(error instanceof ApiError && error.status === 401)) {
        setFormError("Couldn't delete your account — please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (deleted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-800"
      >
        Your account has been deleted. You&apos;ve been logged out.
      </div>
    );
  }

  return (
    <div className="rounded border border-red-300 bg-red-50 p-4">
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="text-lg leading-none text-red-700">
          {"⚠"}
        </span>
        <h3 className="font-semibold text-red-900">
          Request account & data deletion
        </h3>
      </div>
      <p className="mt-2 text-sm text-red-800">
        Deletes your profile and appointment history per our retention
        policy. Upcoming appointments are cancelled first. Not undoable once
        processed.
      </p>

      {mode === "idle" ? (
        <button
          type="button"
          onClick={startConfirm}
          className="mt-3 rounded border border-red-600 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          Request deletion
        </button>
      ) : (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-4 flex flex-col gap-3 border-t border-red-200 pt-4"
        >
          <p className="text-sm text-red-900">
            Any upcoming appointments will be cancelled automatically as part
            of this request. Enter your current password to confirm — this
            can&apos;t be undone once processed.
          </p>
          <PasswordField
            label="Current password"
            id="delete-account-password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (passwordError) {
                setPasswordError(undefined);
              }
            }}
            error={passwordError}
          />
          {formError ? (
            <p role="alert" className="text-sm text-red-700">
              {formError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? "Deleting…" : "Confirm deletion request"}
            </button>
            <button
              type="button"
              onClick={cancelConfirm}
              disabled={submitting}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

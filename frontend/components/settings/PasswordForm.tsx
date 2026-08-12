"use client";

import { useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/components/forms/PasswordField";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { isFieldErrorBody, splitFieldErrors } from "@/lib/api/field-errors";
import { validatePasswordChange, type FieldErrors } from "@/lib/auth/validation";

const FIELD_ORDER = [
  "currentPassword",
  "newPassword",
  "confirmNewPassword",
] as const;
const KNOWN_SERVER_FIELDS = new Set(["current_password", "new_password"]);

/**
 * Password-update section of account settings. `POST /profile/password`
 * with `{current_password, new_password}` per the API contract.
 */
export function PasswordForm() {
  const authFetch = useAuthenticatedRequest();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmNewPasswordRef = useRef<HTMLInputElement>(null);
  const fieldRefs = {
    currentPassword: currentPasswordRef,
    newPassword: newPasswordRef,
    confirmNewPassword: confirmNewPasswordRef,
  };

  function focusFirstInvalid(errors: FieldErrors) {
    for (const name of FIELD_ORDER) {
      if (errors[name]) {
        fieldRefs[name].current?.focus();
        return;
      }
    }
  }

  function clearCurrentPasswordError() {
    if (fieldErrors.currentPassword) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next.currentPassword;
        return next;
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    const errors = validatePasswordChange({
      currentPassword,
      newPassword,
      confirmNewPassword,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      focusFirstInvalid(errors);
      return;
    }

    setFieldErrors({});
    setSaving(true);
    try {
      await authFetch("/profile/password", {
        method: "POST",
        body: {
          current_password: currentPassword,
          new_password: newPassword,
        },
      });
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        isFieldErrorBody(error.body)
      ) {
        const { fieldErrors: serverFieldErrors, formError: serverFormError } =
          splitFieldErrors(error.body, KNOWN_SERVER_FIELDS);
        const mapped: FieldErrors = {};
        if (serverFieldErrors.current_password) {
          mapped.currentPassword = serverFieldErrors.current_password;
        }
        if (serverFieldErrors.new_password) {
          mapped.newPassword = serverFieldErrors.new_password;
        }
        setFieldErrors(mapped);
        setFormError(serverFormError);
        focusFirstInvalid(mapped);
      } else if (!(error instanceof ApiError && error.status === 401)) {
        setFormError("Couldn't update your password — please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <PasswordField
        label="Current password"
        id="password-current"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => {
          setCurrentPassword(event.target.value);
          clearCurrentPasswordError();
        }}
        error={fieldErrors.currentPassword}
        inputRef={currentPasswordRef}
      />
      <PasswordField
        label="New password"
        id="password-new"
        autoComplete="new-password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        error={fieldErrors.newPassword}
        inputRef={newPasswordRef}
      />
      <PasswordField
        label="Confirm new password"
        id="password-confirm"
        autoComplete="new-password"
        value={confirmNewPassword}
        onChange={(event) => setConfirmNewPassword(event.target.value)}
        error={fieldErrors.confirmNewPassword}
        inputRef={confirmNewPasswordRef}
      />
      {formError ? (
        <p role="alert" className="text-sm text-danger-text">
          {formError}
        </p>
      ) : null}
      {saved ? (
        <p role="status" aria-live="polite" className="text-sm text-success-text">
          Password updated.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="self-start rounded bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {saving ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

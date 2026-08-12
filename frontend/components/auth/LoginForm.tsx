"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TextField } from "@/components/forms/TextField";
import { PasswordField } from "@/components/forms/PasswordField";
import { ApiError } from "@/lib/api/client";
import { isFieldErrorBody, splitFieldErrors } from "@/lib/api/field-errors";
import { loginWithCredentials, redirectToRoleHome } from "@/lib/auth/login-flow";
import { validateLogin, type FieldErrors } from "@/lib/auth/validation";

const NO_KNOWN_FIELDS = new Set<string>();

/** Login has no per-field server errors; every message the API sends back
 * (bad credentials, "non_field_errors", ...) is a single form-level message. */
function loginErrorMessage(body: unknown): string | null {
  return isFieldErrorBody(body)
    ? splitFieldErrors(body, NO_KNOWN_FIELDS).formError
    : null;
}

const FIELD_ORDER = ["email", "password"] as const;

interface LoginFormProps {
  /** Pre-fills the email field, e.g. after switching over from registration. */
  initialEmail?: string;
}

export function LoginForm({ initialEmail = "" }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fieldRefs = { email: emailRef, password: passwordRef };

  function focusFirstInvalid(errors: FieldErrors) {
    for (const name of FIELD_ORDER) {
      if (errors[name]) {
        fieldRefs[name].current?.focus();
        return;
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors = validateLogin({ email, password });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      focusFirstInvalid(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await loginWithCredentials(email, password);
      await redirectToRoleHome(router);
    } catch (error) {
      // Bad credentials: the API's contract says 401, but a bare
      // DRF `serializer.is_valid(raise_exception=True)` failure, which is
      // how "wrong email/password" naturally surfaces, is a 400. Treat
      // both as the same user-facing case rather than betting on one.
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 400)
      ) {
        setFormError(loginErrorMessage(error.body) ?? "Invalid email or password.");
        emailRef.current?.focus();
      } else if (error instanceof ApiError && error.status === 429) {
        setFormError(
          "Too many attempts — please wait a moment and try again."
        );
      } else {
        setFormError("Something went wrong — please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <TextField
        label="Email"
        id="login-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
        inputRef={emailRef}
      />
      <PasswordField
        label="Password"
        id="login-password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
        inputRef={passwordRef}
      />
      {formError ? (
        <p role="alert" className="text-sm text-danger-text">
          {formError}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}

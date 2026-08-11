"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TextField } from "@/components/forms/TextField";
import { PasswordField } from "@/components/forms/PasswordField";
import { ApiError, apiJson } from "@/lib/api/client";
import { isFieldErrorBody, splitFieldErrors } from "@/lib/api/field-errors";
import { loginWithCredentials, redirectToRoleHome } from "@/lib/auth/login-flow";
import { validateRegister, type FieldErrors } from "@/lib/auth/validation";

const FIELD_ORDER = ["name", "email", "password", "confirmPassword"] as const;
const KNOWN_SERVER_FIELDS = new Set(["name", "email", "password"]);

interface RegisterFormProps {
  /**
   * Registration succeeded but the immediate follow-up login attempt
   * failed -- the parent should switch to the login tab, pre-filled with
   * this email, rather than leaving the visitor stuck.
   */
  onRegisteredButLoginFailed?: (email: string) => void;
}

export function RegisterForm({
  onRegisteredButLoginFailed,
}: RegisterFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const fieldRefs = {
    name: nameRef,
    email: emailRef,
    password: passwordRef,
    confirmPassword: confirmPasswordRef,
  };

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

    const errors = validateRegister({
      name,
      email,
      password,
      confirmPassword,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      focusFirstInvalid(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    try {
      await apiJson("/auth/register", {
        method: "POST",
        body: { email, password, name },
      });
    } catch (error) {
      setSubmitting(false);
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        isFieldErrorBody(error.body)
      ) {
        const { fieldErrors: serverFieldErrors, formError: serverFormError } =
          splitFieldErrors(error.body, KNOWN_SERVER_FIELDS);
        setFieldErrors(serverFieldErrors);
        setFormError(serverFormError);
        focusFirstInvalid(serverFieldErrors);
      } else {
        setFormError("Something went wrong — please try again.");
      }
      return;
    }

    try {
      await loginWithCredentials(email, password);
      await redirectToRoleHome(router);
    } catch {
      setSubmitting(false);
      onRegisteredButLoginFailed?.(email);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <TextField
        label="Name"
        id="register-name"
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={fieldErrors.name}
        inputRef={nameRef}
      />
      <TextField
        label="Email"
        id="register-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
        inputRef={emailRef}
      />
      <PasswordField
        label="Password"
        id="register-password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
        inputRef={passwordRef}
      />
      <PasswordField
        label="Confirm password"
        id="register-confirm-password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={fieldErrors.confirmPassword}
        inputRef={confirmPasswordRef}
      />
      {formError ? (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { readSessionExpiredMessage } from "@/lib/auth/session-expired";
import { readAccountDeletedMessage } from "@/lib/auth/account-deleted";

type Mode = "login" | "register";

/**
 * Tabbed register/login screen. Reads the `session_expired` query param
 * (set by `hooks/use-current-user.ts` / `hooks/use-authenticated-request.ts`
 * when an authenticated fetch 401s elsewhere in the app) and the
 * `account_deleted` param (set by `DeleteAccountSection` after a successful
 * deletion request, TICKET-14) and surfaces either as a clear message above
 * the forms.
 */
export function AuthPageClient() {
  const searchParams = useSearchParams();
  const sessionExpiredMessage = readSessionExpiredMessage(searchParams);
  const accountDeletedMessage = readAccountDeletedMessage(searchParams);

  const [mode, setMode] = useState<Mode>("login");
  const [prefillEmail, setPrefillEmail] = useState("");

  function switchToLogin(email: string) {
    setPrefillEmail(email);
    setMode("login");
  }

  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "login" ? "Log in" : "Create your account"}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Patient, provider, and admin accounts all sign in here.
        </p>
      </div>

      {sessionExpiredMessage ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {sessionExpiredMessage}
        </p>
      ) : null}

      {accountDeletedMessage ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800"
        >
          {accountDeletedMessage}
        </p>
      ) : null}

      <div
        role="group"
        aria-label="Choose account action"
        className="flex gap-2 rounded border border-gray-300 p-1 text-sm"
      >
        <button
          type="button"
          aria-pressed={mode === "login"}
          onClick={() => setMode("login")}
          className={`flex-1 rounded px-3 py-1.5 font-medium ${
            mode === "login" ? "bg-black text-white" : "hover:bg-gray-50"
          }`}
        >
          Log in
        </button>
        <button
          type="button"
          aria-pressed={mode === "register"}
          onClick={() => setMode("register")}
          className={`flex-1 rounded px-3 py-1.5 font-medium ${
            mode === "register" ? "bg-black text-white" : "hover:bg-gray-50"
          }`}
        >
          Sign up
        </button>
      </div>

      {mode === "login" ? (
        <LoginForm initialEmail={prefillEmail} />
      ) : (
        <RegisterForm onRegisteredButLoginFailed={switchToLogin} />
      )}

      <Link href="/" className="text-sm underline">
        Back home
      </Link>
    </div>
  );
}

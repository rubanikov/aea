"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { TextField } from "@/components/forms/TextField";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { isFieldErrorBody, splitFieldErrors } from "@/lib/api/field-errors";
import { timezoneOptions } from "@/lib/timezones";
import type { FieldErrors } from "@/lib/auth/validation";

export interface Profile {
  name: string;
  email: string;
  phone: string;
  timezone: string;
}

const FIELD_ORDER = ["name", "email", "phone", "timezone"] as const;
const KNOWN_PROFILE_FIELDS = new Set(FIELD_ORDER);

/**
 * Profile view/edit section of account settings: name, email, phone,
 * timezone. Loads via `GET /profile`, saves via `PATCH /profile`.
 */
export function ProfileForm() {
  const authFetch = useAuthenticatedRequest();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const timezoneRef = useRef<HTMLSelectElement>(null);
  const fieldRefs = {
    name: nameRef,
    email: emailRef,
    phone: phoneRef,
    timezone: timezoneRef,
  };

  useEffect(() => {
    let cancelled = false;

    authFetch<Profile>("/profile")
      .then((result) => {
        if (!cancelled) {
          setProfile(result);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        // A 401 already triggers a redirect inside useAuthenticatedRequest.
        if (!(error instanceof ApiError && error.status === 401)) {
          setLoadError("Couldn't load your profile — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  function focusFirstInvalid(errors: FieldErrors) {
    for (const name of FIELD_ORDER) {
      if (errors[name]) {
        fieldRefs[name].current?.focus();
        return;
      }
    }
  }

  function updateField<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => (current ? { ...current, [key]: value } : current));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) {
      return;
    }

    setFormError(null);
    setFieldErrors({});
    setSaved(false);
    setSaving(true);

    try {
      const updated = await authFetch<Profile>("/profile", {
        method: "PATCH",
        body: profile,
      });
      setProfile(updated);
      setSaved(true);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        isFieldErrorBody(error.body)
      ) {
        const { fieldErrors: serverFieldErrors, formError: serverFormError } =
          splitFieldErrors(error.body, KNOWN_PROFILE_FIELDS);
        setFieldErrors(serverFieldErrors);
        setFormError(serverFormError);
        focusFirstInvalid(serverFieldErrors);
      } else if (!(error instanceof ApiError && error.status === 401)) {
        setFormError("Couldn't save your changes — please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {loadError}
      </p>
    );
  }

  if (!profile) {
    return <p className="text-sm text-gray-600">Loading your profile…</p>;
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <TextField
        label="Name"
        id="profile-name"
        autoComplete="name"
        value={profile.name}
        onChange={(event) => updateField("name", event.target.value)}
        error={fieldErrors.name}
        inputRef={nameRef}
      />
      <TextField
        label="Email"
        id="profile-email"
        type="email"
        autoComplete="email"
        value={profile.email}
        onChange={(event) => updateField("email", event.target.value)}
        error={fieldErrors.email}
        inputRef={emailRef}
      />
      <TextField
        label="Phone"
        id="profile-phone"
        type="tel"
        autoComplete="tel"
        value={profile.phone}
        onChange={(event) => updateField("phone", event.target.value)}
        error={fieldErrors.phone}
        inputRef={phoneRef}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="profile-timezone" className="text-sm font-medium">
          Timezone
        </label>
        <select
          id="profile-timezone"
          ref={timezoneRef}
          value={profile.timezone}
          onChange={(event) => updateField("timezone", event.target.value)}
          aria-invalid={fieldErrors.timezone ? true : undefined}
          aria-describedby={
            fieldErrors.timezone ? "profile-timezone-error" : undefined
          }
          className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
        >
          {timezoneOptions(profile.timezone).map((timezone) => (
            <option key={timezone} value={timezone}>
              {timezone}
            </option>
          ))}
        </select>
        {fieldErrors.timezone ? (
          <p
            id="profile-timezone-error"
            role="alert"
            className="text-sm text-red-600"
          >
            {fieldErrors.timezone}
          </p>
        ) : null}
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      ) : null}
      {saved ? (
        <p role="status" aria-live="polite" className="text-sm text-green-700">
          Profile updated.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="self-start rounded bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

"use client";

import { useState, type InputHTMLAttributes, type Ref } from "react";

interface PasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  id: string;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Password input with a real show/hide toggle button (`aria-pressed`, and
 * an `aria-label` that includes the field's label so multiple password
 * fields on one form -- e.g. "New password" / "Confirm password" -- get
 * distinct accessible names).
 */
export function PasswordField({
  label,
  id,
  error,
  inputRef,
  ...inputProps
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          ref={inputRef}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
          {...inputProps}
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={() => setVisible((value) => !value)}
          className="shrink-0 rounded border border-gray-300 px-2 py-2 text-xs font-medium hover:bg-gray-50"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

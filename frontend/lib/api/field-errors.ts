/**
 * A single field's error message(s) as the API may send it: a bare string
 * (the ticket's documented example, e.g. `{"email": "already registered"}`)
 * or a list of strings (Django REST Framework's own default validation
 * error shape, e.g. `{"email": ["An account with this email already
 * exists."]}`). Both are accepted and normalized to one display string.
 */
export type FieldErrorValue = string | string[];
export type FieldErrorBody = Record<string, FieldErrorValue>;

function isFieldErrorValue(value: unknown): value is FieldErrorValue {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

/** Type guard for the API's field-level error shape. */
export function isFieldErrorBody(body: unknown): body is FieldErrorBody {
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    Object.values(body as Record<string, unknown>).every(isFieldErrorValue)
  );
}

export function normalizeFieldMessage(value: FieldErrorValue): string {
  return Array.isArray(value) ? value.join(" ") : value;
}

/**
 * Splits a field-error body into errors that map onto a field this form
 * actually renders vs. everything else (e.g. DRF's `non_field_errors`),
 * which becomes a single joined form-level message rather than being
 * silently dropped. Pass an empty `knownFields` set to treat every message
 * as form-level (e.g. login, which has no per-field server errors).
 */
export function splitFieldErrors(
  body: FieldErrorBody,
  knownFields: ReadonlySet<string>
): { fieldErrors: Record<string, string>; formError: string | null } {
  const fieldErrors: Record<string, string> = {};
  const unmatched: string[] = [];

  for (const [key, rawMessage] of Object.entries(body)) {
    const message = normalizeFieldMessage(rawMessage);
    if (knownFields.has(key)) {
      fieldErrors[key] = message;
    } else {
      unmatched.push(message);
    }
  }

  return {
    fieldErrors,
    formError: unmatched.length ? unmatched.join(" ") : null,
  };
}

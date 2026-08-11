/**
 * Carries the "your account was deleted" confirmation across the redirect to
 * `/login` triggered by a successful account-deletion request (see
 * `components/settings/DeleteAccountSection.tsx`). Mirrors
 * `lib/auth/session-expired.ts`'s query-param handoff: the deletion
 * response ends the session server-side (same as logout), so the message
 * has to survive the navigation away from `/settings` some other way
 * than component state.
 */
export const ACCOUNT_DELETED_PARAM = "account_deleted";

export const ACCOUNT_DELETED_MESSAGE =
  "Your account has been deleted. You've been logged out.";

export function loginPathWithAccountDeleted(): string {
  return `/login?${ACCOUNT_DELETED_PARAM}=1`;
}

export function readAccountDeletedMessage(
  searchParams: URLSearchParams
): string | null {
  return searchParams.get(ACCOUNT_DELETED_PARAM) === "1"
    ? ACCOUNT_DELETED_MESSAGE
    : null;
}

# Patient Data Retention & Deletion Policy

This feeds the project README's PHI/retention section (see `project.md`'s
"Data minimization & retention/deletion" requirement). Every claim below
names the code that implements it.

## What PHI is collected

- **Identity** (`accounts.User`): name, email, phone, and the patient's
  chosen SMS carrier (`sms_carrier`, only meaningful together with `phone`).
- **Appointments** (`bookings.Booking`): booking time, provider,
  appointment type, status history, and — for provider-cancelled bookings —
  the provider's free-text `cancellation_reason` (see `architecture.md` §7a
  for why that text is treated as PHI and where it is sent).
- **Intake/insurance fields**, if the stretch feature (project.md #11) is
  built: treated as PHI the same as the above. Not built today.

Timezone is stored alongside identity but is not itself PHI.

## Retention

Active account and appointment data is retained **until the patient
requests deletion, or for 7 years after the account's last activity,
whichever comes first**. 7 years is the stated default because it sits
within the range most US state medical-record retention statutes require
for adult patients (commonly 5-10 years), a reasonable ceiling to design
around even though this project doesn't claim HIPAA-covered-entity status.

There is currently **no automated purge job** for accounts that cross the
7-year inactivity mark; today, deletion is patient-initiated only (see
below). An inactivity-driven purge is a documented gap, not a silent one:
a natural extension point is a scheduled task that finds accounts past the
window and runs the same scrub flow described here.

## What "deletion" actually does

A patient requests deletion via `POST /profile/delete-account`
(`accounts.views.DeleteAccountView`), re-submitting their current password
as server-side proof of intent: a client-side confirmation modal alone is
not trusted as the record of consent.

Deletion **scrubs the account row in place; it never hard-deletes it**:

- `name`, `phone` and `sms_carrier` are cleared.
- `email` is replaced with a non-reversible, unique placeholder
  (`deleted-user-<id>@deleted.invalid`).
- The password is set unusable (`set_unusable_password`), which blocks any
  future login, and `is_active` is set to `False`, which SimpleJWT's
  `get_user()` (inherited by `accounts.authentication.CookieJWTAuthentication`)
  re-checks on every authenticated request — so a token issued before the
  scrub is rejected the moment it is next presented, without waiting for it
  to expire.
- `deleted_at` is stamped, making "this account was scrubbed" itself a
  queryable, auditable fact. It is a tombstone, not an enforcement gate —
  `is_active` is what actually locks the account out.

The row is preserved specifically so `AuditLog.actor` (a foreign key)
never has to fall back to `SET_NULL`: every past audit entry keeps
resolving, by id, to a real row. That row just no longer holds identifying
data. Hard-deleting the user would either orphan that history or require
retroactively scrubbing every audit entry that referenced it; scrubbing
the row once, up front, avoids both.

Any upcoming appointments are cancelled as part of the same request:
`accounts.services._cancel_upcoming_appointments` (called from
`accounts.services.delete_account`, which runs the whole request in one
transaction) finds every active
(`requested`/`confirmed`) booking still in the future for that patient and
moves each to `cancelled` through `bookings.transitions.transition()`, the
same single write path every other status change in the app goes through,
so each cancellation is audited identically to a patient-initiated one.
This one call site deliberately bypasses the ordinary 24-hour
minimum-notice window (`transition(..., enforce_notice=False)`): the
patient has already said "delete everything," so declining to cancel a
same-day appointment on their behalf would contradict, not protect, their
stated intent. The endpoint's `cancelled_appointments_count` response field
reports the real number of bookings freed, not a placeholder.

## Audit trail

Audit log entries (`audit.AuditLog`) are **never deleted or scrubbed**:
the log is append-only by design (see `audit/models.py`). They persist
indefinitely in de-identified form (once their actor's account has been
scrubbed) for compliance and security-review purposes. The deletion
request itself is audited
(`action="account:deletion_requested", target_type="user", target_id=<id>`)
*before* the scrub runs, so the record of "this account was deleted, by
whom, when" survives the deletion it describes.

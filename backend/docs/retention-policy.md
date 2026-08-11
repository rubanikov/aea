# Patient Data Retention & Deletion Policy

Starting a `backend/docs/` convention here — no prior doc lived under `backend/`
before this ticket. This feeds the project README's PHI/retention section
(see `project.md`'s "Data minimization & retention/deletion" requirement).

## What PHI is collected

- **Identity** (`accounts.User`): name, email, phone.
- **Appointments** (`scheduling`, from TICKET-07 onward): booking time,
  provider, appointment type, and status history.
- **Intake/insurance fields**, if the stretch feature (project.md #11) is
  built — treated as PHI the same as the above.

Timezone is stored alongside identity but is not itself PHI.

## Retention

Active account and appointment data is retained **until the patient
requests deletion, or for 7 years after the account's last activity,
whichever comes first**. 7 years is the stated default because it sits
within the range most US state medical-record retention statutes require
for adult patients (commonly 5–10 years) — a reasonable ceiling to design
around even though this project doesn't claim HIPAA-covered-entity status.

There is currently **no automated purge job** for accounts that cross the
7-year inactivity mark; today, deletion is patient-initiated only (see
below). An inactivity-driven purge is a documented gap, not a silent one —
a natural extension point is a scheduled task that finds accounts past the
window and runs the same scrub flow described here.

## What "deletion" actually does

A patient requests deletion via `POST /profile/delete-account`
(`accounts.views.DeleteAccountView`), re-submitting their current password
as server-side proof of intent — a client-side confirmation modal alone is
not trusted as the record of consent.

Deletion **scrubs the account row in place; it never hard-deletes it**:

- `name` and `phone` are cleared.
- `email` is replaced with a non-reversible, unique placeholder
  (`deleted-user-<id>@deleted.invalid`).
- The password is set unusable (`set_unusable_password`) and `is_active`
  is set to `False` — both are checked independently on every
  authenticated request (see `accounts/authentication.py`), so a scrubbed
  account can never log in or use a token issued before the scrub, even if
  one somehow survived.
- `deleted_at` is stamped, making "this account was scrubbed" itself a
  queryable, auditable fact.

The row is preserved specifically so `AuditLog.actor` — a foreign key —
never has to fall back to `SET_NULL`: every past audit entry keeps
resolving, by id, to a real row. That row just no longer holds identifying
data. Hard-deleting the user would either orphan that history or require
retroactively scrubbing every audit entry that referenced it; scrubbing
the row once, up front, avoids both.

Any upcoming appointments are cancelled as part of the same request. The
`Booking` model doesn't exist yet (TICKET-07), so this is currently a
documented no-op (`accounts.serializers._cancel_upcoming_appointments`) —
the endpoint's response already includes `cancelled_appointments_count` so
wiring in real cancellation later needs no API contract change.

## Audit trail

Audit log entries (`audit.AuditLog`) are **never deleted or scrubbed** —
the log is append-only by design (see `audit/models.py`). They persist
indefinitely in de-identified form (once their actor's account has been
scrubbed) for compliance and security-review purposes. The deletion
request itself is audited
(`action="account:deletion_requested", target_type="user", target_id=<id>`)
*before* the scrub runs, so the record of "this account was deleted, by
whom, when" survives the deletion it describes.

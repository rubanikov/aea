# TICKET-14 — Patient Data Retention & Account Deletion

**Blockers:** TICKET-02, TICKET-03
**Scope:** Both
**Size:** Right-sized (small, but a real DB→backend→frontend slice — a Core compliance requirement, not stretch)

## Build
- Deletion-request endpoint that scrubs/anonymizes patient PHI fields while preserving an anonymized, append-only audit trail (per TICKET-03 — audit entries are never deleted, only de-identified).
- **Deletion-request UI** (widened scope — see `wireframes.html` Screen 4 "Danger zone"): typed-confirmation modal warning about upcoming appointments being auto-cancelled, and a persistent "deletion requested" banner replacing the danger-zone card after submission.
- Documented retention/deletion policy (feeds the README, not a separate build artifact).

## Accept
- Patient can request deletion via the UI; requires typed confirmation (not a single click).
- PHI fields are scrubbed; audit log remains intact but no longer resolves to identifying data.
- Any upcoming appointments are cancelled as part of the deletion flow, surfaced to the patient before they confirm.
- Retention/deletion policy is documented (how long data is kept, how it's purged).

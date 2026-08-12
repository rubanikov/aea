# 04 — Patient sets their SMS carrier in profile

**What to build:** A patient can pick their mobile carrier in Settings, alongside their phone number, so cancellations can later reach them by text.

**Blocked by:** None — can start immediately

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** `accounts/models.py`, `accounts/migrations/0004_*`, `accounts/serializers.py`.
**Frontend scope:** `ProfileForm.tsx`, `lib/notifications/carriers.ts`.

## Acceptance criteria
- [ ] `User.sms_carrier` (`CharField`, max_length 32, blank/default `""`, `choices=Carrier.choices`), `Carrier` nested `TextChoices` on `User` matching existing `Role`/`Booking.Status` enum convention; migration `accounts/migrations/0004_user_sms_carrier.py`, additive
- [ ] `GET`/`PATCH /profile` `UserSerializer` gains `sms_carrier`; unknown value → 400; scoped to `request.user` only
- [ ] `ProfileForm.tsx`: new "Mobile carrier (optional)" `<select>` beside phone field, default "Not set — email only", helper copy per brief, wired to existing `PATCH /profile` submit
- [ ] `lib/notifications/carriers.ts` (new): carrier value/label list that matches backend `Carrier` choices exactly (cross-side contract — flag any drift as a bug, not a design choice)

## Brief anchors
- API: `GET`/`PATCH /profile`, `UserSerializer.sms_carrier` (ChoiceField semantics from model `choices`)
- Note: gateway domain map (`SMS_GATEWAYS`) lives in `bookings/notifications.py`, not here — this ticket only stores the carrier choice; ticket 05 consumes it

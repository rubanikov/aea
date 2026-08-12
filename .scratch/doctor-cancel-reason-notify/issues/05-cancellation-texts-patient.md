# 05 — Cancellation texts the patient when phone + carrier are known

**What to build:** When a cancelled booking's patient has both a phone number and a known carrier, they also get texted (via carrier email-to-SMS gateway through the existing Resend transport); the provider sees a warning if the text failed to send.

**Blocked by:** 03 — needs `notify_cancellation`/response contract to extend. 04 — needs `User.sms_carrier` to read.

**Size:** Right-sized

**Status:** ready-for-agent

**Backend scope:** `bookings/notifications.py` (SMS build/send logic), `bookings/views.py` (response block extension).
**Frontend scope:** `AgendaRow.tsx` (SMS-failure warning branch — same `role="status"` component from 03, new copy).

## Acceptance criteria
- [ ] `SMS_GATEWAYS` map in `bookings/notifications.py`: verizon, att, tmobile, sprint, uscellular, boost, cricket, metropcs, googlefi → correct domains
- [ ] SMS attempted only if `patient.phone` non-empty AND `patient.sms_carrier` in `SMS_GATEWAYS`; address = `{digits-only phone}@{gateway domain}`, sent via the same `send_email` seam from 03
- [ ] Skip reasons `no_phone`, `no_carrier`, `unknown_carrier`, `send_failed` all correctly reported in `notification.sms_skipped_reason` — four values, not five. An unconfigured `RESEND_API_KEY` reports as `send_failed` rather than a distinct `not_configured`: unlike the email half, which has a genuine third state ("neither sent nor failed"), the SMS contract is binary — the text either went or it didn't — and the frontend never reads the string, only `sms_attempted && !sms_sent`. Amended from the original five-value list to match what was built and shipped
- [ ] `build_sms_text`: `"Your appointment on {when} was cancelled. Reason: {reason} {link}"`, `{when}` compact ("Aug 18 at 10:00 AM", no weekday/year/zone), rendered in patient's timezone — DST test included
- [ ] Truncation math: overhead ≈63 + `len(link)`; budget = `160 - 63 - len(link)`; over-budget reason truncated to `budget-3`, `.rstrip()`, `"..."` appended (ASCII dots, not `…`); budget <20 chars drops the "Reason: ..." clause entirely, keeps statement + link; reason ASCII-normalized (`NFKD` + ascii-ignore) before measuring, so smart quotes/emoji don't blow the budget — unit tests per rule (ASCII-fold, budget-exceeded, budget-too-small-drops-clause)
- [ ] `notification` response block carries `sms_attempted`/`sms_sent`/`sms_skipped_reason` correctly for all carrier/phone combinations (a fifth value, `rate_limited`, was added after this ticket by the anti-abuse pass — the per-recipient notification budget in `bookings/notifications.py` — and means neither channel was tried)
- [ ] `AgendaRow.tsx`: extend the 03 warning to also cover `sms_attempted && !sms_sent` → "…couldn't send the text message."

## Brief anchors
- API: `PATCH /bookings/<id>/status` response `notification` block full shape (`sms_attempted`, `sms_sent`, `sms_skipped_reason`)
- Note: explicitly NOT Twilio/paid SMS — carrier email-to-SMS gateways through the existing Resend transport only, by design this iteration

// k6 load test: POST /bookings -- the booking action.
// See k6/README.md for how to run this and what it needs seeded first.
//
// Load profile: same 20-50 VU / 60s stated load as slot-availability.js
// (project.md's Performance Benchmarks table). VUS/DURATION are
// configurable.
//
// Fresh-slot-selection approach (the trickiest part of this script, per
// the ticket -- documented here deliberately, not just in the README):
// every iteration first calls GET /scheduling/slots for a randomly chosen
// (provider, appointment type, 14-day window) -- exactly like
// slot-availability.js -- and then books a RANDOMLY chosen slot from
// *that* response, not always the first one. Two effects of that random
// pick matter:
//   1. It's a genuinely open slot as of the moment this iteration queried
//      it, so the booking attempt exercises the real write path, not the
//      conflict-guard path.
//   2. Spreading the choice across the whole returned list (instead of
//      always slot[0]) keeps concurrent VUs from converging on the same
//      slot just because they happened to query the same
//      provider/type/window in the same second -- with 10 providers, 2-4
//      appointment types each, and a 14-day window typically returning
//      dozens of slots, the collision odds across 20-50 VUs stay low.
// A genuine double-booking race is still possible (two VUs draw the same
// slot) and is treated as an expected, correctly-guarded outcome (409), not
// a script bug -- see the `check` below. The alternative the ticket
// mentions -- pre-computing disjoint provider+time slices per VU -- would
// remove even that residual race, but also stops measuring what
// `create_booking`'s guard costs in real traffic, which is part of what
// "genuine booking-action latency" needs to include.
//
// The GET /scheduling/slots lookup inside each iteration is tagged
// separately (`slot_lookup`) from the POST /bookings call (`booking_action`)
// -- the threshold below applies only to the latter, so the reported p95
// is exactly the write path's latency, not conflated with the read lookup
// that finds a slot to book.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import {
  login,
  discoverProviderAppointmentTypePairs,
  randomChoice,
  randomDateWindow,
  BASE_URL,
  JSON_HEADERS,
} from './helpers.js';

export const options = {
  vus: Number(__ENV.VUS || 30),
  duration: __ENV.DURATION || '60s',
  thresholds: {
    // project.md's stated target for this endpoint.
    'http_req_duration{name:booking_action}': ['p(95)<1000'],
    checks: ['rate>0.95'],
  },
};

const noOpenSlotFound = new Counter('booking_no_open_slot_found');
const bookingSucceeded = new Rate('booking_succeeded_rate');

// setup() runs once, before any VU starts -- see helpers.js's module
// docstring for why login happens exactly once here rather than per-VU.
export function setup() {
  const cookie = login();
  return { cookie, pairs: discoverProviderAppointmentTypePairs(cookie) };
}

export default function (data) {
  const cookie = data.cookie;
  const pair = randomChoice(data.pairs);
  const { dateFrom, dateTo } = randomDateWindow();

  const slotsUrl =
    `${BASE_URL}/scheduling/slots?provider_id=${pair.providerId}` +
    `&appointment_type_id=${pair.appointmentTypeId}&date_from=${dateFrom}&date_to=${dateTo}`;
  const slotsRes = http.get(slotsUrl, { headers: { Cookie: cookie }, tags: { name: 'slot_lookup' } });

  const lookupOk = check(slotsRes, { 'slot lookup returned 200': (r) => r.status === 200 });
  if (!lookupOk) {
    sleep(1);
    return;
  }

  const slots = slotsRes.json('slots');
  if (!slots || slots.length === 0) {
    noOpenSlotFound.add(1);
    sleep(0.5);
    return;
  }

  const slot = randomChoice(slots);
  const idempotencyKey = `k6-booking-${__VU}-${__ITER}-${Date.now()}`;

  const bookingRes = http.post(
    `${BASE_URL}/bookings`,
    JSON.stringify({
      provider_id: pair.providerId,
      appointment_type_id: pair.appointmentTypeId,
      start_time: slot.start,
    }),
    {
      headers: Object.assign({}, JSON_HEADERS, { Cookie: cookie, 'Idempotency-Key': idempotencyKey }),
      tags: { name: 'booking_action' },
    }
  );

  bookingSucceeded.add(bookingRes.status === 201);
  check(bookingRes, {
    // 201: booked. 409: a genuine race for the same slot, correctly
    // rejected by architecture.md §3's guard -- not a script failure. Any
    // other status (400/401/403/5xx) fails the check.
    'booking accepted (201) or lost a genuine race (409)': (r) => r.status === 201 || r.status === 409,
  });

  sleep(Math.random());
}

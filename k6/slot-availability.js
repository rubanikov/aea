// k6 load test: GET /scheduling/slots -- the slot-availability query.
// See k6/README.md for how to run this and what it needs seeded first.
//
// Load profile: project.md's Performance Benchmarks table ("20-50
// concurrent virtual users for 60s"). VUS/DURATION are configurable so a
// run can pick any point in that range; defaults land mid-range.
//
// Each iteration queries a random (provider, appointment type, 14-day
// window) combination drawn from whatever seed_demo actually seeded
// (discovered once in setup(), not hardcoded here) -- this is what the
// ticket's brief means by "not hammering one single query": 10 providers x
// 2-4 appointment types x many possible date windows gives real query
// variety, closer to how patients actually browse than one fixed URL
// requested in a tight loop.

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  login,
  discoverProviderAppointmentTypePairs,
  randomChoice,
  randomDateWindow,
  BASE_URL,
} from './helpers.js';

const THINK_TIME_MEAN = Number(__ENV.THINK_TIME_MEAN || 0.5);

export const options = {
  vus: Number(__ENV.VUS || 30),
  duration: __ENV.DURATION || '60s',
  thresholds: {
    // project.md's stated target for this endpoint.
    'http_req_duration{name:slot_query}': ['p(95)<1000'],
    checks: ['rate>0.95'],
  },
};

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

  const url =
    `${BASE_URL}/scheduling/slots?provider_id=${pair.providerId}` +
    `&appointment_type_id=${pair.appointmentTypeId}&date_from=${dateFrom}&date_to=${dateTo}`;

  const res = http.get(url, { headers: { Cookie: cookie }, tags: { name: 'slot_query' } });

  check(res, {
    'slot query returned 200': (r) => r.status === 200,
    'response has a slots array': (r) => {
      try {
        return Array.isArray(r.json('slots'));
      } catch {
        return false;
      }
    },
  });

  // Think-time -- a patient browsing slots isn't a tight loop; this keeps
  // the VU count meaningful as "concurrent users," not a raw request-firing
  // rate. Uniform on [0, 2*THINK_TIME_MEAN], default mean 0.5s. Raise it
  // (e.g. THINK_TIME_MEAN=7 at VUS=30 ~= 250 req/min) to stay under the
  // API's per-account 300/min throttle when running against a deployment
  // where all VUs share one login -- see k6/README.md.
  sleep(Math.random() * 2 * THINK_TIME_MEAN);
}

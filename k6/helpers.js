// Shared setup for both k6 scripts in this directory -- see k6/README.md.
//
// Auth note: this API delivers JWTs as httpOnly cookies, never a token a
// script could read out of a JSON body (accounts/tokens.py). k6 exposes the
// Set-Cookie values a response received via `res.cookies` regardless of
// `httpOnly` (that flag is a browser-JS restriction, not an HTTP-client
// one), so `login()` below reads the access-token cookie value straight out
// of the login response and hands back a literal `Cookie` header string for
// every request after that -- explicit and easy to reason about, rather
// than depending on k6's automatic per-VU cookie jar (whose reset-between-
// iterations behavior is a global `options.noCookiesReset` setting neither
// script needs to also get right).
//
// Every unsafe-method request (`POST /auth/login`, `POST /bookings`) also
// needs `X-Requested-With: XMLHttpRequest` -- accounts/csrf.py enforces it
// on every state-changing request, login included (see
// `CookieJWTAuthentication.authenticate`).
//
// Login happens exactly ONCE per run, in `setup()`, and every VU reuses
// that one session cookie (passed through `setup()`'s returned `data`) --
// not "once per VU." This isn't just a style choice: `POST /auth/login` is
// throttled to 5/min per source IP (`accounts/views.py`'s
// `LoginRateThrottle`), and every VU in a k6 run shares one source IP.
// Confirmed empirically while building this script -- VUS=30 with a
// once-per-VU login design throttles ~25 of the 30 VUs to a 429 at test
// start, well before any of them ever reach the endpoint under test. A
// 15-minute access token comfortably outlives a 60s run, so one shared
// login has no accuracy cost here.

import http from 'k6/http';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

// Matches core/management/commands/seed_demo.py's DEMO_PASSWORD /
// PATIENT_ACCOUNTS -- run `python manage.py seed_demo` against BASE_URL
// before running either script.
export const PATIENT_EMAIL = __ENV.PATIENT_EMAIL || 'patient@demo.aea.test';
export const PATIENT_PASSWORD = __ENV.PATIENT_PASSWORD || 'demo-password-not-for-prod';

export const AJAX_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };
export const JSON_HEADERS = Object.assign({ 'Content-Type': 'application/json' }, AJAX_HEADERS);

// Query/booking windows stay inside seed_demo's 56-day (8-week) horizon and
// well under GET /scheduling/slots's own 60-day range cap
// (scheduling/slots.py's MAX_SLOT_QUERY_RANGE_DAYS) -- see README.md.
export const HORIZON_START_OFFSET_DAYS = 1;
export const HORIZON_END_OFFSET_DAYS = 54;
export const QUERY_WINDOW_DAYS = 13; // 14 calendar days inclusive per query

/** Logs in as the seeded demo patient and returns a `Cookie` header value
 * carrying the access token -- pass this as `headers.Cookie` on every
 * authenticated request that follows. Throws (failing the run loudly,
 * rather than letting every subsequent request silently 401) if login
 * itself fails, since that always means the dataset wasn't seeded, not a
 * latency data point worth recording. */
export function login() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: PATIENT_EMAIL, password: PATIENT_PASSWORD }),
    { headers: JSON_HEADERS, tags: { name: 'login' } }
  );
  if (res.status !== 200) {
    throw new Error(
      `login failed with status ${res.status} for ${PATIENT_EMAIL} at ${BASE_URL}/auth/login -- ` +
        `run 'python manage.py seed_demo' against this backend first. Body: ${res.body}`
    );
  }
  const accessCookie = res.cookies.access_token;
  if (!accessCookie || accessCookie.length === 0) {
    throw new Error('login response did not set an access_token cookie');
  }
  return `access_token=${accessCookie[0].value}`;
}

/** Fetches every (provider_id, appointment_type_id) pair currently seeded,
 * via the same discovery endpoints a patient would browse
 * (`GET /scheduling/providers` then `GET /scheduling/providers/<id>/appointment-types`).
 * Intended for `setup()`, which k6 runs once before VUs start -- so this
 * one-time discovery cost is never mixed into the per-iteration metrics
 * either script measures. */
export function discoverProviderAppointmentTypePairs(cookie) {
  const providersRes = http.get(`${BASE_URL}/scheduling/providers`, { headers: { Cookie: cookie } });
  if (providersRes.status !== 200) {
    throw new Error(`GET /scheduling/providers failed with status ${providersRes.status}`);
  }
  const providers = providersRes.json();
  if (!providers || providers.length === 0) {
    throw new Error('No providers found -- run seed_demo first.');
  }

  const pairs = [];
  for (const provider of providers) {
    const typesRes = http.get(`${BASE_URL}/scheduling/providers/${provider.id}/appointment-types`, {
      headers: { Cookie: cookie },
    });
    if (typesRes.status !== 200) {
      continue;
    }
    for (const appointmentType of typesRes.json()) {
      pairs.push({ providerId: provider.id, appointmentTypeId: appointmentType.id });
    }
  }
  if (pairs.length === 0) {
    throw new Error('No provider/appointment-type pairs found -- run seed_demo first.');
  }
  return pairs;
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomChoice(items) {
  return items[randomInt(0, items.length - 1)];
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** A random `QUERY_WINDOW_DAYS`-wide date window, positioned somewhere in
 * the seeded booking horizon -- varies which slice of the calendar each
 * iteration queries, rather than every VU hammering the same date range. */
export function randomDateWindow() {
  const today = new Date();
  const earliestStart = addDays(today, HORIZON_START_OFFSET_DAYS);
  const latestStart = addDays(today, HORIZON_END_OFFSET_DAYS - QUERY_WINDOW_DAYS);
  const spanDays = Math.floor((latestStart.getTime() - earliestStart.getTime()) / 86400000);
  const dateFrom = addDays(earliestStart, randomInt(0, Math.max(spanDays, 0)));
  const dateTo = addDays(dateFrom, QUERY_WINDOW_DAYS);
  return { dateFrom: toDateStr(dateFrom), dateTo: toDateStr(dateTo) };
}

# Backend conventions

## Audit log is append-only — enforced in code

`AuditLog` rejects any update or delete (`audit.models.AuditLogIsAppendOnly`),
including bulk queryset operations and test fixtures. To backdate an entry in
tests, mock `django.utils.timezone.now` at creation time — never `.update()`.

## Import-time settings vs. test-time DEBUG

`manage.py test` runs with runtime `DEBUG=False` (the test runner forces it),
but settings computed *at import time* from `DEBUG` (e.g. `SECURE_HSTS_SECONDS`,
`CACHES`) follow the ambient `DJANGO_DEBUG` env var — locally that's the repo
`.env`'s `True`. Tests asserting production values of import-time settings must
pin them with `override_settings`, not trust the environment.

## Parallel test runs

Set `TEST_DB_NAME_SUFFIX` to give a test run its own test-database name so two
runs can share one Postgres instance without colliding.

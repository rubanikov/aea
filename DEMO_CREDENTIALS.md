# Demo account credentials

Committed on purpose so a grader cloning the repo fresh gets working logins
without digging through the seed script. Every account and its password are
synthetic demo data — nothing here is a real secret.

Verified 2026-08-14 against the local Postgres (`postgres` and `aea_k6`) and
the Railway production database. All 41 seeded accounts exist, are active,
and accept the password below.

Source of truth: `backend/core/management/commands/seed_demo.py`. Re-run
`python manage.py seed_demo` to (re)create missing accounts; it is
idempotent, but **does not reset passwords** on accounts that already exist.

## Where to log in

| | Frontend | API |
|---|---|---|
| Local | http://localhost:3003 | http://localhost:8000 |
| Railway | https://frontend-production-9ca8.up.railway.app | https://backend-production-e1121.up.railway.app |

Local frontend is on **3003** because another Docker container already binds
3000. CORS already allows 3000, 3001, and 3003.

## Password (every account)

```
demo-password-not-for-prod
```

**Exception — the deployed admin.** On the Railway deployment,
`admin@demo.aea.test` uses a rotated password that is deliberately not
published anywhere in this repo: the admin role can read every booking and
the full audit log, so a repo-published admin password would undercut the
RBAC design the deployment demonstrates. Graders who need admin access can
request the credential out of band, or use a local checkout, where the seed
password above still applies to the admin account.

Every demo patient, provider, and admin is on **America/Chicago**.

## Quick logins

| Role | Email | Password |
|---|---|---|
| Patient | patient@demo.aea.test | demo-password-not-for-prod |
| Provider | provider1@demo.aea.test | demo-password-not-for-prod |
| Admin | admin@demo.aea.test | demo-password-not-for-prod (local only — rotated on Railway, see above) |

There is no `patient1@…` — the first patient is the unnumbered
`patient@demo.aea.test`. Then `patient2`–`patient25` and `provider1`–`provider15`.

## Admin

| Name | Email | Password |
|---|---|---|
| Demo Admin | admin@demo.aea.test | demo-password-not-for-prod (local only — rotated on Railway) |

## Patients (k6 / original cohort)

| Name | Email | Password |
|---|---|---|
| Pat Patterson | patient@demo.aea.test | demo-password-not-for-prod |
| Jordan Lee | patient2@demo.aea.test | demo-password-not-for-prod |
| Sam Rivera | patient3@demo.aea.test | demo-password-not-for-prod |
| Taylor Brooks | patient4@demo.aea.test | demo-password-not-for-prod |
| Morgan Diaz | patient5@demo.aea.test | demo-password-not-for-prod |

### Weekly-recurring cohort (20 patients)

Each of these has a standing weekly appointment with each of the 5 weekly-cohort
doctors below.

| Name | Email | Password |
|---|---|---|
| Avery Coleman | patient6@demo.aea.test | demo-password-not-for-prod |
| Bailey Foster | patient7@demo.aea.test | demo-password-not-for-prod |
| Cameron Ortiz | patient8@demo.aea.test | demo-password-not-for-prod |
| Dakota Reyes | patient9@demo.aea.test | demo-password-not-for-prod |
| Elliot Nakamura | patient10@demo.aea.test | demo-password-not-for-prod |
| Finley Osei | patient11@demo.aea.test | demo-password-not-for-prod |
| Gabriela Cruz | patient12@demo.aea.test | demo-password-not-for-prod |
| Harper Lindqvist | patient13@demo.aea.test | demo-password-not-for-prod |
| Imani Clarke | patient14@demo.aea.test | demo-password-not-for-prod |
| Jules Bergstrom | patient15@demo.aea.test | demo-password-not-for-prod |
| Kai Anderson | patient16@demo.aea.test | demo-password-not-for-prod |
| Lena Kowalski | patient17@demo.aea.test | demo-password-not-for-prod |
| Marcus Webb | patient18@demo.aea.test | demo-password-not-for-prod |
| Noor Haddad | patient19@demo.aea.test | demo-password-not-for-prod |
| Oscar Delgado | patient20@demo.aea.test | demo-password-not-for-prod |
| Priya Chandra | patient21@demo.aea.test | demo-password-not-for-prod |
| Quinn Sullivan | patient22@demo.aea.test | demo-password-not-for-prod |
| Ravi Subramaniam | patient23@demo.aea.test | demo-password-not-for-prod |
| Sofia Marchetti | patient24@demo.aea.test | demo-password-not-for-prod |
| Theo Larsson | patient25@demo.aea.test | demo-password-not-for-prod |

## Providers (k6 / original cohort)

| Name | Email | Timezone | Password |
|---|---|---|---|
| Dr. Ana Rossi | provider1@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Brian Chen | provider2@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Carla Gomez | provider3@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Deepak Rao | provider4@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Elena Petrova | provider5@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Farid Haidari | provider6@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Grace Kim | provider7@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Hassan Ali | provider8@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Ines Fischer | provider9@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Jamal Ochieng | provider10@demo.aea.test | America/Chicago | demo-password-not-for-prod |

### Weekly-recurring cohort (5 doctors)

| Name | Email | Timezone | Password |
|---|---|---|---|
| Dr. Miriam Osei | provider11@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Lucas Almeida | provider12@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Naomi Choi | provider13@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Tariq Farouk | provider14@demo.aea.test | America/Chicago | demo-password-not-for-prod |
| Dr. Sophie Lindgren | provider15@demo.aea.test | America/Chicago | demo-password-not-for-prod |

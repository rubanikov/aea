from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

User = get_user_model()

# Demo accounts, one per role. Password is fixed and dev-only -- never used
# outside a local/demo database seeded from this command.
DEMO_PASSWORD = "demo-password-not-for-prod"  # noqa: S105 -- seed fixture, not a real credential

DEMO_ACCOUNTS = [
    {"role": User.Role.ADMIN, "email": "admin@demo.aea.test", "name": "Demo Admin"},
    {"role": User.Role.PROVIDER, "email": "provider@demo.aea.test", "name": "Demo Provider"},
    {"role": User.Role.PATIENT, "email": "patient@demo.aea.test", "name": "Demo Patient"},
]


class Command(BaseCommand):
    help = "Seed demo provider/patient/admin accounts (idempotent — safe to re-run)."

    def handle(self, *args, **options):
        for account in DEMO_ACCOUNTS:
            user, created = User.objects.get_or_create(
                email=account["email"],
                defaults={"name": account["name"], "role": account["role"]},
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save(update_fields=["password"])
                message = f"  created {account['role']}: {account['email']}"
                self.stdout.write(self.style.SUCCESS(message))
            else:
                self.stdout.write(f"  already exists {account['role']}: {account['email']}")

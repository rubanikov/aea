from django.core.management.base import BaseCommand

# Demo accounts this command will create once TICKET-02's User/role model
# exists. Kept here (not invented as a real model) so the eventual seeding
# logic has a single obvious list to iterate over.
DEMO_ACCOUNTS = [
    {"role": "admin", "email": "admin@demo.aea.test", "name": "Demo Admin"},
    {"role": "provider", "email": "provider@demo.aea.test", "name": "Demo Provider"},
    {"role": "patient", "email": "patient@demo.aea.test", "name": "Demo Patient"},
]


class Command(BaseCommand):
    help = (
        "Seed demo provider/patient/admin accounts. Placeholder until "
        "TICKET-02 lands the User/role model: prints the accounts it will "
        "create instead of creating them, and exits cleanly."
    )

    def handle(self, *args, **options):
        self.stdout.write(
            self.style.WARNING(
                "No User/role model yet (lands in TICKET-02) - nothing was "
                "created. Once it exists, this command will seed:"
            )
        )
        for account in DEMO_ACCOUNTS:
            self.stdout.write(f"  - {account['role']}: {account['email']} ({account['name']})")

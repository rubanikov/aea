from unittest.mock import patch

from django.db.utils import OperationalError
from django.test import Client, TestCase


class HealthCheckTests(TestCase):
    def test_returns_200_and_ok_when_database_is_reachable(self):
        response = Client().get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "database": "reachable"})

    @patch("core.views.connection.cursor", side_effect=OperationalError("mock db outage"))
    def test_returns_503_and_degraded_when_database_is_unreachable(self, _mock_cursor):
        response = Client().get("/health")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "degraded", "database": "unreachable"})

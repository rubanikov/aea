import json
import logging
import sys

from django.conf import settings
from django.test import SimpleTestCase

from core.logging import JsonFormatter


class JsonFormatterTests(SimpleTestCase):
    """Deployed logs are one JSON object per line (`config/settings.py`'s
    `LOGGING`, `LOG_FORMAT=json` outside DEBUG) so they can be filtered by
    level/logger without regex scraping."""

    def _record(self, msg, *args, level=logging.INFO, exc_info=None, **extra):
        record = logging.LogRecord(
            name="bookings.views",
            level=level,
            pathname=__file__,
            lineno=1,
            msg=msg,
            args=args,
            exc_info=exc_info,
        )
        for key, value in extra.items():
            setattr(record, key, value)
        return record

    def test_emits_one_json_object_with_the_expected_fields(self):
        line = JsonFormatter().format(self._record("booking created id=%s", 42))

        payload = json.loads(line)
        self.assertEqual(payload["level"], "INFO")
        self.assertEqual(payload["logger"], "bookings.views")
        self.assertEqual(payload["message"], "booking created id=42")
        self.assertTrue(payload["timestamp"].endswith("+00:00"))
        self.assertNotIn("\n", line)

    def test_includes_status_code_when_django_request_logger_attaches_it(self):
        line = JsonFormatter().format(self._record("Conflict: /bookings", status_code=409))

        self.assertEqual(json.loads(line)["status_code"], 409)

    def test_includes_traceback_for_exception_records(self):
        try:
            raise ValueError("boom")
        except ValueError:
            record = self._record("failed", level=logging.ERROR, exc_info=sys.exc_info())

        payload = json.loads(JsonFormatter().format(record))
        self.assertIn("ValueError: boom", payload["exception"])

    def test_both_formatters_are_registered_and_console_uses_one_of_them(self):
        formatters = settings.LOGGING["formatters"]
        self.assertEqual(formatters["json"]["()"], "core.logging.JsonFormatter")
        self.assertIn("text", formatters)
        self.assertIn(settings.LOGGING["handlers"]["console"]["formatter"], ("json", "text"))

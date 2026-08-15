"""One-line-JSON log formatter for the deployed environment.

Railway (and most log shippers) capture stdout line by line; emitting each
record as a JSON object means fields can be filtered on (`logger`,
`level`, `request_id`-style identifiers in the message) without regex
scraping. Local dev keeps the plain text format -- see `LOGGING` in
`config/settings.py` for how the two are switched on `DEBUG`.

No PHI ever reaches this formatter by construction: every call site logs
identifiers only (see the "No PHI in logs" section of the README and
`bookings/tests/test_acceptance_journey.py`'s `NoPHIInApplicationLogsTests`).
This class adds nothing from the request; it only serializes what the
logger was handed.
"""

import json
import logging
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record):
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(
                timespec="milliseconds"
            ),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Django's request logger attaches the status code; keep it as a
        # first-class field so 5xx/4xx counts are one filter away.
        status_code = getattr(record, "status_code", None)
        if status_code is not None:
            payload["status_code"] = status_code
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)

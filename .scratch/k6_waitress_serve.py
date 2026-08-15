"""Local-only WSGI server for k6. Not part of the product; do not commit."""
import os
import sys

BACKEND = os.path.join(os.path.dirname(__file__), "..", "backend")
os.chdir(BACKEND)
sys.path.insert(0, os.path.abspath(BACKEND))
os.environ["DATABASE_URL"] = "postgresql://postgres:postgres@localhost:5432/aea_k6"
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from rest_framework.throttling import SimpleRateThrottle

SimpleRateThrottle.THROTTLE_RATES = {
    **SimpleRateThrottle.THROTTLE_RATES,
    "user": "100000/min",
    "anon": "100000/min",
}

from waitress import serve

from config.wsgi import application

print("waitress listening on 127.0.0.1:8000", flush=True)
serve(application, listen="127.0.0.1:8000", threads=16)

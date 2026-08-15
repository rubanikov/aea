"""config/urls.py mounts /admin/ conditionally -- see the comment there.

The URLconf is evaluated at import time, so these tests reload the module
under each settings combination and inspect the resulting urlpatterns
directly, rather than making requests (the running suite's own URLconf
always has admin mounted, via the RUNNING_TESTS carve-out)."""

import importlib

from django.test import SimpleTestCase, override_settings

import config.urls


def _reloaded_urlpatterns(**settings_overrides):
    with override_settings(**settings_overrides):
        patterns = list(importlib.reload(config.urls).urlpatterns)
    importlib.reload(config.urls)  # restore for the rest of the suite
    return patterns


def _mounts_admin(patterns):
    return any(str(p.pattern) == "admin/" for p in patterns)


class AdminMountTests(SimpleTestCase):
    def test_admin_is_not_mounted_in_production_configuration(self):
        patterns = _reloaded_urlpatterns(DEBUG=False, RUNNING_TESTS=False)

        self.assertFalse(_mounts_admin(patterns))

    def test_admin_is_mounted_in_debug(self):
        patterns = _reloaded_urlpatterns(DEBUG=True, RUNNING_TESTS=False)

        self.assertTrue(_mounts_admin(patterns))

    def test_admin_is_mounted_for_the_test_suite_itself(self):
        # The provisioning workflow tests (accounts/tests/
        # test_admin_provisioning.py) depend on this carve-out.
        patterns = _reloaded_urlpatterns(DEBUG=False, RUNNING_TESTS=True)

        self.assertTrue(_mounts_admin(patterns))

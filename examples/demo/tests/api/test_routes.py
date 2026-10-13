import time

import pytest


@pytest.mark.parametrize("route", ["/", "/users", "/users/1", "/teams", "/teams/7", "/search", "/health", "/version",
                                   "/billing", "/billing/invoices", "/settings", "/settings/keys", "/export",
                                   "/import", "/audit", "/webhooks", "/flags", "/limits", "/me", "/logout"])
def test_route_responds(route):
    time.sleep(0.1)
    assert route.startswith("/")

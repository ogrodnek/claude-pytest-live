import re
import time

import pytest


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


@pytest.mark.parametrize("title", [f"Post number {i}" for i in range(23)])
def test_slugify(title):
    time.sleep(0.06)
    assert " " not in slugify(title)


@pytest.mark.skip(reason="needs postgis")
def test_geo_slug():
    pass


@pytest.mark.skip(reason="needs redis")
def test_cached_slug():
    pass

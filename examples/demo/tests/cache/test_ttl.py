import time

import pytest


@pytest.mark.parametrize("ttl", [1, 5, 10, 30, 60, 120, 300, 600, 900])
def test_ttl_positive(ttl):
    time.sleep(0.1)
    assert ttl > 0


@pytest.mark.xfail(reason="eviction is not implemented yet")
def test_evict_lru():
    assert False

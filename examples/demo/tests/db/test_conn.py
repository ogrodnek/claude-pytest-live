import time

import pytest


@pytest.fixture
def pg():
    # errors on purpose: setup fails before the test runs
    raise ConnectionRefusedError("[Errno 61] Connection refused: localhost:5432")


@pytest.mark.parametrize("n", range(7))
def test_connect(n):
    time.sleep(0.1)
    assert n < 10


def test_pool(pg):
    assert pg

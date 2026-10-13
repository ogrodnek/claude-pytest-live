import time

import pytest


@pytest.mark.parametrize("batch", range(10))
def test_push_batch(batch):
    time.sleep(0.12)
    assert batch >= 0


def test_retry_backoff():
    # slow on purpose, to show the running test and its SLOW tag
    time.sleep(6)
    assert True


def test_merge_conflict():
    time.sleep(0.1)
    assert {"a": 1} | {"b": 2} == {"a": 1, "b": 2}

import time

import pytest


def parse(text):
    key, _, value = text.partition("=")
    return key.strip(), value.strip()


@pytest.mark.parametrize("text", ["a=1", "b = 2", "c=", "d=4 ", " e=5", "f=x=y", "g=  7", "h=8", "i=9", "j=10",
                                  "k=11", "l=12", "m=13"])
def test_parse_pairs(text):
    time.sleep(0.08)
    key, _ = parse(text)
    assert key


def test_colon_prefix():
    time.sleep(0.1)
    # fails on purpose
    assert parse("a:b=1")[0] == "a"


def test_empty_key():
    time.sleep(0.1)
    # fails on purpose
    assert parse("=1")[0], "key should not be empty"

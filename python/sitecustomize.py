"""Loaded by Python at startup because the pytest-live mod puts this folder on
PYTHONPATH inside Claude Code. Asks pytest to load claude_pytest_live, which
sits beside this file, so the plugin is requested only when it is importable.
Then runs any other sitecustomize this one shadows."""

import os
import sys


def _activate():
    if not os.environ.get("CLAUDE_PYTEST_LIVE_DIR"):
        return
    opts = os.environ.get("PYTEST_ADDOPTS", "")
    if "claude_pytest_live" not in opts:
        os.environ["PYTEST_ADDOPTS"] = (opts + " -p claude_pytest_live").strip()


def _chain():
    import importlib.machinery
    import importlib.util

    here = os.path.dirname(os.path.abspath(__file__))
    rest = [p for p in sys.path if os.path.abspath(p or ".") != here]
    spec = importlib.machinery.PathFinder.find_spec("sitecustomize", rest)
    if spec is None or spec.loader is None:
        return
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


try:
    _activate()
except Exception:
    pass

try:
    _chain()
except Exception:
    pass

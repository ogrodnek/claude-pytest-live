"""pytest plugin for the pytest-live Claude Code mod.

Appends one JSON line per event to $CLAUDE_PYTEST_LIVE_DIR/<ms>-<pid>.jsonl:
  start      {"e":"start","pid","args","t"}
  collected  {"e":"collected","n","f"}     f: tests per file
  s          {"e":"s","id"}                  a test started
  r          {"e":"r","id","o","d","m"?}     a test's outcome
  end        {"e":"end","x"}                 exit status
Never raises: a failed write only means no live view.
"""

import collections
import json
import os
import time

import pytest

_out = None
_is_on = False


def _emit(**event):
    global _out, _is_on
    if not _is_on:
        return
    try:
        if _out is None:
            folder = os.environ["CLAUDE_PYTEST_LIVE_DIR"]
            os.makedirs(folder, exist_ok=True)
            name = "%d-%d.jsonl" % (int(time.time() * 1000), os.getpid())
            _out = open(os.path.join(folder, name), "a", buffering=1, encoding="utf-8")
        event["t"] = round(time.time(), 3)
        _out.write(json.dumps(event, separators=(",", ":")) + "\n")
    except Exception:
        _is_on = False


def _per_file(nodeids):
    return dict(collections.Counter(nodeid.split("::")[0] for nodeid in nodeids))


def _message(report):
    longrepr = report.longrepr
    if longrepr is None:
        return None
    if isinstance(longrepr, tuple) and len(longrepr) == 3:
        return str(longrepr[2])[:300]
    crash = getattr(longrepr, "reprcrash", None)
    if crash is not None and getattr(crash, "message", None):
        return crash.message.strip().splitlines()[0][:300] if crash.message.strip() else None
    text = str(longrepr).strip().splitlines()
    return text[-1][:300] if text else None


def _outcome(report):
    is_xfail = hasattr(report, "wasxfail")
    if report.when == "call":
        if is_xfail:
            return "xfailed" if report.skipped else "xpassed"
        return report.outcome
    if report.skipped:
        return "xfailed" if is_xfail else "skipped"
    if report.failed:
        return "error"
    return None


class _Xdist:
    @pytest.hookimpl(optionalhook=True)
    def pytest_xdist_node_collection_finished(self, node, ids):
        if not getattr(self, "is_sent", False):
            self.is_sent = True
            _emit(e="collected", n=len(ids), f=_per_file(ids))


def pytest_configure(config):
    global _is_on
    if hasattr(config, "workerinput"):
        return
    owner = os.environ.get("CLAUDE_PYTEST_LIVE_OWNER")
    if owner and owner != str(os.getpid()):
        return
    os.environ["CLAUDE_PYTEST_LIVE_OWNER"] = str(os.getpid())
    _is_on = bool(os.environ.get("CLAUDE_PYTEST_LIVE_DIR"))
    _emit(e="start", pid=os.getpid(), args=[str(a) for a in config.invocation_params.args])
    if config.pluginmanager.hasplugin("xdist"):
        config.pluginmanager.register(_Xdist(), "claude_pytest_live_xdist")


def pytest_collection_finish(session):
    _emit(e="collected", n=len(session.items), f=_per_file(item.nodeid for item in session.items))


def pytest_runtest_logstart(nodeid, location):
    _emit(e="s", id=nodeid)


def pytest_runtest_logreport(report):
    outcome = _outcome(report)
    if outcome is None:
        return
    event = {"e": "r", "id": report.nodeid, "o": outcome, "d": round(report.duration, 3)}
    if outcome in ("failed", "error", "skipped"):
        message = _message(report)
        if message:
            event["m"] = message
    _emit(**event)


def pytest_collectreport(report):
    if report.failed:
        _emit(e="r", id=report.nodeid or "<collection>", o="error", d=0, m=_message(report) or "collection error")


@pytest.hookimpl(trylast=True)
def pytest_sessionfinish(session, exitstatus):
    _emit(e="end", x=int(exitstatus))
    global _out
    if _out is not None:
        try:
            _out.close()
        except Exception:
            pass
        _out = None

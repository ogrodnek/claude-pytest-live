# pytest-live

A Claude Code mod that shows pytest runs live while they happen. When Claude runs your tests,
a pane shows progress, pass/fail counts and failures as they come in, and the status line keeps a
one-line summary.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pytest-live --marketplace ogrodnek/claude-pytest-live
```

Answer `y` to add the marketplace, then press Enter to pick a scope (user scope installs it for
every session). The mod is active right away, with no restart.

From a shell:

```
claude plugin install pytest-live --marketplace ogrodnek/claude-pytest-live
```

In the desktop app, where `/plugin` isn't available: click **+** next to the prompt box, then
**Plugins** → **Add marketplace** with `ogrodnek/claude-pytest-live`, then **Add plugin**.

Nothing needs installing on the Python side: the mod brings its own pytest plugin.

## Usage

Run pytest from inside Claude Code, either by asking Claude to run the tests or with `!pytest` at
the prompt. When a run starts:

- the **pytest** pane opens with progress, counts by outcome, a row per test file with its
  failures, and the test running now
- the status line shows `pytest 12/39 · ✗2` while it runs, and the result for a minute after

Closing the pane keeps it from opening on its own again; a band above the prompt offers to
reopen it after the next run. `/pytest-live` opens it any time. On a terminal too narrow for the
pane, the same band offers it instead.

To see it with a suite that passes, fails, errors, skips and runs slowly on purpose, run this from
the plugin folder:

```
uv run --with pytest pytest examples/demo
```

## How it works

At session start the mod puts its `python/` folder first on `PYTHONPATH` and sets
`CLAUDE_PYTEST_LIVE_DIR`. Python then loads `python/sitecustomize.py`, which adds
`-p claude_pytest_live` to `PYTEST_ADDOPTS` and chains to any other `sitecustomize` it shadows.
The pytest plugin appends one JSON line per event to a file under
`/tmp/claude-pytest-live/<session-id>/`, and the mod polls that folder to draw the pane and
status line. It keeps the last five runs and marks a run whose process died as lost.

Because it relies on the environment Claude Code sets up, pytest started in a separate terminal
doesn't show up, and neither does Python run with `-E` or `-I`, which ignore `PYTHONPATH`.

## Development

Load the mod from a checkout for one session; saving a file reloads it:

```
claude --plugin-dir /path/to/claude-pytest-live
```

Check and test it:

```
claude plugin validate .
claude plugin test .
```

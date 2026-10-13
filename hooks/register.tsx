import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, Register } from 'claude-code'

import type { PytestRun } from '../types'
import { doneCount, duration, fold, summary, verdict } from './fold'
import { paneModel } from './model'
import { emptyView, type Kit, paneView } from './view'

const PANE = 'pytest-live'
const ROOT = '/tmp/claude-pytest-live'
const POLL_MS = 500
const KEEP_RUNS = 5
const IDLE_BEFORE_ALIVE_CHECK_MS = 5_000
const STATUS_AFTER_END_MS = 60_000

const runs = atom({ plugin: 'pytest-live', key: 'runs' } as const, [])
const isMuted = atom({ plugin: 'pytest-live', key: 'isMuted' } as const, false)

// module state: a reload starts these over, and the next tick rebuilds them
let dir = ''
let ticker: { cancel: () => void } | undefined
let isTicking = false
let lastStatus: string | undefined
let wasOffering = false
const signatures = new Map<string, string>()
const aliveCheckedAt = new Map<string, number>()

async function isAlive($: EngineInterface, pid: number) {
  try {
    const { exitCode } = await $.process.run(['/bin/kill', '-0', String(pid)], { timeoutMs: 2_000 })
    return exitCode === 0
  } catch {
    return true
  }
}

/** Still going, or finished recently enough that the status line still shows it. */
function isRecentRun(run: PytestRun, now: number) {
  if (run.phase === 'collecting' || run.phase === 'running') return true
  return now - (run.startedAt + run.elapsedMs) < STATUS_AFTER_END_MS
}

function showStatus($: EngineInterface, list: PytestRun[], now: number) {
  const run = list.at(-1)
  let text: string | undefined
  if (run && (run.phase === 'collecting' || run.phase === 'running')) {
    const failed = run.counts.failed + run.counts.error
    text = run.total === null
      ? 'pytest collecting…'
      : `pytest ${doneCount(run)}/${run.total}${failed ? ` · ✗${failed}` : ''}`
  } else if (run && isRecentRun(run, now)) {
    const { label, isGood } = verdict(run)
    text = `pytest ${isGood ? '✓' : '✗'} ${label} · ${summary(run)} · ${duration(run.elapsedMs)}`
  }
  if (text !== lastStatus) {
    lastStatus = text
    $.ui.status(text)
  }
}

async function tick($: EngineInterface) {
  if (isTicking || dir === '') return
  isTicking = true
  try {
    const entries: FsEntry[] = await $.fs.list(dir).catch(() => [])
    const files = entries
      .filter(f => f.kind === 'file' && f.name.endsWith('.jsonl'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(-KEEP_RUNS)
    const now = await $.clock.now()
    const before = await read($, runs)
    const byId = new Map(before.map(run => [run.id, run]))
    const after: PytestRun[] = []

    for (const file of files) {
      const old = byId.get(file.name)
      if (old && (old.phase === 'done' || old.phase === 'lost')) {
        after.push(old)
        continue
      }
      let run = old ?? null
      const signature = `${file.size}:${file.mtimeMs}`
      if (signatures.get(file.name) !== signature) {
        const text = await $.fs.read(`${dir}/${file.name}`).catch(() => null)
        if (text !== null) {
          run = fold(file.name, text, now) ?? run
          signatures.set(file.name, signature)
        }
      } else if (run) {
        run = { ...run, elapsedMs: now - run.startedAt }
      }
      if (run === null) continue

      const isQuiet = now - file.mtimeMs > IDLE_BEFORE_ALIVE_CHECK_MS
      const checkedAt = aliveCheckedAt.get(file.name) ?? 0
      if (run.phase !== 'done' && isQuiet && now - checkedAt > IDLE_BEFORE_ALIVE_CHECK_MS) {
        aliveCheckedAt.set(file.name, now)
        if (!(await isAlive($, run.pid))) run = { ...run, phase: 'lost', current: null }
      }

      // a run can finish between polls, so a recently finished run first seen now opens it too
      if (old === undefined && isRecentRun(run, now) && !(await read($, isMuted))) {
        // an unasked pane waits undrawn on a narrow terminal; the band offers to open it.
        // Not awaited, so opening the pane can never hold up the status line.
        void $.ui
          .open({ id: PANE, title: 'pytest' })
          .then(opened => opened.isPlaced || $.ui.invalidate('ui.render'))
          .catch(() => {})
      }
      after.push(run)
    }

    if (JSON.stringify(after) !== JSON.stringify(before)) await update($, runs, () => after)
    showStatus($, after, now)

    // while muted the band offers the pane for a recent run; redraw it when that window ends
    const latest = after.at(-1)
    const isOffering = latest !== undefined && isRecentRun(latest, now) && (await read($, isMuted))
    if (isOffering !== wasOffering) {
      wasOffering = isOffering
      try {
        $.ui.invalidate('ui.render')
      } catch {
        // the band redraws on its own when the runs change
      }
    }
  } finally {
    isTicking = false
  }
}

/** Opens the pane as the person asked for it, which places it at any width. */
async function openPane($: EngineInterface) {
  await update($, isMuted, () => false)
  const opened = await $.ui.open({ id: PANE, title: 'pytest' })
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // the band redraws on its own when the runs change
  }
  return opened
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    dir = `${ROOT}/${await $.session.id()}`
    const python = `${$.plugin.root}/python`
    const current = (await $.env.get('PYTHONPATH')) ?? ''
    const rest = current.split(':').filter(part => part !== '' && part !== python)
    await $.env.set('PYTHONPATH', [python, ...rest].join(':'))
    await $.env.set('CLAUDE_PYTEST_LIVE_DIR', dir)

    await $.command.register({
      name: 'pytest-live',
      description: 'Show live pytest results in a pane',
    })

    ticker?.cancel()
    ticker = $.clock.every(POLL_MS, () => void tick($))

    return next(e)
  })

  on('command.run', { command: 'pytest-live' }, async $ => {
    const opened = await openPane($)

    return { text: opened.isPlaced ? 'pytest-live pane opened.' : 'pytest-live: there is no room for the pane here.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, isMuted, () => true)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    const latest = (await read($, runs)).at(-1)
    if (latest === undefined || pane?.isPlaced) return next(e)

    // offered when the pane the mod opened waits undrawn, or after a recent run while
    // muted (the person closed the pane, so it no longer opens on its own)
    const isWaiting = pane !== undefined
    const isOffered =
      isWaiting || ((await read($, isMuted)) && isRecentRun(latest, await $.clock.now()))
    if (!isOffered) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const { label, isGood } = verdict(latest)
    // ✓ or ✗ only once the run has ended; a run still going is neither
    const isGoing = latest.phase === 'collecting' || latest.phase === 'running'
    const mark = isGoing ? '▸' : isGood ? '✓' : '✗'

    return (
      <Box>
        <Text dimColor wrap="truncate-end">
          pytest {mark} {label} · {summary(latest)}{' '}
        </Text>
        <Button key="open" label="open" onPress={() => void openPane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const kit: Kit = {
      Box: ui.Box,
      Text: ui.Text,
      // the terminal has no Svg; elsewhere the ring and bars are small images
      Svg: 'Svg' in ui ? ui.Svg : undefined,
      columns: Math.max(30, e.props.bodyColumns),
      rows: e.props.scroll.bodyRows,
    }
    const latest = (await read($, runs)).at(-1)
    if (latest === undefined) return emptyView(kit)

    return paneView(kit, paneModel(latest, await $.clock.now()))
  })
}

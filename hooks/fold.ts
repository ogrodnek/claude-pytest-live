import type { PytestFailure, PytestFile, PytestOutcome, PytestRun } from '../types'

type Event =
  | { e: 'start'; pid: number; args: string[]; t: number }
  | { e: 'collected'; n: number; f?: Record<string, number>; t: number }
  | { e: 's'; id: string; t: number }
  | { e: 'r'; id: string; o: PytestOutcome; d: number; m?: string; t: number }
  | { e: 'end'; x: number; t: number }

/** Failures kept in detail per file; the rest are only counted (`PytestFile.failed`). */
export const FAILURES_PER_FILE = 3

export const emptyCounts = (): PytestRun['counts'] => ({
  passed: 0,
  failed: 0,
  skipped: 0,
  error: 0,
  xfailed: 0,
  xpassed: 0,
})

/** Builds a run's summary from the whole text of its JSON-lines file. */
export function fold(id: string, text: string, now: number): PytestRun | null {
  const outcomes = new Map<string, PytestOutcome>()
  const messages = new Map<string, string>()
  const running = new Map<string, number>()
  let perFile: Record<string, number> = {}
  let start: Extract<Event, { e: 'start' }> | null = null
  let total: number | null = null
  let end: Extract<Event, { e: 'end' }> | null = null

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let event: Event
    try {
      event = JSON.parse(line)
    } catch {
      continue // a line still being written
    }
    if (event.e === 'start') start = event
    else if (event.e === 'collected') {
      total = event.n
      perFile = event.f ?? {}
    } else if (event.e === 's') running.set(event.id, Math.round(event.t * 1000))
    else if (event.e === 'r') {
      running.delete(event.id)
      // a teardown error after a pass still marks the test as an error
      if (outcomes.get(event.id) !== 'error') outcomes.set(event.id, event.o)
      if (event.m) messages.set(event.id, event.m)
    } else if (event.e === 'end') end = event
  }
  if (start === null) return null

  const counts = emptyCounts()
  const failures: PytestFailure[] = []
  const keptPerFile = new Map<string, number>()
  for (const [nodeid, outcome] of outcomes) {
    counts[outcome] += 1
    if (outcome !== 'failed' && outcome !== 'error') continue
    // keep the first few per file, so every failing file has some to show however many fail
    const kept = keptPerFile.get(fileOf(nodeid)) ?? 0
    if (kept < FAILURES_PER_FILE) {
      failures.push({ nodeid, outcome, message: messages.get(nodeid) ?? '' })
      keptPerFile.set(fileOf(nodeid), kept + 1)
    }
  }

  const isOver = end !== null
  const [oldest] = [...running].sort((a, b) => a[1] - b[1])

  const startedAt = Math.round(start.t * 1000)
  const endedAt = end ? Math.round(end.t * 1000) : now

  return {
    id,
    pid: start.pid,
    args: start.args,
    startedAt,
    phase: end ? 'done' : total === null ? 'collecting' : 'running',
    total,
    counts,
    failures,
    elapsedMs: Math.max(0, endedAt - startedAt),
    exitStatus: end ? end.x : null,
    files: files(perFile, outcomes, isOver ? new Map() : running),
    current: !isOver && oldest ? { nodeid: oldest[0], startedAt: oldest[1] } : null,
  }
}

const fileOf = (nodeid: string) => nodeid.split('::')[0] ?? nodeid

/** Each file's progress, in collection order, then files seen only through results. */
function files(
  perFile: Record<string, number>,
  outcomes: Map<string, PytestOutcome>,
  running: Map<string, number>,
): PytestFile[] {
  const byPath = new Map<string, PytestFile>()
  const fileFor = (path: string) => {
    let file = byPath.get(path)
    if (!file) {
      file = { path, total: perFile[path] ?? null, done: 0, failed: 0, isRunning: false }
      byPath.set(path, file)
    }
    return file
  }
  for (const path of Object.keys(perFile)) fileFor(path)
  for (const [nodeid, outcome] of outcomes) {
    const file = fileFor(fileOf(nodeid))
    file.done += 1
    if (outcome === 'failed' || outcome === 'error') file.failed += 1
  }
  for (const nodeid of running.keys()) fileFor(fileOf(nodeid)).isRunning = true
  return [...byPath.values()]
}

/** Files that failed to import: their error is reported under the file's path, with no `::test`. */
export const collectionErrors = (run: PytestRun) => run.failures.filter(f => !f.nodeid.includes('::')).length

export const doneCount = (run: PytestRun) =>
  Object.values(run.counts).reduce((sum, n) => sum + n, 0)

export function summary(run: PytestRun): string {
  const parts: string[] = []
  const { counts } = run
  const broken = collectionErrors(run)
  const testErrors = counts.error - broken
  if (broken) parts.push(`${broken} collection error${broken === 1 ? '' : 's'}`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
  if (testErrors) parts.push(`${testErrors} error${testErrors === 1 ? '' : 's'}`)
  // after a collection error pytest runs nothing, so "0 passed" would read as a result
  if (counts.passed || !broken) parts.push(`${counts.passed} passed`)
  if (counts.skipped) parts.push(`${counts.skipped} skipped`)
  if (counts.xfailed) parts.push(`${counts.xfailed} xfailed`)
  if (counts.xpassed) parts.push(`${counts.xpassed} xpassed`)
  return parts.join(', ')
}

/** pytest's exit codes: 0 all passed, 1 some failed, 2 interrupted, 5 no tests. */
export function verdict(run: PytestRun): { label: string; isGood: boolean } {
  if (run.phase === 'lost') return { label: 'stopped', isGood: false }
  if (run.exitStatus !== null && collectionErrors(run) > 0) return { label: 'collection failed', isGood: false }
  if (run.counts.failed > 0 || run.counts.error > 0) return { label: 'failed', isGood: false }
  switch (run.exitStatus) {
    case 0:
      return { label: 'passed', isGood: true }
    case 2:
      return { label: 'interrupted', isGood: false }
    case 5:
      return { label: 'no tests', isGood: false }
    default:
      return { label: run.exitStatus === null ? 'running' : 'error', isGood: false }
  }
}

export function duration(ms: number): string {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

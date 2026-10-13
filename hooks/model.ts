import type { PytestFile, PytestRun } from '../types'
import { collectionErrors, doneCount, duration, FAILURES_PER_FILE, verdict } from './fold'

/** Theme keys the pane draws with, so colours follow the app's light and dark themes. */
export type Tone = 'error' | 'success' | 'warning' | 'claude'

export type Count = { n: number; word: string; tone: Tone; isBold: boolean }

export type FailureModel = { name: string; message: string; isError: boolean }

export type FileModel = {
  path: string
  /** the path without the folder every file shares, nor `test_` and `.py` */
  label: string
  done: number
  total: number
  failed: number
  /** `notRun`: the run is over and never reached the file's remaining tests */
  state: 'failed' | 'running' | 'done' | 'queued' | 'notRun'
  failures: FailureModel[]
  moreFailures: number
}

export type PaneModel = {
  tone: Tone
  verdict: string
  command: string
  progress: string
  /** 0..1, for the status ring */
  fraction: number
  counts: Count[]
  bar: { failed: number; passed: number; skipped: number; total: number }
  files: FileModel[]
  current: { name: string; seconds: string; isSlow: boolean } | null
  isCollecting: boolean
  isLost: boolean
}

const SLOW_MS = 5_000

/** Strips terminal escapes and control characters, which a drawn tree refuses. */
export const clean = (text: string) =>
  text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .trim()

/** Cuts from the left, keeping the end of a path or test name. */
export const cutLeft = (text: string, room: number) => {
  const chars = [...text]
  return chars.length <= room ? text : '…' + chars.slice(chars.length - Math.max(1, room - 1)).join('')
}

/** A test file's name as a row shows it: `api/test_routes.py` becomes `api/routes`. */
export function shortLabel(path: string): string {
  const slash = path.lastIndexOf('/')
  const dir = path.slice(0, slash + 1)
  const base = path.slice(slash + 1).replace(/\.py$/, '')
  const bare = base.replace(/^test_/, '').replace(/_test$/, '')
  return dir + (bare === '' ? base : bare)
}

/** The directory every file shares, so rows show only what tells them apart. */
export function sharedDir(paths: string[]): string {
  if (paths.length === 0) return ''
  const split = paths.map(p => p.split('/').slice(0, -1))
  const first = split[0] ?? []
  let depth = 0
  while (depth < first.length && split.every(parts => parts[depth] === first[depth])) depth += 1
  return depth === 0 ? '' : first.slice(0, depth).join('/') + '/'
}

function stateOf(file: PytestFile, isOver: boolean): FileModel['state'] {
  if (file.failed > 0) return 'failed'
  if (file.isRunning) return 'running'
  if (file.total === null || file.done >= file.total) return 'done'
  return isOver ? 'notRun' : 'queued'
}

const RANK: Record<FileModel['state'], number> = { failed: 0, running: 1, done: 2, queued: 3, notRun: 4 }

/** Everything the pane shows for a run, worked out once, independent of how it is drawn. */
export function paneModel(run: PytestRun, now: number): PaneModel {
  const { counts } = run
  const isCollecting = run.phase === 'collecting'
  const isRunning = run.phase === 'running'
  const { label, isGood } = verdict(run)
  const failedN = counts.failed + counts.error
  const tone: Tone = failedN > 0 ? 'error' : isCollecting || isRunning ? 'claude' : isGood ? 'success' : 'warning'
  const isOver = run.phase === 'done' || run.phase === 'lost'
  // a collection error is reported like a result, but no test ran
  const done = doneCount(run) - collectionErrors(run)
  const total = run.total ?? done

  const list: Count[] = []
  const add = (n: number, word: string, t: Tone, isBold = false) => n > 0 && list.push({ n, word, tone: t, isBold })
  add(counts.failed, 'failed', 'error', true)
  const broken = collectionErrors(run)
  add(broken, broken === 1 ? 'collection error' : 'collection errors', 'error', true)
  add(counts.error - broken, counts.error - broken === 1 ? 'error' : 'errors', 'error', true)
  add(counts.xpassed, 'xpassed', 'warning')
  add(counts.skipped, 'skipped', 'warning')
  add(counts.xfailed, 'xfailed', 'warning')
  if (counts.passed > 0 || broken === 0) list.push({ n: counts.passed, word: 'passed', tone: 'success', isBold: false })

  const prefix = sharedDir((run.files ?? []).map(f => f.path))
  const files: FileModel[] = (run.files ?? [])
    .map(file => {
      const failures = run.failures.filter(f => f.nodeid.startsWith(`${file.path}::`) || f.nodeid === file.path)
      return {
        path: file.path,
        label: clean(shortLabel(file.path.slice(prefix.length))),
        done: file.done,
        total: file.total ?? file.done,
        failed: file.failed,
        state: stateOf(file, isOver),
        failures: failures.slice(0, FAILURES_PER_FILE).map(f => ({
          name: clean(f.nodeid.slice(file.path.length + 2) || f.nodeid),
          message: clean(f.message),
          isError: f.outcome === 'error',
        })),
        // from the file's own count: details are kept for only the first few failures
        moreFailures: Math.max(0, file.failed - Math.min(failures.length, FAILURES_PER_FILE)),
      }
    })
    .map((file, index) => ({ file, index }))
    .sort((a, b) => RANK[a.file.state] - RANK[b.file.state] || a.index - b.index)
    .map(({ file }) => file)

  let current: PaneModel['current'] = null
  if (isRunning && run.current) {
    const ms = Math.max(0, now - run.current.startedAt)
    current = {
      name: clean(run.current.nodeid.split('::').slice(1).join('::') || run.current.nodeid),
      seconds: `${(ms / 1000).toFixed(1)}s`,
      isSlow: ms >= SLOW_MS,
    }
  }

  return {
    tone,
    verdict: isCollecting ? 'Collecting' : isRunning ? 'Running' : label.charAt(0).toUpperCase() + label.slice(1),
    command: clean(['pytest', ...run.args].join(' ')),
    progress: isCollecting
      ? duration(run.elapsedMs)
      : isOver && done === 0 && broken > 0
        ? `nothing ran · ${duration(run.elapsedMs)}`
        : `${done}/${total} · ${duration(run.elapsedMs)}`,
    fraction: total > 0 ? Math.min(1, done / total) : isCollecting ? 0 : 1,
    counts: list,
    bar: {
      failed: failedN,
      passed: counts.passed + counts.xpassed,
      skipped: counts.skipped + counts.xfailed,
      total,
    },
    files,
    current,
    isCollecting,
    isLost: run.phase === 'lost',
  }
}

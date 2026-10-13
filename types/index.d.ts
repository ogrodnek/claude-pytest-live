export type PytestOutcome = 'passed' | 'failed' | 'skipped' | 'error' | 'xfailed' | 'xpassed'

export type PytestFailure = { nodeid: string; outcome: 'failed' | 'error'; message: string }

export type PytestFile = {
  path: string
  /** null for a file seen only through its results (an older run's file) */
  total: number | null
  done: number
  failed: number
  isRunning: boolean
}

export type PytestRun = {
  id: string
  pid: number
  args: string[]
  startedAt: number
  phase: 'collecting' | 'running' | 'done' | 'lost'
  total: number | null
  counts: { [K in PytestOutcome]: number }
  failures: PytestFailure[]
  elapsedMs: number
  exitStatus: number | null
  /** in collection order; absent on runs folded before this field existed */
  files?: PytestFile[]
  /** the test that has been running longest */
  current?: { nodeid: string; startedAt: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    'pytest-live': { runs: PytestRun[]; isMuted: boolean }
  }
}

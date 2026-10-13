import { describe, expect, test } from 'claude-code/testing'

import { fold, summary } from './fold'
import { clean, cutLeft, paneModel, sharedDir, shortLabel } from './model'

const lines = (...events: object[]) => events.map(e => JSON.stringify(e)).join('\n') + '\n'

const RUNNING = lines(
  { e: 'start', pid: 7, args: ['tests/', '-n', '4'], t: 100 },
  { e: 'collected', n: 6, f: { 'tests/api/test_a.py': 2, 'tests/db/test_b.py': 3, 'tests/db/test_c.py': 1 }, t: 101 },
  { e: 's', id: 'tests/api/test_a.py::test_one', t: 101 },
  { e: 'r', id: 'tests/api/test_a.py::test_one', o: 'passed', d: 0.1, t: 101.1 },
  { e: 's', id: 'tests/db/test_b.py::test_pool', t: 101.2 },
  { e: 'r', id: 'tests/db/test_b.py::test_pool', o: 'error', d: 0, m: "\u001b[31mfixture 'pg'\u001b[0m refused", t: 101.3 },
  { e: 's', id: 'tests/db/test_b.py::test_slow', t: 101.4 },
)

describe('model', () => {
  test('fold counts each file and keeps the longest-running test', () => {
    const run = fold('r', RUNNING, 110_000)!

    expect(run.files).toEqual([
      { path: 'tests/api/test_a.py', total: 2, done: 1, failed: 0, isRunning: false },
      { path: 'tests/db/test_b.py', total: 3, done: 1, failed: 1, isRunning: true },
      { path: 'tests/db/test_c.py', total: 1, done: 0, failed: 0, isRunning: false },
    ])
    expect(run.current).toEqual({ nodeid: 'tests/db/test_b.py::test_slow', startedAt: 101_400 })
  })

  test('failing files sort first, with cleaned messages and the shared folder dropped', () => {
    const m = paneModel(fold('r', RUNNING, 110_000)!, 110_000)

    expect(m.files.map(f => [f.label, f.state])).toEqual([
      ['db/b', 'failed'],
      ['api/a', 'queued'],
      ['db/c', 'queued'],
    ])
    expect(m.files[0]!.failures).toEqual([{ name: 'test_pool', message: "fixture 'pg' refused", isError: true }])
  })

  test('the header reads worst first and the running test is slow past 5s', () => {
    const m = paneModel(fold('r', RUNNING, 110_000)!, 110_000)

    expect(m.tone).toBe('error')
    expect(m.verdict).toBe('Running')
    expect(m.progress).toBe('2/6 · 10s')
    expect(m.counts.map(c => `${c.n} ${c.word}`)).toEqual(['1 error', '1 passed'])
    expect(m.current).toEqual({ name: 'test_slow', seconds: '8.6s', isSlow: true })
  })

  test('every failing file keeps its first failures, and +N more counts the rest', () => {
    const failing = (file: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ e: 'r', id: `${file}::test_${i}`, o: 'failed', d: 0, m: `boom ${i}`, t: 2 }))
    const run = fold(
      'r',
      lines(
        { e: 'start', pid: 1, args: [], t: 0 },
        { e: 'collected', n: 62, f: { 'tests/test_a.py': 60, 'tests/test_b.py': 2 }, t: 1 },
        ...failing('tests/test_a.py', 60),
        ...failing('tests/test_b.py', 2),
        { e: 'end', x: 1, t: 3 },
      ),
      3_000,
    )!

    expect(run.failures).toHaveLength(5)
    const m = paneModel(run, 3_000)
    expect(m.files.map(f => [f.label, f.failed, f.failures.length, f.moreFailures])).toEqual([
      ['a', 60, 3, 57],
      ['b', 2, 2, 0],
    ])
  })

  test('a collection error says nothing ran, and the other files were not run', () => {
    const run = fold(
      'r',
      lines(
        { e: 'start', pid: 1, args: ['tests/'], t: 0 },
        { e: 'r', id: 'tests/test_bad.py', o: 'error', d: 0, m: "ImportError: cannot import name 'backoff'", t: 1 },
        { e: 'collected', n: 5, f: { 'tests/test_a.py': 3, 'tests/test_b.py': 2 }, t: 1 },
        { e: 'end', x: 2, t: 1.4 },
      ),
      2_000,
    )!
    const m = paneModel(run, 2_000)

    expect(m.verdict).toBe('Collection failed')
    expect(m.tone).toBe('error')
    expect(m.progress).toBe('nothing ran · 1s')
    expect(m.counts.map(c => `${c.n} ${c.word}`)).toEqual(['1 collection error'])
    expect(m.files.map(f => [f.label, f.state])).toEqual([
      ['bad', 'failed'],
      ['a', 'notRun'],
      ['b', 'notRun'],
    ])
    expect(summary(run)).toBe('1 collection error')
  })

  test('a run stopped early by -x leaves the files it never reached as not run', () => {
    const run = fold(
      'r',
      lines(
        { e: 'start', pid: 1, args: ['-x'], t: 0 },
        { e: 'collected', n: 4, f: { 'tests/test_a.py': 2, 'tests/test_b.py': 2 }, t: 0.5 },
        { e: 'r', id: 'tests/test_a.py::test_one', o: 'failed', d: 0, m: 'assert 1 == 2', t: 1 },
        { e: 'end', x: 1, t: 1.2 },
      ),
      2_000,
    )!
    const m = paneModel(run, 2_000)

    expect(m.verdict).toBe('Failed')
    expect(m.progress).toBe('1/4 · 1s')
    expect(m.files.map(f => [f.label, f.state])).toEqual([
      ['a', 'failed'],
      ['b', 'notRun'],
    ])
  })

  test('helpers', () => {
    expect(clean('\u001b[1mok\u001b[0m\r\n')).toBe('ok')
    expect(cutLeft('tests/very/long/path.py', 10)).toBe('…g/path.py')
    expect(sharedDir(['tests/a/x.py', 'tests/b/y.py'])).toBe('tests/')
    expect(sharedDir(['tests/a/x.py'])).toBe('tests/a/')
    expect(shortLabel('api/test_routes.py')).toBe('api/routes')
    expect(shortLabel('conftest_test.py')).toBe('conftest')
    expect(shortLabel('test_.py')).toBe('test_')
  })
})

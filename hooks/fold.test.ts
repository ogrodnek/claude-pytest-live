import { describe, expect, test } from 'claude-code/testing'

import { doneCount, fold, summary, verdict } from './fold'

const lines = (...events: object[]) => events.map(e => JSON.stringify(e)).join('\n') + '\n'

describe('fold', () => {
  test('a run in progress counts outcomes and tracks running tests', () => {
    const text = lines(
      { e: 'start', pid: 42, args: ['tests', '-x'], t: 100 },
      { e: 'collected', n: 4, t: 100.5 },
      { e: 's', id: 'a', t: 101 },
      { e: 'r', id: 'a', o: 'passed', d: 0.1, t: 101.1 },
      { e: 's', id: 'b', t: 101.2 },
      { e: 'r', id: 'b', o: 'failed', d: 0.2, m: 'assert 1 == 2', t: 101.4 },
      { e: 's', id: 'c', t: 101.5 },
    ) + '{"e":"r","id":"c"' // half-written line

    const run = fold('f.jsonl', text, 103_000)!

    expect(run.phase).toBe('running')
    expect(run.total).toBe(4)
    expect(doneCount(run)).toBe(2)
    expect(run.current?.nodeid).toBe('c')
    expect(run.failures).toEqual([{ nodeid: 'b', outcome: 'failed', message: 'assert 1 == 2' }])
    expect(run.elapsedMs).toBe(3_000)
    expect(verdict(run).label).toBe('failed')
  })

  test('a teardown error after a pass counts once, as an error', () => {
    const text = lines(
      { e: 'start', pid: 1, args: [], t: 0 },
      { e: 'collected', n: 1, t: 0 },
      { e: 'r', id: 'tests/test_a.py::test_one', o: 'passed', d: 0, t: 1 },
      { e: 'r', id: 'tests/test_a.py::test_one', o: 'error', d: 0, m: 'teardown boom', t: 1 },
      { e: 'end', x: 1, t: 2 },
    )

    const run = fold('f', text, 9_999)!

    expect(run.counts.passed).toBe(0)
    expect(run.counts.error).toBe(1)
    expect(run.phase).toBe('done')
    expect(run.elapsedMs).toBe(2_000)
    expect(summary(run)).toBe('1 error, 0 passed')
  })

  test('a clean finish is good', () => {
    const text = lines(
      { e: 'start', pid: 1, args: [], t: 0 },
      { e: 'collected', n: 1, t: 0 },
      { e: 'r', id: 'a', o: 'passed', d: 0, t: 1 },
      { e: 'end', x: 0, t: 1 },
    )

    expect(verdict(fold('f', text, 0)!)).toEqual({ label: 'passed', isGood: true })
  })

  test('no start line yet means no run', () => {
    expect(fold('f', '', 0)).toBe(null)
  })
})

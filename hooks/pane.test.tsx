import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { PytestRun } from '../types'
import { fold } from './fold'
import { bar, ring } from './svg'

const lines = (...events: object[]) => events.map(e => JSON.stringify(e)).join('\n') + '\n'

const RUN: PytestRun = fold(
  '1-1.jsonl',
  lines(
    { e: 'start', pid: 1, args: ['tests/'], t: 0 },
    { e: 'collected', n: 3, f: { 'tests/test_a.py': 2, 'tests/test_b.py': 1 }, t: 0.5 },
    { e: 'r', id: 'tests/test_a.py::test_ok', o: 'passed', d: 0.1, t: 1 },
    { e: 'r', id: 'tests/test_a.py::test_lt', o: 'failed', d: 0.1, m: 'assert 1 < 0', t: 2 },
    { e: 'r', id: 'tests/test_b.py::test_ok', o: 'passed', d: 0.1, t: 3 },
    { e: 'end', x: 1, t: 3.2 },
  ),
  9_999,
)!

const PANE = {
  component: 'Pane',
  requestId: 'pytest-live',
  props: {
    title: 'pytest',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const withRuns = (on: On, runs: PytestRun[]) =>
  on('state.get', { plugin: 'pytest-live', key: 'runs' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    return { value: { ...result.value, value: runs } }
  })

describe('svg', () => {
  test('the ring and bar draw their tracks in the theme text colour', () => {
    expect(ring(0.5, 'claude')).toContain('stroke="currentColor"')
    expect(ring(0.5, 'claude')).toContain('stroke-dasharray="50.0 100"')
    const drawn = bar([{ value: 1, tone: 'error' }, { value: 2, tone: 'success' }], 4, 100, 6)
    expect(drawn).toContain('fill="currentColor"')
    expect(drawn).toContain('x="0.0" width="25.0"')
    expect(drawn).toContain('x="25.0" width="50.0"')
  })
})

describe('pane', () => {
  test('one native tree: text on the terminal, the same plus small images on desktop', async ($, on) => {
    withRuns(on, [RUN])
    mock.clock(on, { now: 9_999 })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'pytest-live', surface, ...PANE })
      expect(await ui.find({ type: 'Text', text: /^Failed$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^1 failed$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /test_lt/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /assert 1 < 0/ })).toBeDefined()
      const svg = await ui.find({ type: 'Svg' })
      if (surface === 'terminal') expect(svg).toBeUndefined()
      else expect(svg).toBeDefined()
      await ui.unmount()
    }
  })

  test('with no runs, says what will appear', async ($, on) => {
    withRuns(on, [])
    mock.clock(on, { now: 0 })

    const ui = await $.ui.mount({ plugin: 'pytest-live', surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Text', text: /No pytest runs yet/ })).toBeDefined()
  })
})

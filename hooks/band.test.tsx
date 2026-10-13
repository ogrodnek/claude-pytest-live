import type { On, UiPane } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { PytestRun } from '../types'

const RUN: PytestRun = {
  id: '1-1.jsonl',
  pid: 1,
  args: ['tests/ws'],
  startedAt: 0,
  phase: 'done',
  total: 39,
  counts: { passed: 36, failed: 3, skipped: 0, error: 0, xfailed: 0, xpassed: 0 },
  failures: [],
  elapsedMs: 90,
  exitStatus: 1,
}

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

/** The mod reads these runs from its state, as after a pytest run it folded. */
const withRuns = (on: On, runs: PytestRun[]) =>
  on('state.get', { plugin: 'pytest-live', key: 'runs' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    return { value: { ...result.value, value: runs } }
  })

/** The mod reads itself as muted, as after the person closed its pane. */
const withMuted = (on: On) =>
  on('state.get', { plugin: 'pytest-live', key: 'isMuted' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    return { value: { ...result.value, value: true } }
  })

/** Stands in for the engine's own band, drawn when the mod hands the band on. */
const withEngineBand = (on: On) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

const pane = (isPlaced: boolean): UiPane => ({
  id: 'pytest-live',
  title: 'pytest',
  isShown: true,
  isFocused: false,
  isPlaced,
})

describe('band', () => {
  test('offers the pane while the one the mod opened waits undrawn', async ($, on) => {
    const opened: string[] = []
    on('ui.panes', () => ({ value: [pane(false)] }))
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    withRuns(on, [RUN])

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'pytest-live', surface, ...BAND })
      expect((await ui.find({ type: 'Text', text: /3 failed, 36 passed/ }))?.text).toContain('✗ failed')
      await ui.press({ key: 'open' })
      await ui.unmount()
    }
    expect(opened).toEqual(['pytest-live', 'pytest-live'])
  })

  test('stays out of the way while the pane is drawn', async ($, on) => {
    on('ui.panes', () => ({ value: [pane(true)] }))
    withRuns(on, [RUN])
    withEngineBand(on)

    const ui = await $.ui.mount({ plugin: 'pytest-live', surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'open' })).toBeUndefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
  })

  test('stays out of the way when the pane is not open at all', async ($, on) => {
    on('ui.panes', () => ({ value: [] }))
    withRuns(on, [RUN])
    withEngineBand(on)

    const ui = await $.ui.mount({ plugin: 'pytest-live', surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'open' })).toBeUndefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
  })

  test('while muted, offers the pane after a recent run', async ($, on) => {
    const opened: string[] = []
    on('ui.panes', () => ({ value: [] }))
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    withRuns(on, [RUN])
    withMuted(on)
    mock.clock(on, { now: 1_000 })

    const ui = await $.ui.mount({ plugin: 'pytest-live', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Text', text: /3 failed, 36 passed/ }))?.text).toContain('✗ failed')
    await ui.press({ key: 'open' })
    expect(opened).toEqual(['pytest-live'])
  })

  test('a run still going shows neither ✓ nor ✗', async ($, on) => {
    const running: PytestRun = {
      ...RUN,
      phase: 'running',
      exitStatus: null,
      counts: { ...RUN.counts, failed: 0, passed: 12 },
    }
    on('ui.panes', () => ({ value: [] }))
    withRuns(on, [running])
    withMuted(on)
    mock.clock(on, { now: 1_000 })

    const ui = await $.ui.mount({ plugin: 'pytest-live', surface: 'terminal', ...BAND })
    const line = (await ui.find({ type: 'Text', text: /12 passed/ }))?.text
    expect(line).toContain('▸ running')
    expect(line).not.toContain('✗')
  })

  test('while muted, stops offering once the run is no longer recent', async ($, on) => {
    on('ui.panes', () => ({ value: [] }))
    withRuns(on, [RUN])
    withMuted(on)
    withEngineBand(on)
    mock.clock(on, { now: 120_000 })

    const ui = await $.ui.mount({ plugin: 'pytest-live', surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'open' })).toBeUndefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
  })
})

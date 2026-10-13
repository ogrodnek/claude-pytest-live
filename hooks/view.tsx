import type { Elements, RenderElement } from 'claude-code'

import { cutLeft, type FileModel, type PaneModel, type Tone } from './model'
import { bar, ring } from './svg'

/**
 * The elements and room the pane draws with. `Svg` is present only where the surface
 * has it (not the terminal), and then the ring and bars are drawn as small images.
 */
export type Kit = {
  Box: Elements['terminal']['Box']
  Text: Elements['terminal']['Text']
  Svg?: Elements['desktop']['Svg']
  columns: number
  rows: number
}

// Columns, in cells: the status mark; counts and the failure tail are sized to what
// the files need. A file's progress is drawn behind its name, not in a column.
const MARK = 2
const CELL_PX = 7.9
// The app's sans font averages narrower than one cell, so names get more characters there.
const SANS_PER_CELL = 1.25
const MAX_FILES_SCROLLED = 60

const GLYPH: Record<FileModel['state'], { glyph: string; tone?: Tone }> = {
  failed: { glyph: '✗', tone: 'error' },
  running: { glyph: '▸', tone: 'claude' },
  done: { glyph: '✓', tone: 'success' },
  queued: { glyph: '·' },
  notRun: { glyph: '–' },
}
/**
 * The tint behind a file's row, as wide as its progress: green while it runs, red once
 * a test in it failed, a neutral surface when it is done. The terminal has no neutral
 * surface key, so a finished file there is left untinted (its ✓ says it is done).
 */
function tintOf(file: FileModel, hasSurfaces: boolean): string | undefined {
  if (file.state === 'failed') return 'diffRemovedDimmed'
  if (file.state === 'running') return 'diffAddedDimmed'
  if (file.state === 'done') return hasSurfaces ? 'userMessageBackground' : undefined
  return undefined
}

/** A bar drawn in text: filled cells in the tone, the rest a dim track. */
function textBar(kit: Kit, parts: { value: number; tone: Tone }[], total: number, cells: number): RenderElement {
  const { Text } = kit
  let used = 0
  const filled = parts.map(p => {
    const n = total > 0 ? Math.min(cells - used, Math.round((p.value / total) * cells)) : 0
    used += n
    return { n, tone: p.tone }
  })
  return (
    <Text>
      {filled.filter(f => f.n > 0).map(f => <Text color={f.tone}>{'━'.repeat(f.n)}</Text>)}
      <Text dimColor>{'─'.repeat(Math.max(0, cells - used))}</Text>
    </Text>
  )
}

function header(kit: Kit, m: PaneModel): RenderElement {
  const { Box, Text, Svg } = kit
  return (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      <Box flexShrink={0} alignItems="center">
        {Svg ? (
          <Svg source={ring(m.fraction, m.tone)} alt={`${Math.round(m.fraction * 100)}% done`} width={14} height={14} />
        ) : (
          <Text color={m.tone}>●</Text>
        )}
      </Box>
      <Box flexShrink={0}>
        <Text bold color={m.tone}>{m.verdict}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text dimColor wrap="truncate-end">{m.command}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text dimColor>{m.progress}</Text>
      </Box>
    </Box>
  )
}

function counts(kit: Kit, m: PaneModel): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {m.counts.map(c => (
        <Text color={c.tone} bold={c.isBold}>{`${c.n} ${c.word}`}</Text>
      ))}
    </Box>
  )
}

function overallBar(kit: Kit, m: PaneModel): RenderElement {
  const { Box, Svg } = kit
  const parts = [
    { value: m.bar.failed, tone: 'error' as const },
    { value: m.bar.passed, tone: 'success' as const },
    { value: m.bar.skipped, tone: 'warning' as const },
  ]
  if (Svg) {
    const width = Math.max(40, Math.floor(kit.columns * CELL_PX) - 4)
    return (
      <Box marginTop={1}>
        <Svg source={bar(parts, m.bar.total, width, 6)} alt={`${m.progress} done`} width={width} height={6} />
      </Box>
    )
  }
  return <Box>{textBar(kit, parts, m.bar.total, kit.columns)}</Box>
}

function sectionTitle(kit: Kit, title: string, note: string): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="row" columnGap={1} marginTop={1}>
      <Text bold color="suggestion">{title}</Text>
      <Text dimColor>{note}</Text>
    </Box>
  )
}

/** A row's count: `done/total`, or `not run` for a file the run never reached. */
const countText = (file: FileModel) =>
  file.state === 'notRun' && file.done === 0 ? 'not run' : `${file.done}/${file.total}`

/** Widths every file row shares, sized to the widest count and failure tail. */
type RowWidths = { count: number; tail: number; name: number }

function rowWidths(kit: Kit, files: FileModel[]): RowWidths {
  const count = Math.max(3, ...files.map(f => countText(f).length))
  const tail = files.some(f => f.failed > 0) ? Math.max(...files.map(f => `✗${f.failed}`.length)) : 0
  const gaps = (tail > 0 ? 3 : 2) + 2
  const cells = Math.max(8, kit.columns - (MARK + count + tail + gaps))
  return { count, tail, name: cells }
}

function fileRow(kit: Kit, file: FileModel, widths: RowWidths): RenderElement {
  const { Box, Text, Svg } = kit
  const { glyph, tone } = GLYPH[file.state]
  const isQuiet = file.state === 'done' || file.state === 'queued' || file.state === 'notRun'
  const share = file.total > 0 ? Math.min(1, file.done / file.total) : 1
  const tint = tintOf(file, Svg !== undefined)

  const mark = (
    <Box width={MARK} flexShrink={0}>
      {tone ? <Text color={tone} bold={file.state === 'failed'}>{glyph}</Text> : <Text dimColor>{glyph}</Text>}
    </Box>
  )
  const tailCells = [
    <Box width={widths.count} flexShrink={0} justifyContent="flex-end">
      <Text dimColor>{countText(file)}</Text>
    </Box>,
    widths.tail > 0 && (
      <Box width={widths.tail} flexShrink={0}>
        <Text color="error" bold>{file.failed > 0 ? `✗${file.failed}` : ' '}</Text>
      </Box>
    ),
  ]

  if (Svg) {
    // The tint is an absolute layer behind the row. The content sits in a Box that holds an
    // empty absolute child: that makes the app position it, so it paints above the tint.
    const name = cutLeft(file.label, Math.floor(widths.name * SANS_PER_CELL))
    return (
      <Box key={`f:${file.path}`} flexDirection="row">
        {tint !== undefined && share > 0 && (
          <Box
            position="absolute"
            top={0}
            left={0}
            bottom={0}
            width={`${Math.round(share * 100)}%`}
            backgroundColor={tint}
            borderStyle="single"
            borderColor={tint}
          />
        )}
        <Box flexDirection="row" alignItems="center" columnGap={1} flexGrow={1} minWidth={0} paddingX={1}>
          <Box position="absolute" top={0} left={0} />
          {mark}
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end" dimColor={isQuiet}>{name}</Text>
          </Box>
          {tailCells}
        </Box>
      </Box>
    )
  }

  // The terminal is monospace: pad the name to its column and tint the first cells.
  const name = cutLeft(file.label, widths.name).padEnd(widths.name)
  const filled = tint === undefined ? 0 : Math.round(share * widths.name)
  return (
    <Box key={`f:${file.path}`} flexDirection="row" columnGap={1}>
      {mark}
      <Box width={widths.name} flexShrink={0}>
        <Text dimColor={isQuiet}>
          {filled > 0 && <Text backgroundColor={tint}>{name.slice(0, filled)}</Text>}
          {name.slice(filled)}
        </Text>
      </Box>
      {tailCells}
    </Box>
  )
}

/** A file's failures, indented under its name: the test in red, its message dim below. */
function failureBlock(kit: Kit, file: FileModel): RenderElement | null {
  const { Box, Text, Svg } = kit
  if (file.failures.length === 0) return null
  const room = Math.max(8, kit.columns - 8)
  return (
    // on desktop the row has a 1-cell inset for its tint, so the names line up one cell further in
    <Box flexDirection="column" marginLeft={MARK + 1 + (Svg ? 1 : 0)}>
      {file.failures.map(f => (
        <Box flexDirection="column">
          <Text color="error" wrap="truncate-end">{`${f.isError ? 'E' : '✗'} ${cutLeft(f.name, room)}`}</Text>
          {f.message !== '' && <Text dimColor wrap="truncate-end">{`  ${f.message}`}</Text>}
        </Box>
      ))}
      {file.moreFailures > 0 && <Text dimColor>{`+${file.moreFailures} more`}</Text>}
    </Box>
  )
}

function currentRow(kit: Kit, m: PaneModel): RenderElement | null {
  const { Box, Text } = kit
  if (m.isLost) {
    return (
      <Box marginTop={1} columnGap={1}>
        <Text color="warning" bold>!</Text>
        <Text color="warning">pytest ended without a summary</Text>
      </Box>
    )
  }
  if (m.isCollecting || m.current === null) return null
  return (
    <Box flexDirection="row" marginTop={1} columnGap={1}>
      <Box width={MARK} flexShrink={0}>
        <Text color="claude">▸</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">{cutLeft(m.current.name, Math.max(8, kit.columns - 16))}</Text>
      </Box>
      <Box flexShrink={0} columnGap={1}>
        <Text dimColor>{m.current.seconds}</Text>
        {m.current.isSlow && <Text color="warning" bold>SLOW</Text>}
      </Box>
    </Box>
  )
}

/** How many files fit: the terminal has a fixed height, other surfaces scroll the pane. */
function filesThatFit(kit: Kit, m: PaneModel): number {
  if (kit.Svg) return Math.min(m.files.length, MAX_FILES_SCROLLED)
  let budget = kit.rows - 8
  let n = 0
  for (const file of m.files) {
    const cost = 1 + file.failures.length * 2 + (file.moreFailures > 0 ? 1 : 0)
    if (cost > budget) break
    budget -= cost
    n += 1
  }
  return Math.max(1, n)
}

export function paneView(kit: Kit, m: PaneModel): RenderElement {
  const { Box, Text } = kit
  const shown = filesThatFit(kit, m)
  const widths = rowWidths(kit, m.files)
  const doneFiles = m.files.filter(f => f.state === 'done' || f.state === 'failed').length
  return (
    <Box flexDirection="column">
      {header(kit, m)}
      {m.isCollecting ? (
        <Text dimColor>Collecting tests…</Text>
      ) : (
        <Box flexDirection="column">
          {counts(kit, m)}
          {overallBar(kit, m)}
          {m.files.length > 0 && sectionTitle(kit, 'Files', `${doneFiles}/${m.files.length}`)}
          {m.files.slice(0, shown).map(file => (
            <Box flexDirection="column">
              {fileRow(kit, file, widths)}
              {failureBlock(kit, file)}
            </Box>
          ))}
          {shown < m.files.length && <Text dimColor>{`+${m.files.length - shown} more files`}</Text>}
          {currentRow(kit, m)}
        </Box>
      )}
    </Box>
  )
}

export function emptyView(kit: Kit): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={Math.max(4, kit.rows - 2)}>
      <Text dimColor>No pytest runs yet</Text>
      <Text dimColor>Tests Claude runs show up here live</Text>
    </Box>
  )
}

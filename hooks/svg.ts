import type { Tone } from './model'

// Mid-tone fills that read on light and dark; tracks use currentColor, which the
// desktop app sets to its own text colour, so they follow the app's theme.
export const HEX: Record<Tone, string> = {
  error: '#d1453b',
  success: '#2e9e5b',
  warning: '#c98a00',
  claude: '#d97757',
}

const SVG = 'xmlns="http://www.w3.org/2000/svg"'

/** A small progress ring: a faint track and an arc for the share done. */
export function ring(fraction: number, tone: Tone, size = 14): string {
  const r = 6
  const arc =
    fraction >= 1
      ? `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${HEX[tone]}" stroke-width="2.5"/>`
      : fraction > 0
        ? `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${HEX[tone]}" stroke-width="2.5" stroke-linecap="round" pathLength="100" stroke-dasharray="${Math.max(2, fraction * 100).toFixed(1)} 100" transform="rotate(-90 8 8)"/>`
        : ''
  return `<svg ${SVG} width="${size}" height="${size}" viewBox="0 0 16 16"><circle cx="8" cy="8" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="2.5"/>${arc}</svg>`
}

export type BarPart = { value: number; tone: Tone }

/** A rounded bar on a faint track, its parts laid end to end out of `total`. */
export function bar(parts: BarPart[], total: number, width: number, height: number): string {
  // a slight rounding, to match the row tints' corners
  const r = Math.min(2, height / 2)
  let x = 0
  const fills = parts
    .filter(p => p.value > 0 && total > 0)
    .map(p => {
      const w = (Math.min(p.value, total) / total) * width
      const rect = `<rect x="${x.toFixed(1)}" width="${w.toFixed(1)}" height="${height}" fill="${HEX[p.tone]}"/>`
      x += w
      return rect
    })
    .join('')
  return (
    `<svg ${SVG} width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<clipPath id="c"><rect width="${width}" height="${height}" rx="${r}"/></clipPath>` +
    `<g clip-path="url(#c)"><rect width="${width}" height="${height}" fill="currentColor" fill-opacity=".14"/>${fills}</g></svg>`
  )
}

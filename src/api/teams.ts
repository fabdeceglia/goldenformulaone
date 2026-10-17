/**
 * Approximate team colours, keyed by Ergast `constructorId`.
 * Used only as a visual accent, so a generic grey fallback is fine.
 */
const TEAM_COLORS: Record<string, string> = {
  // Current era
  red_bull: '#3671C6',
  ferrari: '#E8002D',
  mclaren: '#FF8000',
  mercedes: '#27F4D2',
  aston_martin: '#229971',
  alpine: '#0093CC',
  williams: '#64C4FF',
  rb: '#6692FF',
  sauber: '#52E252',
  haas: '#B6BABD',
  audi: '#F50537',
  cadillac: '#C9A227',
  // Recent history
  alphatauri: '#4E7C9B',
  alpha_tauri: '#4E7C9B',
  toro_rosso: '#469BFF',
  racing_point: '#F596C8',
  force_india: '#F596C8',
  renault: '#FFF500',
  alfa: '#C92D4B',
  alfa_romeo: '#C92D4B',
  manor: '#6E0000',
  virgin: '#4E4E4E',
  lotus_f1: '#FFB800',
  lotus_racing: '#FFB800',
  caterham: '#0B7A3E',
  hrt: '#B2945E',
  brawn: '#B8FF6B',
  toyota: '#CC0000',
  bmw_sauber: '#293C6B',
  honda: '#FFFFFF',
  super_aguri: '#C8102E',
  spyker: '#F5820B',
  mf1: '#F5820B',
}

/** Neutral chip colour for a team whose livery we do not know. */
const UNKNOWN_TEAM_COLOR = '#7d786b'

const PAPER_INK = '#fbf8f0'
const DARK_INK = '#1b1b1b'

export function teamColor(constructorId: string | undefined): string {
  if (!constructorId) return UNKNOWN_TEAM_COLOR
  return TEAM_COLORS[constructorId] ?? UNKNOWN_TEAM_COLOR
}

/** `#rgb`, `#rrggbb` or the same without the hash. Anything else is unknown. */
function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [...hex].map((char) => parseInt(char + char, 16)) as [number, number, number]
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [
      number,
      number,
      number,
    ]
  }
  return null
}

function channelLuminance(value: number): number {
  const channel = value / 255
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: [number, number, number]): number {
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  )
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const PAPER_LUMINANCE = luminance([0xfb, 0xf8, 0xf0])
const DARK_LUMINANCE = luminance([0x1b, 0x1b, 0x1b])

/**
 * Ink or paper, whichever stays legible on a team colour. The grid spans
 * near-white liveries (Haas) and near-black ones, so chip text cannot be a
 * single hard-coded colour.
 */
export function readableInk(color: string): string {
  const rgb = parseHex(color)
  if (!rgb) return PAPER_INK
  const background = luminance(rgb)
  return contrast(background, DARK_LUMINANCE) >= contrast(background, PAPER_LUMINANCE)
    ? DARK_INK
    : PAPER_INK
}

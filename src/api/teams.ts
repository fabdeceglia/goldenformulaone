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

export function teamColor(constructorId: string | undefined): string {
  if (!constructorId) return '#6b7280'
  return TEAM_COLORS[constructorId] ?? '#6b7280'
}

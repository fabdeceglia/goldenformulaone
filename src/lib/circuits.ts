/**
 * Circuit track layouts and their history.
 *
 * Vendored from the "f1-circuits-svg" project (MIT, see `public/circuits/LICENSE.txt`),
 * a fork of julesr0y/f1-circuits-svg by Jules Roy. The SVG files live in `public/circuits/`
 * named by their source layout ids (e.g. `monza-6.svg`).
 *
 * Keys here are the Ergast/jolpica `circuitId`s the rest of the app uses, which differ
 * from the source project's own ids (e.g. Ergast `spa` -> source `spa-francorchamps`).
 */

export interface CircuitLayout {
  /** Source file id, e.g. `monza-6` (loads `public/circuits/monza-6.svg`). */
  layoutId: string
  /** Seasons this layout was raced, e.g. `2000-2025`. */
  seasons: string
}

export interface CircuitInfo {
  /** Source name of the circuit. */
  name: string
  /** Layout in current use (the latest entry in `layouts`). */
  current: string
  /** Every recorded layout, oldest first. */
  layouts: CircuitLayout[]
}

const BASE = import.meta.env.BASE_URL

/** URL of a track-layout image, e.g. `circuitLayoutImage('monza-6')`. */
export function circuitLayoutImage(layoutId: string): string {
  return `${BASE}circuits/${layoutId}.svg`
}

/** Current track layout image for a circuit, or `undefined` if not vendored. */
export function circuitImage(circuitId: string): string | undefined {
  const info = CIRCUITS[circuitId]
  return info ? circuitLayoutImage(info.current) : undefined
}

export const CIRCUITS: Record<string, CircuitInfo> = {
  albert_park: {
    name: "Melbourne Grand Prix Circuit",
    current: "melbourne-2",
    layouts: [
      { layoutId: "melbourne-1", seasons: "1996-2019" },
      { layoutId: "melbourne-2", seasons: "2022-2025" },
    ],
  },
  shanghai: {
    name: "Shanghai International Circuit",
    current: "shanghai-1",
    layouts: [
      { layoutId: "shanghai-1", seasons: "2004-2019,2025" },
    ],
  },
  suzuka: {
    name: "Suzuka Circuit",
    current: "suzuka-2",
    layouts: [
      { layoutId: "suzuka-1", seasons: "1987-2002" },
      { layoutId: "suzuka-2", seasons: "2003-2006,2009-2019,2022-2025" },
    ],
  },
  miami: {
    name: "Miami International Autodrome",
    current: "miami-1",
    layouts: [
      { layoutId: "miami-1", seasons: "2022-2025" },
    ],
  },
  villeneuve: {
    name: "Circuit Gilles Villeneuve",
    current: "montreal-6",
    layouts: [
      { layoutId: "montreal-1", seasons: "1978" },
      { layoutId: "montreal-2", seasons: "1979-1986,1988-1990" },
      { layoutId: "montreal-3", seasons: "1991-1993" },
      { layoutId: "montreal-4", seasons: "1994-1995" },
      { layoutId: "montreal-5", seasons: "1996-2001" },
      { layoutId: "montreal-6", seasons: "2002-2019,2022-2025" },
    ],
  },
  monaco: {
    name: "Circuit de Monaco",
    current: "monaco-5",
    layouts: [
      { layoutId: "monaco-1", seasons: "1950,1955-1972" },
      { layoutId: "monaco-2", seasons: "1973-1975" },
      { layoutId: "monaco-3", seasons: "1976-1985" },
      { layoutId: "monaco-4", seasons: "1986-2002" },
      { layoutId: "monaco-5", seasons: "2003-2019,2021-2025" },
    ],
  },
  catalunya: {
    name: "Circuit de Barcelona-Catalunya",
    current: "catalunya-6",
    layouts: [
      { layoutId: "catalunya-1", seasons: "1991-1994" },
      { layoutId: "catalunya-2", seasons: "1995-2003" },
      { layoutId: "catalunya-3", seasons: "2004-2006" },
      { layoutId: "catalunya-4", seasons: "2007-2020" },
      { layoutId: "catalunya-5", seasons: "2021-2022" },
      { layoutId: "catalunya-6", seasons: "2023-2025" },
    ],
  },
  red_bull_ring: {
    name: "Red Bull Ring",
    current: "spielberg-3",
    layouts: [
      { layoutId: "spielberg-1", seasons: "1970-1976" },
      { layoutId: "spielberg-2", seasons: "1977-1987" },
      { layoutId: "spielberg-3", seasons: "1997-2003,2014-2025" },
    ],
  },
  silverstone: {
    name: "Silverstone Circuit",
    current: "silverstone-8",
    layouts: [
      { layoutId: "silverstone-1", seasons: "1950-1954,1956,1958,1960,1963,1965,1967,1969,1971,1973" },
      { layoutId: "silverstone-2", seasons: "1975,1977,1979,1981,1983,1985" },
      { layoutId: "silverstone-3", seasons: "1987-1990" },
      { layoutId: "silverstone-4", seasons: "1991-1993" },
      { layoutId: "silverstone-5", seasons: "1994-1995" },
      { layoutId: "silverstone-6", seasons: "1996" },
      { layoutId: "silverstone-7", seasons: "1997-2009" },
      { layoutId: "silverstone-8", seasons: "2010-2025" },
    ],
  },
  spa: {
    name: "Circuit de Spa-Francorchamps",
    current: "spa-francorchamps-4",
    layouts: [
      { layoutId: "spa-francorchamps-1", seasons: "1950-1956,1958-1968,1970" },
      { layoutId: "spa-francorchamps-2", seasons: "1983,1985-2002" },
      { layoutId: "spa-francorchamps-3", seasons: "2004-2005" },
      { layoutId: "spa-francorchamps-4", seasons: "2007-2025" },
    ],
  },
  hungaroring: {
    name: "Hungaroring",
    current: "hungaroring-3",
    layouts: [
      { layoutId: "hungaroring-1", seasons: "1986-1988" },
      { layoutId: "hungaroring-2", seasons: "1989-2002" },
      { layoutId: "hungaroring-3", seasons: "2003-2025" },
    ],
  },
  zandvoort: {
    name: "Circuit Park Zandvoort",
    current: "zandvoort-5",
    layouts: [
      { layoutId: "zandvoort-1", seasons: "1952-1953,1955,1958-1971" },
      { layoutId: "zandvoort-2", seasons: "1973-1978" },
      { layoutId: "zandvoort-3", seasons: "1979" },
      { layoutId: "zandvoort-4", seasons: "1980-1985" },
      { layoutId: "zandvoort-5", seasons: "2021-2025" },
    ],
  },
  monza: {
    name: "Autodromo Nazionale Monza",
    current: "monza-6",
    layouts: [
      { layoutId: "monza-1", seasons: "1950-1954" },
      { layoutId: "monza-2", seasons: "1955-1956,1960-1961" },
      { layoutId: "monza-3", seasons: "1957-1959,1962-1971" },
      { layoutId: "monza-4", seasons: "1972-1975" },
      { layoutId: "monza-5", seasons: "1976-1979,1981-1999" },
      { layoutId: "monza-6", seasons: "2000-2025" },
    ],
  },
  baku: {
    name: "Baku City Circuit",
    current: "baku-1",
    layouts: [
      { layoutId: "baku-1", seasons: "2016-2019,2021-2025" },
    ],
  },
  sepang: {
    name: "Sepang International Circuit",
    current: "sepang-1",
    layouts: [
      { layoutId: "sepang-1", seasons: "1999-2017" },
    ],
  },
  marina_bay: {
    name: "Marina Bay Street Circuit",
    current: "marina-bay-4",
    layouts: [
      { layoutId: "marina-bay-1", seasons: "2008-2012" },
      { layoutId: "marina-bay-2", seasons: "2013-2014" },
      { layoutId: "marina-bay-3", seasons: "2015-2019,2022" },
      { layoutId: "marina-bay-4", seasons: "2023-2025" },
    ],
  },
  americas: {
    name: "Circuit of the Americas",
    current: "austin-1",
    layouts: [
      { layoutId: "austin-1", seasons: "2012-2019,2021-2025" },
    ],
  },
  rodriguez: {
    name: "Aut\u00f3dromo Hermanos Rodr\u00edguez",
    current: "mexico-city-3",
    layouts: [
      { layoutId: "mexico-city-1", seasons: "1963-1970" },
      { layoutId: "mexico-city-2", seasons: "1986-1992" },
      { layoutId: "mexico-city-3", seasons: "2015-2019,2021-2025" },
    ],
  },
  interlagos: {
    name: "Aut\u00f3dromo Jos\u00e9 Carlos Pace",
    current: "interlagos-2",
    layouts: [
      { layoutId: "interlagos-1", seasons: "1973-1977,1979-1980" },
      { layoutId: "interlagos-2", seasons: "1990-2025" },
    ],
  },
  vegas: {
    name: "Las Vegas Street Circuit",
    current: "las-vegas-1",
    layouts: [
      { layoutId: "las-vegas-1", seasons: "2023-2025" },
    ],
  },
  losail: {
    name: "Lusail International Circuit",
    current: "lusail-1",
    layouts: [
      { layoutId: "lusail-1", seasons: "2021,2023-2025" },
    ],
  },
  yas_marina: {
    name: "Yas Marina Circuit",
    current: "yas-marina-2",
    layouts: [
      { layoutId: "yas-marina-1", seasons: "2009-2020" },
      { layoutId: "yas-marina-2", seasons: "2021-2025" },
    ],
  },
}

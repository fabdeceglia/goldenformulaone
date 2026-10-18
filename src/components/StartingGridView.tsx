import type { AlphaSessionResults } from '../api/types'
import { readableInk, teamColor } from '../api/teams'
import { gridRows } from '../lib/grid'
import type { GridEntry } from '../lib/grid'

/**
 * Qualifying as a starting grid: the classification in two staggered columns,
 * the way the cars line up. Purely presentational — every value comes from the
 * session payload the table already renders, so nothing new is fetched.
 *
 * The two columns are not two lists. The classification stays in one ordered
 * list, in classification order, and CSS drops every second plate half a row, so
 * the reading order is the grid order and the phone layout can flatten to a
 * single column without any of it being restyled.
 */
export function StartingGridView({ session }: { session: AlphaSessionResults }) {
  const { grid, unclassified, segments } = gridRows(session)

  return (
    <div className="grid-view">
      <ol className="grid grid--start" role="list" aria-label={`${session.title} starting grid`}>
        {grid.map((row, index) => (
          <Plate
            key={row.entry.driver.id}
            row={row}
            slot={index + 1}
            segments={segments}
            pole={index === 0}
          />
        ))}
      </ol>

      {unclassified.length > 0 && (
        <section className="grid__out" aria-labelledby="grid-out-title">
          <h3 className="grid__out-title" id="grid-out-title">
            Did not qualify
          </h3>
          <ul className="grid grid--out" role="list">
            {unclassified.map((row) => (
              <Plate key={row.entry.driver.id} row={row} segments={segments} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

interface PlateProps {
  row: GridEntry
  segments: readonly string[]
  /** Grid slot. A car that set no time holds none, so none is printed. */
  slot?: number
  /** The pole-sitter gets the heavier plate. */
  pole?: boolean
}

function Plate({ row, segments, slot, pole = false }: PlateProps) {
  const { entry, gap } = row
  const { driver, team } = entry

  // The badge is the car number — the livery mark the game puts on the plate.
  // The slot beside it carries the order, which is what a grid is really about.
  const number = entry.car_number ?? slot
  const background = team?.primary_color?.trim() || teamColor(undefined)
  const missed = segments.filter((_, index) => !row.segments[index])

  // Every plate but the pole-sitter's is measured against the pole, so the pole
  // plate shows the time itself: a gap of zero would say nothing.
  const reference = pole ? entry.time : gap
  const noTime = !reference && entry.position_text.toUpperCase() === 'NC'

  return (
    <li className={`plate${pole ? ' plate--pole' : ''}`}>
      <span className="plate__slot">{slot ? `P${slot}` : '—'}</span>
      <span
        className="plate__badge"
        style={{ backgroundColor: background, color: readableInk(background) }}
        aria-hidden="true"
      >
        {number}
      </span>
      <span className="plate__body">
        <span className="plate__name">
          {driver.given_name} {driver.family_name}
        </span>
        <span className="plate__team">{team?.name ?? '—'}</span>
      </span>
      <span className="plate__detail">
        {segments.length > 0 && (
          <span className="plate__dots" aria-hidden="true">
            {row.segments.map((set, index) => (
              <i key={segments[index]} className={`plate__dot${set ? ' is-set' : ''}`} />
            ))}
          </span>
        )}
        {missed.length > 0 && <span className="sr-only">No time in {missed.join(', ')}</span>}
        {reference && (
          <span className={`plate__gap${pole ? ' plate__gap--pole' : ''}`}>{reference}</span>
        )}
        {noTime && <span className="plate__gap">NC</span>}
      </span>
    </li>
  )
}

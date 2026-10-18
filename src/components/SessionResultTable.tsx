import { useState } from 'react'
import type { AlphaSessionEntry, AlphaSessionResults, SessionCode } from '../api/types'
import { formatGap, parseSessionTime, raceTimeLabel } from '../lib/format'
import { QUALIFYING_SEGMENTS } from '../lib/grid'
import { Position } from './Position'

const RACE_CODES: readonly SessionCode[] = ['R', 'SR']

/** Classification for a single session, with columns suited to its format. */
export function SessionResultTable({ session }: { session: AlphaSessionResults }) {
  if (RACE_CODES.includes(session.code)) return <RaceTable session={session} />
  const segments = QUALIFYING_SEGMENTS[session.code]
  if (segments) return <QualifyingTable session={session} segments={segments} />
  return <PracticeTable session={session} />
}

/** Finishing order: grid, laps, time or status, and points. */
function RaceTable({ session }: { session: AlphaSessionResults }) {
  // The leader's laps and total time are the reference the rest are measured
  // against, because the API only gives each car its own elapsed time.
  const leader = session.results[0]
  const reference = {
    laps: leader?.laps ?? null,
    timeMillis: parseSessionTime(leader?.time),
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" className="table__pos">
              Pos
            </th>
            <th scope="col">Driver</th>
            <th scope="col" className="hide-sm">
              Team
            </th>
            <th scope="col" className="table__num hide-sm">
              Grid
            </th>
            <th scope="col" className="table__num hide-sm">
              Laps
            </th>
            <th scope="col">Time / Status</th>
            <th scope="col" className="table__num">
              Pts
            </th>
          </tr>
        </thead>
        <tbody>
          {session.results.map((entry) => (
            <tr key={entry.driver.id}>
              <td className="table__pos">
                <Position
                  value={String(entry.position)}
                  positionText={entry.position_text}
                  color={entry.team?.primary_color}
                />
              </td>
              <td>
                <DriverCell entry={entry} />
              </td>
              <td className="muted hide-sm">{entry.team?.name ?? '—'}</td>
              <td className="table__num hide-sm">{entry.components?.GRID?.position ?? '—'}</td>
              <td className="table__num hide-sm">{entry.laps ?? '—'}</td>
              <td>{raceTimeLabel(entry, reference)}</td>
              <td className="table__num table__num--strong">{entry.points ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Qualifying, shown one column per segment (Q1/Q2/Q3 or SQ1/SQ2/SQ3). */
function QualifyingTable({
  session,
  segments,
}: {
  session: AlphaSessionResults
  segments: readonly string[]
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" className="table__pos">
              Pos
            </th>
            <th scope="col">Driver</th>
            <th scope="col" className="hide-sm">
              Team
            </th>
            {segments.map((segment) => (
              <th key={segment} scope="col" className="table__num">
                {segment}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {session.results.map((entry) => (
            <tr key={entry.driver.id}>
              <td className="table__pos">
                <Position value={String(entry.position)} color={entry.team?.primary_color} />
              </td>
              <td>
                <DriverCell entry={entry} />
              </td>
              <td className="muted hide-sm">{entry.team?.name ?? '—'}</td>
              {segments.map((segment, index) => {
                const time = entry.components?.[segment]?.time
                const isFinal = index === segments.length - 1
                return (
                  <td
                    key={segment}
                    className={`table__num${isFinal && time ? ' table__num--strong' : ''}${
                      time ? '' : ' muted'
                    }`}
                  >
                    {time ?? '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Free practice: best lap and the gap to the pace-setter. */
function PracticeTable({ session }: { session: AlphaSessionResults }) {
  const leaderTime = parseSessionTime(session.results[0]?.time)

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" className="table__pos">
              Pos
            </th>
            <th scope="col">Driver</th>
            <th scope="col" className="hide-sm">
              Team
            </th>
            <th scope="col">Best lap</th>
            <th scope="col" className="table__num">
              Gap
            </th>
            <th scope="col" className="table__num hide-sm">
              Laps
            </th>
          </tr>
        </thead>
        <tbody>
          {session.results.map((entry) => (
            <tr key={entry.driver.id}>
              <td className="table__pos">
                <Position value={String(entry.position)} color={entry.team?.primary_color} />
              </td>
              <td>
                <DriverCell entry={entry} />
              </td>
              <td className="muted hide-sm">{entry.team?.name ?? '—'}</td>
              <td>{entry.time ?? '—'}</td>
              <td className="table__num">{formatGap(parseSessionTime(entry.time), leaderTime)}</td>
              <td className="table__num hide-sm">{entry.laps ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DriverCell({ entry }: { entry: AlphaSessionEntry }) {
  const fastestLap = entry.components?.FLAP?.position === 1
  const fastestLapTime = entry.components?.FLAP?.time

  return (
    <div className={`driver${entry.driver.abbreviation ? ' driver--coded' : ''}`}>
      {entry.driver.abbreviation && (
        <span className="driver__code">{entry.driver.abbreviation}</span>
      )}
      <span className="driver__name">
        {entry.driver.given_name} {entry.driver.family_name}
      </span>
      {fastestLap && <FastestLapBadge time={fastestLapTime} />}
    </div>
  )
}

/**
 * The fastest-lap marker, which carries the lap time in a bubble. It is a
 * button so the bubble can be opened without a mouse: hover and keyboard focus
 * are handled in CSS, but a tap does not focus a button in every browser
 * (Safari notably), so tapping toggles it through state instead.
 */
function FastestLapBadge({ time }: { time?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <button
      type="button"
      className={`badge badge--fastest badge--fastest-detail${open ? ' is-open' : ''}`}
      aria-label={time ? `FL, fastest lap ${time}` : 'FL, fastest lap'}
      onClick={() => setOpen((value) => !value)}
      onBlur={() => setOpen(false)}
    >
      FL
      {time && (
        <span className="badge__bubble" aria-hidden="true">
          {time}
        </span>
      )}
    </button>
  )
}

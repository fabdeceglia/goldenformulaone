import type { AlphaSessionEntry, AlphaSessionResults, SessionCode } from '../api/types'
import { formatGap, parseSessionTime, raceTimeLabel } from '../lib/format'
import { Position, TeamBar } from './TeamBar'

/** Segments rendered as their own columns, in order. */
const SEGMENT_COLUMNS: Partial<Record<SessionCode, readonly string[]>> = {
  Q: ['Q1', 'Q2', 'Q3'],
  SQ: ['SQ1', 'SQ2', 'SQ3'],
}

const RACE_CODES: readonly SessionCode[] = ['R', 'SR']

/** Classification for a single session, with columns suited to its format. */
export function SessionResultTable({ session }: { session: AlphaSessionResults }) {
  if (RACE_CODES.includes(session.code)) return <RaceTable session={session} />
  const segments = SEGMENT_COLUMNS[session.code]
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
                <Position value={String(entry.position)} positionText={entry.position_text} />
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
                <Position value={String(entry.position)} />
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
                <Position value={String(entry.position)} />
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

  return (
    <div className="driver">
      <TeamBar color={entry.team?.primary_color} />
      <span className="driver__name">
        {entry.driver.given_name} {entry.driver.family_name}
      </span>
      {entry.driver.abbreviation && (
        <span className="driver__code">{entry.driver.abbreviation}</span>
      )}
      {fastestLap && (
        <span className="badge badge--fastest" title="Fastest lap">
          FL
        </span>
      )}
    </div>
  )
}

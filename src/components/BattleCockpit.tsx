import { formatLapTime } from '../lib/replay'
import type { BattleTelemetrySample, BattleDriver, BattleLap } from '../lib/battle'
import { drsState } from '../lib/battle'

interface BattleCockpitProps {
  driver: BattleDriver
  lap: BattleLap
  telemetry: BattleTelemetrySample
  finished: boolean
  leading: boolean
}

const RPM_MAX = 15_000

function barWidth(value: number | null, max: number): string {
  if (value === null || !Number.isFinite(value)) return '0%'
  return `${Math.min(100, Math.max(0, (value / max) * 100))}%`
}

/**
 * One driver's side of the 1v1: a cockpit HUD rather than a fake onboard camera.
 * Only channels OpenF1 actually publishes are shown, so nothing is invented.
 */
export function BattleCockpit({
  driver,
  lap,
  telemetry,
  finished,
  leading,
}: BattleCockpitProps) {
  const drs = drsState(telemetry.drs)
  const drsLabel = drs === 'on' ? 'DRS open' : drs === 'ready' ? 'DRS ready' : 'DRS closed'
  const gear =
    telemetry.gear === null ? '—' : telemetry.gear === 0 ? 'N' : String(telemetry.gear)

  return (
    <article
      className="battle__cockpit"
      data-finished={finished || undefined}
      style={{ borderTopColor: driver.color }}
      aria-label={`${driver.acronym} telemetry`}
    >
      <header className="battle__cockpit-head">
        <span className="battle__team-dot" style={{ background: driver.color }} />
        <div className="battle__cockpit-id">
          <p className="battle__cockpit-code">
            {driver.acronym}
            {leading && !finished ? <span className="battle__lead">Lead</span> : null}
          </p>
          <p className="battle__cockpit-name">{driver.name}</p>
        </div>
        <span className="battle__cockpit-lap">{formatLapTime(lap.duration)}</span>
      </header>

      <div className="battle__readout">
        <div className="battle__speed">
          <strong>
            {telemetry.speed === null ? '—' : Math.round(telemetry.speed)}
          </strong>
          <span>km/h</span>
        </div>
        <div className="battle__gear">
          <strong>{gear}</strong>
          <span>gear</span>
        </div>
      </div>

      <div className="battle__rpm">
        <div className="battle__mini-head">
          <span>RPM</span>
          <strong>
            {telemetry.rpm === null ? '—' : Math.round(telemetry.rpm).toLocaleString('en-US')}
          </strong>
        </div>
        <div className="battle__bar">
          <span style={{ width: barWidth(telemetry.rpm, RPM_MAX) }} />
        </div>
      </div>

      <div className="battle__pedals">
        <div>
          <div className="battle__mini-head">
            <span>Throttle</span>
            <strong>
              {telemetry.throttle === null ? '—' : `${Math.round(telemetry.throttle)}%`}
            </strong>
          </div>
          <div className="battle__bar battle__bar--throttle">
            <span style={{ width: barWidth(telemetry.throttle, 100) }} />
          </div>
        </div>
        <div>
          <div className="battle__mini-head">
            <span>Brake</span>
            <strong>
              {telemetry.brake === null ? '—' : telemetry.brake ? 'On' : 'Off'}
            </strong>
          </div>
          <div className="battle__bar battle__bar--brake">
            <span
              style={{ width: telemetry.brake === true ? '100%' : '0%' }}
            />
          </div>
        </div>
      </div>

      <footer className="battle__cockpit-foot">
        <span className="battle__drs" data-state={drs}>
          {drsLabel}
        </span>
        {finished ? <span className="battle__finished">Finished</span> : null}
      </footer>
    </article>
  )
}

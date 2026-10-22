import type { ReactNode } from 'react'
import type { ReplayWeatherSample } from '../lib/replay'

/**
 * The conditions strip that sits against the top of the track panel. OpenF1
 * records one weather sample a minute, so this reads the last sample at the
 * replay playhead rather than interpolating between them.
 */
export function ReplayWeather({ weather }: { weather: ReplayWeatherSample | null }) {
  if (!weather) return null

  const track = temperature(weather.track)
  const air = temperature(weather.air)
  const wind = weather.wind === null ? null : weather.wind.toFixed(1)
  const rain = weather.rain === null ? null : weather.rain ? 'Rain' : 'Dry'

  if (!track && !air && !wind && !rain) return null

  return (
    <div className="replay__weather" role="group" aria-label="Track weather">
      {track ? (
        <span className="replay__weather-item" title={`Track temperature ${track}`}>
          <ThermometerIcon />
          <span className="replay__weather-label">Track</span>
          <span className="replay__weather-value">{track}</span>
        </span>
      ) : null}

      {air ? (
        <span
          className="replay__weather-item"
          title={`Air temperature ${air}${
            weather.humidity === null ? '' : ` · ${Math.round(weather.humidity)}% humidity`
          }`}
        >
          <SunIcon />
          <span className="replay__weather-label">Air</span>
          <span className="replay__weather-value">{air}</span>
        </span>
      ) : null}

      {wind ? (
        <span
          className="replay__weather-item"
          title={`Wind ${wind} m/s${
            weather.windDirection === null ? '' : ` from ${Math.round(weather.windDirection)}°`
          }`}
        >
          <WindIcon />
          <span className="replay__weather-label">Wind</span>
          <span className="replay__weather-value">{wind}</span>
          <span className="replay__weather-unit">m/s</span>
        </span>
      ) : null}

      {rain ? (
        <span
          className="replay__weather-item"
          data-rain={weather.rain === true ? 'true' : undefined}
          title={`${rain}${
            weather.pressure === null ? '' : ` · pressure ${Math.round(weather.pressure)} hPa`
          }`}
        >
          <DropletIcon />
          <span className="replay__weather-value">{rain}</span>
        </span>
      ) : null}
    </div>
  )
}

function temperature(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)}°C`
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="replay__weather-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function ThermometerIcon() {
  return (
    <Icon>
      <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
    </Icon>
  )
}

function SunIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </Icon>
  )
}

function WindIcon() {
  return (
    <Icon>
      <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </Icon>
  )
}

function DropletIcon() {
  return (
    <Icon>
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-3-4-5.5c-.5 2.5-2 3.9-4 5.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7Z" />
    </Icon>
  )
}

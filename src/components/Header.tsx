import { useTheme } from '../hooks/useTheme'

/** The brand mark: the pit-wall operator who fronts the app, and the theme switch. */
export function Header() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <header className="header">
      <div className="brand">
        <span className="brand__mark">
          <img src="/logo.png" alt="" width={128} height={128} />
        </span>

        <div className="brand__text">
          <h1 className="brand__title">Box this Lap!</h1>
          <p className="brand__subtitle">Live standings and updates from the pit wall.</p>
        </div>
      </div>

      {/* The icon shows the theme a press will bring: a moon to go dark, a sun to
          come back to the light. */}
      <button
        type="button"
        className="theme-toggle"
        onClick={toggle}
        aria-label={label}
        title={label}
      >
        {isDark ? <SunIcon /> : <MoonIcon />}
      </button>
    </header>
  )
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

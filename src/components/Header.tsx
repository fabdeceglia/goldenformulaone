/** The brand mark: the pit-wall operator who fronts the app. */
export function Header() {
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
    </header>
  )
}

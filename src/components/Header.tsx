interface HeaderProps {
  season: string
}

export function Header({ season }: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          F1
        </span>
        <div className="brand__text">
          <h1 className="brand__title">F1 Explorer</h1>
          <p className="brand__subtitle">Race results &amp; championship standings</p>
        </div>
      </div>

      {season && <span className="season-badge">{season} season</span>}
    </header>
  )
}

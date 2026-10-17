/** A 4x4 checkered flag — the one graphic motif the theme hangs on. */
const CHECKER = 4
const CELL = 24 / CHECKER

export function Header() {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            {Array.from({ length: CHECKER * CHECKER }, (_, index) => {
              const row = Math.floor(index / CHECKER)
              const column = index % CHECKER
              return (
                <rect
                  key={index}
                  x={column * CELL}
                  y={row * CELL}
                  width={CELL}
                  height={CELL}
                  className={(row + column) % 2 === 0 ? 'brand__check--red' : 'brand__check--paper'}
                />
              )
            })}
          </svg>
        </span>

        <div className="brand__text">
          <h1 className="brand__title">F1 Explorer</h1>
          <p className="brand__subtitle">Race results &amp; championship standings</p>
        </div>
      </div>
    </header>
  )
}

/**
 * Placeholder for the news crawler that will live on the home screen.
 */
export function NewsPlaceholder() {
  return (
    <section className="panel" aria-labelledby="news-title">
      <div className="panel__head">
        <h2 className="panel__title" id="news-title">
          Latest news
        </h2>
        <span className="panel__meta">Coming soon</span>
      </div>

      <div className="news__placeholder">
        <p className="news__hint">News feed coming soon.</p>
      </div>
    </section>
  )
}

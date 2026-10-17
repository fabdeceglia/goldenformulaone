interface FeedbackProps {
  message: string
  onRetry?: () => void
}

export function Loading({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="feedback" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

export function ErrorState({ message, onRetry }: FeedbackProps) {
  return (
    <div className="feedback feedback--error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Empty({ message }: { message: string }) {
  return <div className="feedback feedback--empty">{message}</div>
}

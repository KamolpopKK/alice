import { Link } from 'react-router-dom'
import { ApiError } from '../api'
import { IllustratedState } from './components'

/** Signed-in catch-all route: concerned Alice, the approved line and a clear way back to the Board. */
export function NotFoundState() {
  return (
    <div className="page">
      <IllustratedState
        pose="concerned"
        copy="notFound"
        title="Page not found"
        headingLevel={1}
        imageWidth={150}
        action={
          <Link to="/" className="button primary">
            Back to Home
          </Link>
        }
      />
    </div>
  )
}

/**
 * Recoverable full-page failure (the page's main data could not load). Shows the factual error, a
 * retry, and a safe way back. Not for validation or permission errors, which stay plain text.
 */
export function FullPageError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const detail = error instanceof ApiError || error instanceof Error ? error.message : String(error)
  return (
    <div className="page">
      <IllustratedState
        pose="concerned"
        copy="fullPageError"
        title="This page didn’t load"
        imageWidth={120}
        action={
          <>
            <button type="button" className="primary" onClick={onRetry}>
              Try again
            </button>
            <Link to="/" className="button">
              Back to Home
            </Link>
          </>
        }
      />
      <p className="muted small center" role="alert">
        {detail}
      </p>
    </div>
  )
}

/** Whether a load failure is worth retrying (network or server trouble), as opposed to a missing resource. */
export function isRecoverable(error: unknown): boolean {
  return !(error instanceof ApiError) || ['NETWORK_ERROR', 'INTERNAL_ERROR', 'RATE_LIMITED', 'PROTOCOL_ERROR'].includes(error.code)
}

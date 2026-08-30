import { Link } from 'react-router'

export function ForbiddenPage() {
  return (
    <div className="card empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m6 6 12 12" strokeLinecap="round" />
      </svg>
      <h2>You don&apos;t have access to this page</h2>
      <p className="muted">Ask an administrator to grant you the required permission.</p>
      <Link className="btn btn-primary" to="/">
        Back to the dashboard
      </Link>
    </div>
  )
}

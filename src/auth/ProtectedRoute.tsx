import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './useAuth'
import { ForbiddenPage } from '../pages/ForbiddenPage'
import { loginRouteFor } from './returnUrl'

interface ProtectedRouteProps {
  /** When given, the user must hold this permission code or the Forbidden page is shown. */
  permission?: string
}

/** Renders the child routes only for signed-in users; otherwise sends them to the login page. */
export function ProtectedRoute({ permission }: ProtectedRouteProps) {
  const { status, user, hasPermission } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="route-loading">
        <p className="muted">Checking your session...</p>
      </div>
    )
  }

  if (status !== 'authenticated' || !user) {
    // The page asked for travels in the URL (?returnUrl=), so it survives a reload of the sign-in page.
    return <Navigate to={loginRouteFor(location.pathname + location.search + location.hash)} replace />
  }

  // Lacking a permission is not an authentication problem: show why instead of bouncing to login.
  if (permission && !hasPermission(permission)) {
    return <ForbiddenPage />
  }

  return <Outlet />
}

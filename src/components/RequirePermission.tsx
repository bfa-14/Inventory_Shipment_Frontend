import type { ReactNode } from 'react'
import { useAuth } from '../auth/useAuth'

interface RequirePermissionProps {
  /** Permission code the user must hold for the children to render. */
  code: string
  children: ReactNode
  /** Optional stand-in when the user lacks the permission (default: nothing). */
  fallback?: ReactNode
}

/** Hides an action (button, menu entry) from users who lack the permission. */
export function RequirePermission({ code, children, fallback = null }: RequirePermissionProps) {
  const { hasPermission } = useAuth()
  return <>{hasPermission(code) ? children : fallback}</>
}

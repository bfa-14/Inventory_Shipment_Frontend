import { useContext, useMemo } from 'react'
import { AuthContext, type AuthContextValue } from './AuthContext'

export interface UseAuthValue extends AuthContextValue {
  /** True when the signed-in user holds this permission code. */
  hasPermission(code: string): boolean
  /** True when the user holds at least one of the codes (an empty list means "no restriction"). */
  hasAnyPermission(...codes: string[]): boolean
}

export function useAuth(): UseAuthValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')

  const permissions = context.user?.permissions
  const granted = useMemo(() => new Set(permissions ?? []), [permissions])

  return useMemo(
    () => ({
      ...context,
      hasPermission: (code: string) => granted.has(code),
      hasAnyPermission: (...codes: string[]) => codes.length === 0 || codes.some((c) => granted.has(c)),
    }),
    [context, granted],
  )
}

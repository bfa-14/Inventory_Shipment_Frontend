import { useContext } from 'react'
import { EnvironmentContext } from './EnvironmentContext'
import type { EnvironmentInfo } from './environment'

/**
 * The environment this copy of the app runs in, and the address of the other one. Both are null until
 * /environment.json has been read, and stay null when it cannot be (`npm run dev`): treat null as
 * "show nothing", never as production.
 */
export function useEnvironment(): EnvironmentInfo {
  return useContext(EnvironmentContext)
}

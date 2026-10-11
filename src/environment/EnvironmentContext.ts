import { createContext } from 'react'
import { UNKNOWN_ENVIRONMENT, type EnvironmentInfo } from './environment'

/** Starts as "unknown", so a screen rendered outside the provider simply shows nothing about environments. */
export const EnvironmentContext = createContext<EnvironmentInfo>(UNKNOWN_ENVIRONMENT)

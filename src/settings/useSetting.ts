import { useEffect, useState } from 'react'
import { settingsApi, type SettingLookupDto } from '../api/settings'

/**
 * Reading a global setting from a screen: `useSettingBool('Sales.AllowOutOfStock')`.
 *
 * The public settings are fetched ONCE and shared by every screen that asks, so reading a setting
 * costs nothing after the first call. The Settings page calls {@link invalidateSettings} after a
 * save, and the next screen to read gets fresh values.
 *
 * Only settings marked public are readable here. Anything else is read by the server, which is the
 * one that has to enforce it anyway: a setting that changes what the system allows must never rest on
 * what the browser believes.
 */
let cached: Promise<SettingLookupDto[]> | null = null

function load(): Promise<SettingLookupDto[]> {
  cached ??= settingsApi.lookup().catch((error: unknown) => {
    // A failed read must not be remembered: the next screen should try again.
    cached = null
    throw error
  })
  return cached
}

/** Forget what was read, so the next reader asks the server again. */
export function invalidateSettings(): void {
  cached = null
}

export interface SettingState {
  /** The setting's value as text; null while loading or when the key is not public / not defined. */
  value: string | null
  loading: boolean
}

export function useSetting(settingKey: string): SettingState {
  const [state, setState] = useState<SettingState>({ value: null, loading: true })

  useEffect(() => {
    let active = true
    load()
      .then((all) => {
        if (active) setState({ value: all.find((s) => s.settingKey === settingKey)?.value ?? null, loading: false })
      })
      .catch(() => {
        if (active) setState({ value: null, loading: false })
      })
    return () => {
      active = false
    }
  }, [settingKey])

  return state
}

/** A yes / no setting. `fallback` applies while loading and when the setting cannot be read. */
export function useSettingBool(settingKey: string, fallback = false): { value: boolean; loading: boolean } {
  const { value, loading } = useSetting(settingKey)
  return {
    value: value === null ? fallback : ['true', '1', 'yes'].includes(value.toLowerCase()),
    loading,
  }
}

import { request } from './http'

/**
 * Global settings - the "ViewLookup" pattern. The Settings page lists and edits them (needs
 * `configuration.settings.manage`); `lookup` returns the PUBLIC ones and is open to any signed-in
 * user, which is how a screen reads a switch such as Sales.AllowOutOfStock without owning it.
 */
const BASE = '/api/settings'

export type SettingValueType = 'bool' | 'int' | 'decimal' | 'text'

export interface SettingDto {
  /** "Area.Name", e.g. Sales.AllowOutOfStock. */
  settingKey: string
  groupName: string
  label: string
  description: string | null
  valueType: SettingValueType
  defaultValue: string
  minValue: number | null
  maxValue: number | null
  isPublic: boolean
  sortOrder: number
  /** The effective value, as text: the administrator's choice or the default. */
  value: string
  /** True while no choice has been made, so the default applies. */
  isDefault: boolean
  updatedAtUtc: string | null
  updatedByName: string | null
}

export interface SettingLookupDto {
  settingKey: string
  valueType: SettingValueType
  value: string
}

export const settingsApi = {
  list: () => request<SettingDto[]>(BASE),

  lookup: () => request<SettingLookupDto[]>(`${BASE}/lookup`),

  /** 400 VALIDATION when the value does not fit the type or limits. */
  save: (settingKey: string, value: string) =>
    request<SettingDto>(`${BASE}/${encodeURIComponent(settingKey)}`, { method: 'PUT', body: { value } }),

  /** Drops the choice; the default applies again. */
  reset: (settingKey: string) =>
    request<SettingDto>(`${BASE}/${encodeURIComponent(settingKey)}/reset`, { method: 'POST' }),
}

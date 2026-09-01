import type { RateType } from '../../api/types'

/**
 * How the three rate types are written and coloured wherever they appear - the grid badge, the
 * filter bar, the form's Select and the latest-rate cards all read from here, so a rename or a
 * recolour happens once.
 *
 * The API exchanges the enum NAMES ("NonOfficial"); the reader sees "Non-official".
 */
export const RATE_TYPES: readonly { value: RateType; label: string; color: string }[] = [
  { value: 'Official', label: 'Official', color: 'blue' },
  { value: 'NonOfficial', label: 'Non-official', color: 'orange' },
  { value: 'Market', label: 'Market', color: 'teal' },
] as const

/** The `data` for a Select or a Segmented control over the three types. */
export const RATE_TYPE_OPTIONS = RATE_TYPES.map(({ value, label }) => ({ value, label }))

/** The labels a column funnel offers - exactly the words the cells print. */
export const RATE_TYPE_LABELS = RATE_TYPES.map(({ label }) => label)

export function rateTypeLabel(type: RateType): string {
  return RATE_TYPES.find((t) => t.value === type)?.label ?? type
}

export function rateTypeColor(type: RateType): string {
  return RATE_TYPES.find((t) => t.value === type)?.color ?? 'gray'
}

/** A label from a funnel back to the value the API takes. */
export function rateTypeFromLabel(label: string): RateType | undefined {
  return RATE_TYPES.find((t) => t.label === label)?.value
}

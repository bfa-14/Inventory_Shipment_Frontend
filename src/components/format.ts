export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function initials(name: string | undefined): string {
  return (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

/** "BR-001 - Head Office", with a marker when the branch is no longer active. */
export function branchLabel(branch: { branchCode: string; branchName: string; isActive: boolean }): string {
  return `${branch.branchCode} - ${branch.branchName}${branch.isActive ? '' : ' (inactive)'}`
}

/** "USD - US Dollar", marked when it is the base currency or no longer active. */
export function currencyLabel(currency: {
  currencyCode: string
  currencyName: string
  isBaseCurrency: boolean
  isActive: boolean
}): string {
  const suffix = currency.isBaseCurrency ? ' (base)' : currency.isActive ? '' : ' (inactive)'
  return `${currency.currencyCode} - ${currency.currencyName}${suffix}`
}

/**
 * A rate with thousand separators and exactly the quoted currency's decimals, e.g. 2800 at 2
 * decimals reads "2,800.00". Rates are stored with 6 decimals, but a currency that shows 2 is
 * quoted to 2 - printing "2,800.000000" everywhere would be noise.
 */
export function formatRate(rate: number, decimalPlaces: number): string {
  return rate.toLocaleString(undefined, {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  })
}

/**
 * A "yyyy-MM-dd" date from the API in the reader's locale.
 *
 * Built from the parts rather than `new Date(value)`: that parses a bare date as UTC midnight, so a
 * reader west of Greenwich would see every rate dated a day early.
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '-'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Date(year, month - 1, day).toLocaleDateString()
}

/** Today as "yyyy-MM-dd" in the reader's own timezone - the format the date inputs and the API use. */
export function todayDateOnly(): string {
  const now = new Date()
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

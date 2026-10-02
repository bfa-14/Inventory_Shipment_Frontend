/**
 * A moment from the API in the reader's local time: "2026-10-01T20:26:00Z" reads "10/1/2026, 11:26:00 PM" at UTC+3.
 *
 * THE ONE HELPER FOR A TIME. The API sends every *Utc value with its "Z", so the browser converts it to the local
 * time by itself: nothing here adds a zone or an offset - a correction made again would move the time a second
 * time. A date without a time (a document date, "2026-10-01") is not a moment: formatDateOnly / dateLabel show it
 * as it is.
 *
 * @param empty what an absent time reads ("-", or the "—" of the document pages' stamp())
 */
export function formatDateTime(value: string | null | undefined, empty = '-'): string {
  if (!value) return empty
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
  return formatNumber(rate, decimalPlaces)
}

/**
 * A number with thousands separators and a fixed number of decimals, always in the en-US shape:
 * 14020800 at 2 decimals reads "14,020,800.00" whatever the browser's locale is set to.
 *
 * LOCKED TO en-US ON PURPOSE. The same figure is read on several screens, in exports and on paper,
 * and a browser set to French would print "14 020 800,00" on one of them. One shape everywhere is
 * what makes an amount recognisable from screen to screen. EVERY quantity and amount the app shows
 * goes through here or through formatMoney; a NumberInput that holds one carries thousandSeparator.
 */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/**
 * What a NumberInput's onChange handed over, as a number — or null when there is no number in it.
 *
 * MANTINE REPORTS A STRING FOR A VALUE IT THINKS IS STILL BEING TYPED: "12." or "0.5" while the
 * zero is the last thing typed — and, with fixedDecimalScale, EVERY value, because "2150.00" ends in
 * zeros too. A handler that keeps only numbers therefore drops exactly the figures a fixed decimal
 * scale produces (the Inventory In cost read as 0 was this). Parse the string; separators included.
 */
export function numberInputValue(next: number | string): number | null {
  if (typeof next === 'number') return Number.isFinite(next) ? next : null
  const parsed = Number.parseFloat(String(next).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/** "14,020,800.00 USD" — an amount with its currency code, to the currency's decimals. Null reads as zero. */
export function formatMoney(value: number | null | undefined, currencyCode: string, decimals = 2): string {
  return `${formatNumber(value ?? 0, decimals)} ${currencyCode}`
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

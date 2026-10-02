import type { StockDocumentTypeCode } from '../../api/inventory/stockDocuments'
import { PERMISSIONS } from '../../navigation'
import { formatDateTime, formatMoney } from '../format'

/**
 * Everything that differs between Inventory In and Inventory Out, in one table.
 *
 * ONE SET OF SCREENS, TWO DOCUMENTS. In and Out are the same form with a different sign: the same
 * header, the same lines, the same lifecycle. What actually changes is the wording, the accent
 * colour, the five permissions and two rules about cost — so those live here and the pages read
 * them, rather than the pages carrying `code === 'INV_IN' ? … : …` in forty places.
 *
 * IT IS ALSO THE SHAPE PURCHASE AND SALES WILL TAKE. When those families arrive they add a row to
 * this table and reuse the components, which is why nothing below mentions inventory by name except
 * the values themselves.
 */
export interface DocumentKind {
  code: StockDocumentTypeCode

  /** "Inventory In" — the page title, the menu label, the New button. */
  title: string

  /** "/inventory/stock-in" — the list route; the document routes hang off it. */
  route: string

  /**
   * The accent. Green for stock coming in, orange for stock going out, so the two screens are
   * tellable apart at a glance before anybody reads the heading.
   */
  colour: string

  /** 1 adds stock, -1 removes it. Also what the reasons endpoint filters on. */
  direction: 1 | -1

  /* THE COST RULE IS NOT HERE ANY MORE. Whether the cost column may be typed comes from the document
     type configuration (defaultPricing / priceEditable, read through useDocumentTypes), so a business
     owner can change it without a release. The direction is kept: it is what the shortage warning and
     the fallback-while-loading read. */

  permissions: {
    view: string
    create: string
    post: string
    cancel: string
    delete: string
  }
}

export const INVENTORY_IN: DocumentKind = {
  code: 'INV_IN',
  title: 'Inventory In',
  route: '/inventory/stock-in',
  colour: 'green',
  direction: 1,
  permissions: {
    view: PERMISSIONS.stockInView,
    create: PERMISSIONS.stockInCreate,
    post: PERMISSIONS.stockInPost,
    cancel: PERMISSIONS.stockInCancel,
    delete: PERMISSIONS.stockInDelete,
  },
}

export const INVENTORY_OUT: DocumentKind = {
  code: 'INV_OUT',
  title: 'Inventory Out',
  route: '/inventory/stock-out',
  colour: 'orange',
  direction: -1,
  permissions: {
    view: PERMISSIONS.stockOutView,
    create: PERMISSIONS.stockOutCreate,
    post: PERMISSIONS.stockOutPost,
    cancel: PERMISSIONS.stockOutCancel,
    delete: PERMISSIONS.stockOutDelete,
  },
}

/** Draft grey, Posted green, Cancelled red — the three colours every document list uses. */
export const STATUS_COLOURS: Record<string, string> = {
  Draft: 'gray',
  Posted: 'green',
  Cancelled: 'red',
  // A reversed receipt is a record of something undone, not of something that went wrong.
  Reversed: 'orange',
}

/** Money as the documents show it: "14,020,800.00 USD". The stock ledger is in the base currency. */
export function money(value: number | null | undefined, currencyCode = 'USD'): string {
  return formatMoney(value, currencyCode)
}

/** 'yyyy-MM-dd' for a Date, built from its own parts so no timezone can shift the day. */
export function isoDate(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

/** An API date ('2026-09-09T00:00:00') as a Date at local midnight, never through Date.parse of the whole string. */
export function fromIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** '09/09/2026' — the shape every date is displayed in. */
export function dateLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/** A *Utc time in the reader's local time, for "posted on" lines: formatDateTime, with "—" when there is none. */
export function stamp(value: string | null | undefined): string {
  return formatDateTime(value, '—')
}

/** "PC" or "Box (x12)" — a unit is ambiguous without the formula the moment one holds more than one. */
export function unitLabel(unitTypeName: string, packingFormula: number): string {
  return packingFormula > 1 ? `${unitTypeName} (x${packingFormula})` : unitTypeName
}

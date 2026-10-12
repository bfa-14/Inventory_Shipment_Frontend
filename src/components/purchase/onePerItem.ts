import { useSettingBool } from '../../settings/useSetting'
import { formatNumber } from '../format'

/**
 * "One item per supplier invoice" (script 63): the setting that says whether a NEW supplier invoice holds one item.
 * Each invoice keeps the mode it was created with (`oneItemOnly`); the Create Invoice dialogs start from this
 * value and can choose otherwise for each creation.
 */
export const ONE_ITEM_PER_INVOICE_SETTING = 'Purchase.OneItemPerInvoice'

/**
 * The setting, read through the public settings. ON while loading or unreadable (one item per invoice was the rule
 * before), which `known` false says: a request then carries null for the mode, never this guess, so the server
 * applies the setting it really has.
 */
export function useOneItemPerInvoice(): { value: boolean; loading: boolean; known: boolean } {
  return useSettingBool(ONE_ITEM_PER_INVOICE_SETTING, true)
}

/** What a request carries for the mode: the reader's choice, else the setting when it was read, else null (the server's). */
export function onePerItemToSend(choice: boolean | null, setting: { value: boolean; known: boolean }): boolean | null {
  return choice ?? (setting.known ? setting.value : null)
}

/**
 * The switch's description, + a note when the setting could not be read and the reader has not chosen: the request
 * then carries null and the server's setting decides, which may differ from the switch's default shown here.
 */
export function onePerItemDescription(offText: string, choice: boolean | null, setting: { loading: boolean; known: boolean }): string {
  return !setting.loading && !setting.known && choice === null
    ? `${offText} The setting "One item per supplier invoice" could not be read: unless you change this switch, the server's setting decides.`
    : offText
}

/** The hint under an invoice of one item that already has a line: its other lines can only be the same item. */
export const ONE_ITEM_HINT = 'This supplier invoice holds one item: create another invoice for other items.'

/** "One invoice per item: 3 invoices will be created (A, B, C)" — the item codes in order, at most five. */
export function onePerItemLine(itemCodes: string[]): string {
  const count = itemCodes.length === 1 ? '1 invoice' : `${formatNumber(itemCodes.length)} invoices`
  return `One invoice per item: ${count} will be created (${shortList(itemCodes)})`
}

/** "One invoice with 3 items" — the switch off: every item on one invoice. */
export function oneInvoiceLine(itemCount: number): string {
  return `One invoice with ${itemCount === 1 ? '1 item' : `${formatNumber(itemCount)} items`}`
}

/** "One invoice per order: 2 invoices will be created (PO-1, PO-2)" — the switch off, lines of several orders. */
export function onePerOrderLine(orderNumbers: string[]): string {
  return `One invoice per order: ${formatNumber(orderNumbers.length)} invoices will be created (${shortList(orderNumbers)})`
}

/** At most five values, then "...". */
function shortList(values: string[]): string {
  return values.slice(0, 5).join(', ') + (values.length > 5 ? '...' : '')
}

/** The distinct values, in the order they first appear. */
export function distinctInOrder<T>(values: T[]): T[] {
  return [...new Set(values)]
}

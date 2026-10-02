import { formatNumber } from '../format'

/** The hint under an invoice that already has a line: its other lines can only be the same item. */
export const ONE_ITEM_HINT = 'A supplier invoice holds one item: create another invoice for other items.'

/** "One invoice per item: 3 invoices will be created (A, B, C)" — the item codes in order, at most five. */
export function onePerItemLine(itemCodes: string[]): string {
  const shown = itemCodes.slice(0, 5).join(', ') + (itemCodes.length > 5 ? '...' : '')
  const count = itemCodes.length === 1 ? '1 invoice' : `${formatNumber(itemCodes.length)} invoices`
  return `One invoice per item: ${count} will be created (${shown})`
}

/** The distinct values, in the order they first appear. */
export function distinctInOrder<T>(values: T[]): T[] {
  return [...new Set(values)]
}

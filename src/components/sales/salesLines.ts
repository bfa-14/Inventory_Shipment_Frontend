import type { ImportedLine } from './ImportInvoiceItemsWizard'
import type { InvoiceLine } from './SalesInvoiceLinesGrid'
import type { SalesLine } from './SalesLinesGrid'
import type { PartyLookupDto, PriceListLookupDto } from '../../api/types'

/**
 * Helpers around the sales lines and the header's options.
 *
 * NOT IN THE COMPONENT FILES, because of Fast Refresh: a module exporting a component and a plain
 * function loses hot reloading for the component, so the functions live here instead.
 */

/** "CLI-0001 - Walk-in Customer" — code first, so a typed code finds the party at once. */
export function partyLabel(party: PartyLookupDto): string {
  return `${party.partyCode} - ${party.partyName}`
}

/** "Retail USD (USD)" — the currency in brackets, because it decides what every price means. */
export function priceListLabel(list: PriceListLookupDto): string {
  return `${list.priceListName} (${list.currencyCode})`
}

/** The line's amount after its discount, in the invoice currency. */
export function lineTotal(line: SalesLine): number {
  return line.quantity * (line.unitPrice ?? 0) * (1 - line.discountPercent / 100)
}

/** An invoice line's amount after its discount, in the invoice currency. */
export function invoiceLineTotal(line: InvoiceLine): number {
  return line.quantity * (line.unitPrice ?? 0) * (1 - line.discountPercent / 100)
}

/** The key the stock is cached under: one figure per item and warehouse, however many lines share it. */
export function stockKey(itemId: number, warehouseId: number): string {
  return `${itemId}:${warehouseId}`
}

/**
 * True when two lines are the same demand: same item, unit, warehouse, price, discount, expiry and
 * notes. A second import of such a line adds to the first rather than sitting under it.
 */
export function sameLine(a: SalesLine, b: SalesLine): boolean {
  return (
    a.itemId === b.itemId
    && a.itemUnitId === b.itemUnitId
    && a.warehouseId === b.warehouseId
    && a.unitPrice === b.unitPrice
    && a.discountPercent === b.discountPercent
    && (a.expiryDate ?? null) === (b.expiryDate ?? null)
    && a.notes === b.notes
  )
}

let keySeed = 0

/** A wizard row as a line of the page, with a fresh key. */
export function fromImported(line: ImportedLine): SalesLine {
  return {
    key: `sales-${++keySeed}`,
    itemId: line.itemId,
    itemCode: line.itemCode,
    itemName: line.itemName,
    itemUnitId: line.itemUnitId,
    unitTypeName: line.unitTypeName,
    packingFormula: line.packingFormula,
    warehouseId: line.warehouseId,
    warehouseCode: line.warehouseCode,
    expiryDate: line.expiryDate ? line.expiryDate.slice(0, 10) : null,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    priceSource: line.priceSource,
    priceEdited: false,
    discountPercent: line.discountPercent,
    notes: line.notes ?? '',
    importRowNumber: line.importRowNumber,
  }
}

/**
 * Appends imported lines, folding each into an identical existing line when there is one.
 *
 * FOLDING RATHER THAN DUPLICATING, for the same reason a repeated scan increments: the same file
 * imported twice, or two files that both sell the same item, is one demand on the shelf and one
 * line on the invoice. Anything that differs — a price, a note, an expiry — keeps its own row.
 */
export function mergeImported(current: SalesLine[], imported: ImportedLine[]): SalesLine[] {
  const next = current.map((line) => ({ ...line }))
  for (const row of imported) {
    const candidate = fromImported(row)
    const existing = next.find((line) => sameLine(line, candidate))
    if (existing) {
      existing.quantity += candidate.quantity
    } else {
      next.push(candidate)
    }
  }
  return next
}

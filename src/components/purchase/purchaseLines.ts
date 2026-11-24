import type { ItemUnitDto } from '../../api/types'
import type { PurchaseLine } from './PurchaseLinesGrid'

/**
 * Helpers around the purchase lines. NOT IN THE COMPONENT FILE, because of Fast Refresh: a module
 * exporting a component and a plain function loses hot reloading for the component.
 */

/** The line's amount after its discount, in the document currency. */
export function purchaseLineTotal(line: PurchaseLine): number {
  return line.quantity * (line.unitPrice ?? 0) * (1 - line.discountPercent / 100)
}

/**
 * The unit a new purchase line starts in. A PURCHASE ORDER starts in the BASE unit (pieces), as the shortage plan it
 * often comes from (script 122, the owner: "In purchase order and shortage must calc as base unit"); an invoice or a
 * return hand-typed keeps the purchase unit, else the base unit. The user may still choose another unit on the line.
 */
export function purchaseUnitOf(units: ItemUnitDto[], baseFirst = false): ItemUnitDto | undefined {
  const base = units.find((u) => u.isBaseUnit)
  if (baseFirst) return base ?? [...units].sort((x, y) => x.packingFormula - y.packingFormula)[0]
  return units.find((u) => u.isPurchaseUnit) ?? base ?? units[0]
}

/**
 * What a line costs before anybody types: the item's last cost (per base unit, base currency)
 * times the unit's packing, converted at the document rate. Null when the item has never been
 * bought — the server then writes 0, and the empty box says so better than a zero would.
 */
export function defaultPurchasePrice(lastCost: number | null, packingFormula: number, exchangeRate: number | null): number | null {
  if (lastCost === null || exchangeRate === null || exchangeRate <= 0) return null
  return Math.round(lastCost * (packingFormula || 1) * exchangeRate * 10000) / 10000
}

/** The most this line may take from its source line, in the line's own unit. Null when it has no source. */
export function lineMaximum(line: PurchaseLine): number | null {
  if (line.sourceRemainingBase === null) return null
  return Math.floor(line.sourceRemainingBase / (line.packingFormula || 1))
}

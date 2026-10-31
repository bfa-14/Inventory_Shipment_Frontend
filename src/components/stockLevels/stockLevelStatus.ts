import type { CompanyStockLevelStatus, StockLevelRowDto, StockLevelStatus } from '../../api/inventory/stockLevels'
import { formatNumber } from '../format'

/**
 * THE FIVE STATUSES OF A STOCK LEVEL (script 91), one place for their words and colours: the Stock Levels page, Item
 * Definition's "Stock levels per warehouse" card and the dialogs read them here. The status itself is the server's
 * (inventory.fn_StockPosition), the first that applies: no level, Projected < Min, On hand < Min, Projected > Max, OK.
 */
export interface StockLevelStatusInfo {
  label: string
  colour: string
  /** Said on hover: the one status whose name alone does not explain it. */
  tooltip?: string
}

export const STOCK_LEVEL_STATUS: Record<StockLevelStatus, StockLevelStatusInfo> = {
  BelowMin: { label: 'Below Min', colour: 'red' },
  Covered: {
    label: 'Below Min, covered',
    colour: 'orange',
    tooltip: 'On hand is below Min, but transfers on the way or released bring it to Min or more.',
  },
  AboveMax: { label: 'Above Max', colour: 'blue' },
  Ok: { label: 'OK', colour: 'green' },
  NoLevel: { label: 'No level', colour: 'gray' },
}

/** The company view's three (Item Definition's Minimum / Maximum Quantity against the stock): the same words. */
export const COMPANY_STOCK_LEVEL_STATUS: Record<CompanyStockLevelStatus, StockLevelStatusInfo> = {
  BelowMin: STOCK_LEVEL_STATUS.BelowMin,
  AboveMax: STOCK_LEVEL_STATUS.AboveMax,
  Ok: STOCK_LEVEL_STATUS.Ok,
}

/** A status the server sent that this build does not know reads as itself, in gray. */
export function stockLevelStatusInfo(status: string): StockLevelStatusInfo {
  return STOCK_LEVEL_STATUS[status as StockLevelStatus] ?? { label: status, colour: 'gray' }
}

/* ── the words of a level ───────────────────────────────────────────────────────────────────── */

/** "Min 10 / Max 40", "Min 10 / no Max": a level as the dialogs and the import's Now column say it. */
export function levelText(min: number | null | undefined, max: number | null | undefined): string {
  if (min === null || min === undefined) return '—'
  return `Min ${formatNumber(min)} / ${max === null || max === undefined ? 'no Max' : `Max ${formatNumber(max)}`}`
}

/** "LUB-01 - Lubumbashi Warehouse". */
export function levelWarehouseText(row: Pick<StockLevelRowDto, 'warehouseCode' | 'warehouseName'>): string {
  return row.warehouseName ? `${row.warehouseCode} - ${row.warehouseName}` : row.warehouseCode
}

/** The sentence an inactive warehouse's level is disabled with (the server's 56000, said before the click). */
export function inactiveWarehouseText(warehouseCode: string): string {
  return `Warehouse ${warehouseCode} is inactive: activate it to change its levels.`
}

/** "24/10/2026": the reader's local day of a *Utc moment (the level's Updated). */
export function localDay(utc: string | null | undefined): string {
  if (!utc) return '—'
  const date = new Date(utc)
  if (Number.isNaN(date.getTime())) return utc
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

/** "24/10/2026 by Manager One", "—" without a level. */
export function updatedText(row: Pick<StockLevelRowDto, 'updatedAtUtc' | 'updatedByName'>): string {
  if (!row.updatedAtUtc) return '—'
  return row.updatedByName ? `${localDay(row.updatedAtUtc)} by ${row.updatedByName}` : localDay(row.updatedAtUtc)
}

/** "{a} on the way · {b} still to dispatch": what makes up a warehouse's Coming in. */
export function comingInText(row: Pick<StockLevelRowDto, 'inOnTheWayBase' | 'inToDispatchBase'>): string {
  return `${formatNumber(row.inOnTheWayBase)} on the way · ${formatNumber(row.inToDispatchBase)} still to dispatch`
}

/** "LUB-01 · On hand 12 · Projected 18 · Min 20 / Max 60": a level on a phone, one line. */
export function levelPhoneLine(row: StockLevelRowDto, withWarehouse = true): string {
  const parts = [
    withWarehouse ? row.warehouseCode : null,
    `On hand ${formatNumber(row.onHandBase)}`,
    `Projected ${formatNumber(row.projectedBase)}`,
    row.hasLevel ? levelText(row.minQuantityBase, row.maxQuantityBase) : null,
  ]
  return parts.filter((part): part is string => part !== null).join(' · ')
}

/* ── the tooltips of the columns (the page and the card say the same) ─────────────────────────── */

export const LEVEL_COLUMN_HINTS = {
  inOnTheWay: 'Dispatched to this warehouse, not received yet (transfer orders).',
  toComeIn: 'Released transfer orders to this warehouse, not dispatched yet.',
  toGoOut: 'Released transfer orders from this warehouse, not dispatched yet: promised, still on the shelf.',
  projected: 'On hand + on the way in + to come in − to go out.',
  toReachMax: 'What Fill to Max would ask for: Max (else Min) − Projected, when Projected is below Min.',
} as const

/** The Remove confirmation's question (the card and the page ask the same). */
export function removeLevelQuestion(itemCode: string, warehouseCode: string): string {
  return `Remove the Min / Max of ${itemCode} at ${warehouseCode}? Fill to Max then leaves this item alone there.`
}

import type {
  ItemBalanceReportResult,
  ItemBalanceRowDto,
  ItemBalanceTotalsDto,
} from '../../api/reports/itemBalance'
import { formatNumber } from '../../components/format'

/**
 * THE COLUMNS OF THE ITEM BALANCE REPORT, ONCE: the screen and the print page draw the same list, and the API's Excel
 * export builds the same one (ItemBalanceReportService.BuildWorkbook), so the three match in rows, columns and totals.
 *
 * Each figure column sits under a group header (Opening, a kind of movement, Total in, ..., Closing) with its Qty or
 * Amount. Amount columns exist only when the reader sees amounts; a kind of movement without activity is left out while
 * "Hide empty transaction columns" is on; Translation difference only for another currency, and only when some row has
 * one.
 */
export interface BalanceColumn {
  key: string
  /** The header above (empty for the identification columns). */
  group: string
  header: string
  kind: 'text' | 'qty' | 'amount'
  value: (row: ItemBalanceRowDto) => string | number | null
  total?: (totals: ItemBalanceTotalsDto) => number | null
  /** The movement group a click on the cell opens (the drill-down); '' = every movement of the period. */
  drill?: string
}

export function balanceColumns(report: ItemBalanceReportResult, hideEmpty: boolean): BalanceColumn[] {
  const sees = report.seesAmounts
  const columns: BalanceColumn[] = [
    { key: 'itemCode', group: '', header: 'Item code', kind: 'text', value: (r) => r.itemCode },
    { key: 'itemName', group: '', header: 'Item name', kind: 'text', value: (r) => r.itemName },
    { key: 'unit', group: '', header: 'UoM', kind: 'text', value: (r) => r.unit ?? '' },
    { key: 'warehouse', group: '', header: 'Warehouse', kind: 'text', value: (r) => `${r.warehouseCode} ${r.warehouseName}` },
    {
      key: 'location', group: '', header: 'Location', kind: 'text',
      value: (r) => (r.locationCode ? `${r.locationCode} ${r.locationName ?? ''}` : ''),
    },
    { key: 'openingQty', group: 'Opening', header: 'Qty', kind: 'qty', value: (r) => r.openingQuantity, total: (t) => t.openingQuantity },
  ]
  if (sees) {
    columns.push({ key: 'openingAmount', group: 'Opening', header: 'Amount', kind: 'amount', value: (r) => r.openingAmount, total: (t) => t.openingAmount })
  }

  for (const group of report.groups) {
    if (hideEmpty && !group.hasActivity) continue
    if (group.direction !== 'Value') {
      columns.push({
        key: `${group.code}:qty`, group: group.label, header: 'Qty', kind: 'qty', drill: group.code,
        value: (r) => r.movements[group.code]?.quantity ?? 0,
        total: (t) => t.movements[group.code]?.quantity ?? 0,
      })
    }
    if (sees) {
      columns.push({
        key: `${group.code}:amount`, group: group.label, header: 'Amount', kind: 'amount', drill: group.code,
        value: (r) => r.movements[group.code]?.amount ?? 0,
        total: (t) => t.movements[group.code]?.amount ?? 0,
      })
    }
  }

  columns.push({ key: 'inQty', group: 'Total in', header: 'Qty', kind: 'qty', drill: '', value: (r) => r.totalInQuantity, total: (t) => t.totalInQuantity })
  if (sees) columns.push({ key: 'inAmount', group: 'Total in', header: 'Amount', kind: 'amount', drill: '', value: (r) => r.totalInAmount, total: (t) => t.totalInAmount })
  columns.push({ key: 'outQty', group: 'Total out', header: 'Qty', kind: 'qty', drill: '', value: (r) => r.totalOutQuantity, total: (t) => t.totalOutQuantity })
  if (sees) {
    columns.push({ key: 'outAmount', group: 'Total out', header: 'Amount', kind: 'amount', drill: '', value: (r) => r.totalOutAmount, total: (t) => t.totalOutAmount })
    columns.push({ key: 'avgChange', group: 'Average cost change', header: 'Amount', kind: 'amount', value: (r) => r.averageCostChange, total: (t) => t.averageCostChange })
  }
  const translated = sees && report.currency !== null && !report.currency.isBaseCurrency
  if (translated && report.rows.some((r) => r.translationDifference !== null && Math.abs(r.translationDifference) >= 0.005)) {
    columns.push({
      key: 'translation', group: 'Translation difference', header: 'Amount', kind: 'amount',
      value: (r) => r.translationDifference, total: (t) => t.translationDifference,
    })
  }
  columns.push({ key: 'closingQty', group: 'Closing', header: 'Qty', kind: 'qty', value: (r) => r.closingQuantity, total: (t) => t.closingQuantity })
  if (sees) {
    columns.push({ key: 'closingAmount', group: 'Closing', header: 'Amount', kind: 'amount', value: (r) => r.closingAmount, total: (t) => t.closingAmount })
    columns.push({ key: 'unitCost', group: 'Closing', header: 'Unit cost', kind: 'amount', value: (r) => r.unitCost })
  }
  return columns
}

/** The header row above: each group once, spanning its columns. */
export function headerGroups(columns: BalanceColumn[]): { label: string; span: number }[] {
  const groups: { label: string; span: number }[] = []
  for (const column of columns) {
    const last = groups[groups.length - 1]
    if (last && last.label === column.group && column.group !== '') last.span += 1
    else groups.push({ label: column.group, span: 1 })
  }
  return groups
}

/** A figure as shown: quantities whole, amounts in the currency's decimals; a zero movement shows as nothing. */
export function cellText(column: BalanceColumn, value: string | number | null, decimals: number, blankZero = true): string {
  if (column.kind === 'text') return String(value ?? '')
  if (value === null || typeof value === 'string') return value ?? ''
  if (blankZero && value === 0 && column.drill !== undefined) return ''
  return formatNumber(value, column.kind === 'qty' ? 0 : decimals)
}

/** "1 USD = 0.92 EUR, the rate of 30/09/2026 (in force on 30/09/2026)". */
export function rateText(report: ItemBalanceReportResult, which: 'opening' | 'closing'): string | null {
  const rate = which === 'opening' ? report.openingRate : report.closingRate
  if (!rate || !report.currency || report.currency.isBaseCurrency) return null
  const day = (value: string | null) => {
    if (!value) return ''
    const [y, m, d] = value.slice(0, 10).split('-')
    return `${d}/${m}/${y}`
  }
  return `${formatNumber(rate.rate, 6).replace(/\.?0+$/, '')} on ${day(rate.asOf)} (the rate of ${day(rate.rateDate)})`
}

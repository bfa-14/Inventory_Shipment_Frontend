import type {
  GoodsReceiptCostSource,
  GoodsReceiptDto,
  GoodsReceiptLineDto,
  GoodsReceiptSourceKind,
  VarianceReasonCode,
} from '../../../api/purchase/goodsReceipts'
import type { ItemUnitDto, WarehouseLookupDto } from '../../../api/types'
import { formatNumber } from '../../format'
import { NOT_ONE_OF_YOURS } from '../../documents/lineWarehouses'

/**
 * The goods receipt page's working shapes and the sentences more than one place says.
 *
 * NOT IN A COMPONENT FILE, because of Fast Refresh: a module exporting a component and a plain value loses hot
 * reloading for the component.
 */

/** A container receipt of several suppliers has none on its header. */
export const SEVERAL_SUPPLIERS = 'Several suppliers'

/** The gray hint of every draft. */
export const DRAFT_HINT = 'The goods are not in stock until this receipt is posted.'

/** Under "+ New › Without an order", and on such a receipt: where stock that is not a supplier's goes. */
export const MANUAL_HINT =
  'For stock that does not come from a supplier (opening balance, correction, found goods), use Inventory › Inventory In.'

/** The two hints of the "Receive goods" dialog. */
export const CONTAINERS_HINT = 'Goods in containers are received with their container.'
export const ORDER_PRICE_HINT =
  'Pieces not invoiced yet are valued at the order price; the invoice adjusts their cost when it is posted.'

/**
 * The order-price hint as the purchase invoice type has it (script 79): with "Affects item cost" off, invoices never
 * change the cost, so promising that "the invoice adjusts their cost" would be untrue. `affectsItemCost` undefined
 * (types not loaded yet) reads as today's default, on.
 */
export function orderPriceHint(affectsItemCost: boolean | undefined): string {
  return affectsItemCost === false
    ? 'Pieces are valued at the order price; purchase invoices do not change item costs (Configuration › Document Types).'
    : ORDER_PRICE_HINT
}

/** The hint of the "Cost adjustments" card. */
export const COST_ADJUSTMENTS_HINT =
  'The part still in stock changes the average cost; the part already sold goes to the cost of sales. A difference of exchange rate between the order and the invoice is part of the cost.'

/** "KTG-… has not left the supplier": the orange warning of a container still Confirmed (status 2, rule 6). */
export function notDispatchedText(containerRef: string): string {
  return `${containerRef} has not left the supplier: no dispatch date or movement. Receive it only if the goods are really here.`
}

/** "Container KTG-2026-0031", "Order PO-BR-002-000042", "Invoice PINV-BR-003-000011", "Manual". */
export function sourceText(row: {
  sourceKind: GoodsReceiptSourceKind
  containerRef: string | null
  purchaseOrderNumber: string | null
  purchaseInvoiceNumber: string | null
}): string {
  switch (row.sourceKind) {
    case 'Container':
      return `Container ${row.containerRef ?? ''}`.trim()
    case 'Order':
      return `Order ${row.purchaseOrderNumber ?? ''}`.trim()
    case 'Invoice':
      return `Invoice ${row.purchaseInvoiceNumber ?? ''}`.trim()
    default:
      return 'Manual'
  }
}

/** "SUP-0001 - TVS Motor Company", or "Several suppliers" on a mixed container. */
export function supplierText(row: { supplierCode: string | null; supplierName: string | null }): string {
  if (!row.supplierName) return SEVERAL_SUPPLIERS
  return row.supplierCode ? `${row.supplierCode} - ${row.supplierName}` : row.supplierName
}

/** "GRN-BR-002-000001", or how a draft is named in a sentence. */
export function receiptLabel(row: { id: number; documentNumber: string | null }): string {
  return row.documentNumber ?? `draft #${row.id}`
}

/* ── the confirmations ─────────────────────────────────────────────────────────────────────── */

/**
 * Post confirm: "{n} pcs enter {warehouse} at {value} {USD}, ...". The sentence about the order price only when a line
 * has one (an order's or a container's line): a receipt without an order has its cost typed, and an invoice's lines
 * are invoiced already.
 */
export function postConfirmMessage(pieces: number, warehouse: string, value: number, currencyCode: string, atOrderPrice = true): string {
  const first = `Post this goods receipt? ${formatNumber(pieces)} pcs enter ${warehouse} at ${formatNumber(value, 2)} ${currencyCode}, the item costs are updated and the number is assigned.`
  return atOrderPrice
    ? `${first} Pieces not invoiced yet are valued at the order price; their cost is adjusted when the invoice is posted.`
    : first
}

/**
 * The post confirm of a SAVED receipt, from its lines: what the page asks, and the list's row Post (which reads the
 * receipt first). The value is the server's when it has one, else the estimate of the lines.
 */
export function postConfirmFor(receipt: GoodsReceiptDto, warehouses: WarehouseLookupDto[]): string {
  const lines = receipt.lines.map((line) => toLineForm(line))
  const pieces = lines.reduce((sum, line) => sum + receivedBaseOf(line), 0)
  const estimate = lines.reduce((sum, line) => sum + (lineValueOf(line, false) ?? 0), 0)
  const value = receipt.currentValueBase > 0 ? receipt.currentValueBase : estimate
  const atOrderPrice = lines.some((line) => line.kind === 'order' || line.kind === 'container')
  return postConfirmMessage(pieces, warehousesOf(lines, receipt.warehouseCode, warehouses), value, receipt.baseCurrencyCode ?? 'USD', atOrderPrice)
}

/** The cancel dialog's text; a container receipt says what happens to the container too. */
export function cancelDescription(documentNumber: string | null, containerRef: string | null): string {
  const first = `Cancel goods receipt ${documentNumber ?? ''}? The stock it brought is taken out again and the item costs are replayed.`
  return containerRef ? `${first} Container ${containerRef} goes back to its delivery status and can be received again.` : first
}

/** Deleting a draft: an automatic one leaves its container waiting without a receipt. */
export function deleteDraftMessage(row: { isAuto: boolean; containerRef: string | null }): string {
  if (row.isAuto && row.containerRef) {
    return `Delete this draft goods receipt? ${row.containerRef} then waits without a receipt: create it again with Receive goods… on the container.`
  }
  return 'Delete this draft goods receipt? This cannot be undone.'
}

/** "Received into {warehouse} on {date} by {user}. ..." - the banner of a posted receipt. */
export function postedBanner(warehouse: string, date: string, user: string): string {
  return `Received into ${warehouse} on ${date} by ${user}. The stock and the item costs were updated; this receipt can no longer be edited.`
}

/* ── the lines being edited ────────────────────────────────────────────────────────────────── */

export type LineKind = 'container' | 'order' | 'invoice' | 'manual'

/**
 * One line while it is being edited. Nullable where a manual line starts empty; the server's figures (cost, value,
 * matched pieces) ride along read-only and are refreshed by every save.
 */
export interface GoodsReceiptLineForm {
  key: string
  id: number | null
  kind: LineKind
  itemId: number | null
  itemCode: string
  itemName: string
  itemUnitId: number | null
  unitTypeName: string
  packingFormula: number
  /** What the Unit select offers (manual lines); seeded with the line's own unit. */
  units: Pick<ItemUnitDto, 'id' | 'unitTypeName' | 'packingFormula'>[]
  /** Received, in the line's unit. */
  quantity: number
  expectedQuantityBase: number | null
  warehouseId: number | null
  poLineId: number | null
  invoiceLineId: number | null
  containerLineId: number | null
  orderNumber: string | null
  invoiceNumber: string | null
  containerLineNumber: number | null
  supplierName: string | null
  varianceReasonCode: VarianceReasonCode | null
  varianceReason: string
  closeShort: boolean
  /** Manual lines: the typed cost per piece (base currency). */
  manualUnitCostBase: number | null
  expiryDate: string | null
  notes: string
  /* Read-only, from the last read of the receipt. */
  unitCostBase: number | null
  poFobBase: number | null
  costSource: GoodsReceiptCostSource | null
  settledShortBase: number
  invoicedBase: number
  valueBase: number | null
  warehouseCode: string | null
  warehouseName: string | null
  /** A "Line N: …" message the API sent back about this row. */
  error?: string
}

let keySeed = 0
export const nextLineKey = () => `grl-${++keySeed}`

/** What a line is, from its links: no order, no invoice, no container = typed on a receipt without an order. */
export function lineKindOf(line: Pick<GoodsReceiptLineDto, 'containerLineId' | 'invoiceLineId' | 'poLineId'>): LineKind {
  if (line.containerLineId !== null) return 'container'
  if (line.invoiceLineId !== null) return 'invoice'
  if (line.poLineId !== null) return 'order'
  return 'manual'
}

export function toLineForm(line: GoodsReceiptLineDto): GoodsReceiptLineForm {
  return {
    key: nextLineKey(),
    id: line.id,
    kind: lineKindOf(line),
    itemId: line.itemId,
    itemCode: line.itemCode,
    itemName: line.itemName,
    itemUnitId: line.itemUnitId,
    unitTypeName: line.unitTypeName ?? '',
    packingFormula: line.packingFormula || 1,
    units: [{ id: line.itemUnitId, unitTypeName: line.unitTypeName ?? '', packingFormula: line.packingFormula || 1 }],
    quantity: line.quantity,
    expectedQuantityBase: line.expectedQuantityBase,
    warehouseId: line.warehouseId,
    poLineId: line.poLineId,
    invoiceLineId: line.invoiceLineId,
    containerLineId: line.containerLineId,
    orderNumber: line.orderNumber,
    invoiceNumber: line.invoiceNumber,
    containerLineNumber: line.containerLineNumber,
    supplierName: line.supplierName,
    varianceReasonCode: line.varianceReasonCode,
    varianceReason: line.varianceReason ?? '',
    closeShort: line.closeShort,
    manualUnitCostBase: line.manualUnitCostBase,
    expiryDate: line.expiryDate ? line.expiryDate.slice(0, 10) : null,
    notes: line.notes ?? '',
    unitCostBase: line.unitCostBase,
    poFobBase: line.poFobBase,
    costSource: line.costSource,
    settledShortBase: line.settledShortBase ?? 0,
    invoicedBase: line.invoicedBase ?? 0,
    valueBase: line.valueBase,
    warehouseCode: line.warehouseCode,
    warehouseName: line.warehouseName,
  }
}

export function emptyManualLine(warehouseId: number | null): GoodsReceiptLineForm {
  return {
    key: nextLineKey(),
    id: null,
    kind: 'manual',
    itemId: null,
    itemCode: '',
    itemName: '',
    itemUnitId: null,
    unitTypeName: '',
    packingFormula: 1,
    units: [],
    quantity: 1,
    expectedQuantityBase: null,
    warehouseId,
    poLineId: null,
    invoiceLineId: null,
    containerLineId: null,
    orderNumber: null,
    invoiceNumber: null,
    containerLineNumber: null,
    supplierName: null,
    varianceReasonCode: null,
    varianceReason: '',
    closeShort: false,
    manualUnitCostBase: null,
    expiryDate: null,
    notes: '',
    unitCostBase: null,
    poFobBase: null,
    costSource: 'Manual',
    settledShortBase: 0,
    invoicedBase: 0,
    valueBase: null,
    warehouseCode: null,
    warehouseName: null,
  }
}

/** Received pieces. */
export function receivedBaseOf(line: Pick<GoodsReceiptLineForm, 'quantity' | 'packingFormula'>): number {
  return line.quantity * (line.packingFormula || 1)
}

/** Received − expected in pieces; null on a manual line (nothing was expected). */
export function differenceOf(line: GoodsReceiptLineForm): number | null {
  return line.expectedQuantityBase === null ? null : receivedBaseOf(line) - line.expectedQuantityBase
}

/**
 * The pieces a line settles short: a container line always (a reason is required when it differs), a local line only
 * with "Nothing more will come". A posted line says it itself (settledShortBase).
 */
export function shortOf(line: GoodsReceiptLineForm, posted: boolean): number {
  if (posted) return line.settledShortBase
  if (line.expectedQuantityBase === null) return 0
  if (line.kind !== 'container' && !line.closeShort) return 0
  return Math.max(0, line.expectedQuantityBase - receivedBaseOf(line))
}

/**
 * The cost per piece a line is valued at: what the server says it is now, else (a draft) the typed cost of a manual
 * line or the order price of the others. Null when nothing is known yet.
 */
export function unitCostOf(line: GoodsReceiptLineForm): number | null {
  if (line.kind === 'manual' && line.manualUnitCostBase !== null) return line.manualUnitCostBase
  return line.unitCostBase ?? line.poFobBase ?? null
}

/** The badge under "Unit cost": "Order price" / "Invoice" / "Order + invoice" / "Typed". */
export function costSourceOf(line: GoodsReceiptLineForm): GoodsReceiptCostSource | null {
  if (line.kind === 'manual') return line.costSource === 'Invoice' || line.costSource === 'Mixed' ? line.costSource : 'Manual'
  return line.costSource ?? (line.poFobBase !== null ? 'Order' : null)
}

/** Received × the cost per piece; on a posted receipt the server's own value. */
export function lineValueOf(line: GoodsReceiptLineForm, posted: boolean): number | null {
  if (posted && line.valueBase !== null) return line.valueBase
  const cost = unitCostOf(line)
  return cost === null ? null : receivedBaseOf(line) * cost
}

/* ── warehouse pickers ─────────────────────────────────────────────────────────────────────── */

export interface WarehouseOption {
  value: string
  label: string
}

export interface WarehouseGroup {
  group: string
  items: WarehouseOption[]
}

export function warehouseLabel(w: Pick<WarehouseLookupDto, 'warehouseCode' | 'warehouseName'>): string {
  return `${w.warehouseCode} - ${w.warehouseName}`
}

/**
 * The warehouses a line may be received into, grouped by branch: every active warehouse AT THE BOTTOM OF THE TREE, or
 * only those of one branch (a container is received in its own branch). A warehouse with warehouses under it is a
 * group, not a place that holds stock (scripts 70, 72): the same rule as every document line (see lineWarehouses).
 * `firstBranchId` (the receipt's or the document's branch) puts its group first. The line's current warehouse stays an
 * option even when it is no longer allowed - inactive, or a parent, marked so - so the cell never goes blank.
 *
 * `usableOnly` (92): only the leaves the READER may use (`canUse` of the lookup, missing = true); a kept one the reader
 * may not use stays, marked "- not one of your warehouses" (the parent's mark wins). Left out, exactly what it was.
 */
export function warehouseChoices(
  warehouses: WarehouseLookupDto[],
  branchId: number | null,
  keep: { id: number | null; code: string | null; name: string | null }[] = [],
  firstBranchId: number | null = null,
  usableOnly = false,
): WarehouseGroup[] {
  const kept = (w: WarehouseLookupDto) => keep.some((k) => k.id === w.id)
  const isLeaf = (w: WarehouseLookupDto) => w.childCount === 0
  const usable = (w: WarehouseLookupDto) => !usableOnly || w.canUse !== false
  const shown = warehouses
    .filter((w) => ((w.isActive && isLeaf(w) && usable(w)) || kept(w)) && (branchId === null || w.branchId === branchId))
    .sort((a, b) => Number(b.branchId === firstBranchId) - Number(a.branchId === firstBranchId))
  const groups = new Map<string, WarehouseOption[]>()
  for (const w of shown) {
    const group = `${w.branchCode} - ${w.branchName}`
    const list = groups.get(group) ?? []
    const label = !isLeaf(w)
      ? `${warehouseLabel(w)} - has warehouses under it, choose one of those`
      : usable(w)
        ? warehouseLabel(w)
        : `${warehouseLabel(w)} - ${NOT_ONE_OF_YOURS}`
    list.push({ value: String(w.id), label })
    groups.set(group, list)
  }
  const missing = keep.filter((k) => k.id !== null && !shown.some((w) => w.id === k.id))
  const result = [...groups.entries()].map(([group, items]) => ({ group, items }))
  if (missing.length > 0) {
    const items = missing
      .filter((k, index) => missing.findIndex((m) => m.id === k.id) === index)
      .map((k) => ({ value: String(k.id), label: k.code ? `${k.code} - ${k.name ?? ''}` : `#${k.id}` }))
    result.unshift({ group: 'Current', items })
  }
  return result
}

/** Every listed warehouse code of a receipt, for the post confirmation: "LUB-WH" or "LUB-WH, LIK-WH". */
export function warehousesOf(lines: GoodsReceiptLineForm[], headerWarehouse: string | null, lookup: WarehouseLookupDto[]): string {
  const codes = new Set<string>()
  for (const line of lines) {
    if (receivedBaseOf(line) <= 0) continue
    const w = lookup.find((x) => x.id === line.warehouseId)
    const code = w?.warehouseCode ?? line.warehouseCode
    if (code) codes.add(code)
  }
  if (codes.size === 0 && headerWarehouse) return headerWarehouse
  return codes.size === 0 ? 'the warehouse' : [...codes].join(', ')
}

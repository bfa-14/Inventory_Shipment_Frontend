import type { BulkActionItemResult } from '../documents'
import { documentFilesApi, saveBlob, type DocumentFileDto } from '../documentFiles'
import { fetchBlob, request } from '../http'
import type { PagedResult } from '../types'

/**
 * Goods receipts (GRN, scripts 64-65): the ONLY way goods enter the stock from a supplier. A posted supplier invoice
 * no longer moves stock; it adjusts the cost of the goods already received.
 *
 * A RECEIPT HAS ONE SOURCE: a container (created as a draft when its Delivery movement is completed, or with Receive
 * goods… on the container), an order or an invoice (Receive goods… on them, or + New › From a purchase order…), or
 * nothing (+ New › Without an order: a supplier and typed costs). Draft → Posted → Cancelled; numbered per branch at
 * posting (GRN-BR-002-000001).
 *
 * QUANTITIES ARE PIECES (base units) wherever a name ends in `Base`; costs are per piece in the base currency.
 *
 * Every write that answers with the receipt answers with the WHOLE receipt, so the page replaces its copy.
 */
const BASE = '/api/purchase/goods-receipts'

/* ── statuses, sources, reasons ─────────────────────────────────────────────────────────────── */

/** 1 Draft, 2 Posted, 3 Cancelled (purchase.GoodsReceipts.Status). */
export type GoodsReceiptStatusCode = 1 | 2 | 3

export const GOODS_RECEIPT_STATUSES: readonly { value: GoodsReceiptStatusCode; label: string; colour: string }[] = [
  { value: 1, label: 'Draft', colour: 'gray' },
  { value: 2, label: 'Posted', colour: 'green' },
  { value: 3, label: 'Cancelled', colour: 'red' },
]

export function goodsReceiptStatusLabel(status: GoodsReceiptStatusCode): string {
  return GOODS_RECEIPT_STATUSES.find((s) => s.value === status)?.label ?? String(status)
}

export function goodsReceiptStatusColour(status: GoodsReceiptStatusCode): string {
  return GOODS_RECEIPT_STATUSES.find((s) => s.value === status)?.colour ?? 'gray'
}

/**
 * The status as a code, whatever shape it came in: the number the table holds, or its name. The API is the one that
 * decides the shape; reading both keeps a list from showing every receipt as a draft over a naming difference.
 */
export function toGoodsReceiptStatus(value: unknown): GoodsReceiptStatusCode {
  if (value === 2 || value === '2' || value === 'Posted') return 2
  if (value === 3 || value === '3' || value === 'Cancelled') return 3
  return 1
}

/** Where the receipt's lines came from. */
export type GoodsReceiptSourceKind = 'Container' | 'Order' | 'Invoice' | 'Manual'

export const GOODS_RECEIPT_SOURCES: readonly { value: GoodsReceiptSourceKind; label: string }[] = [
  { value: 'Container', label: 'Container' },
  { value: 'Order', label: 'Order' },
  { value: 'Invoice', label: 'Invoice' },
  { value: 'Manual', label: 'Manual' },
]

/** Why a line's received pieces differ from the expected ones (GoodsReceiptLines.VarianceReasonCode). */
export type VarianceReasonCode = 'SHORT' | 'DAMAGED' | 'MISSING' | 'LOADCOUNT' | 'OTHER'

export const VARIANCE_REASONS: readonly { value: VarianceReasonCode; label: string }[] = [
  { value: 'SHORT', label: 'Short-shipped' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'MISSING', label: 'Missing' },
  { value: 'LOADCOUNT', label: 'Wrongly counted at loading' },
  { value: 'OTHER', label: 'Other' },
]

export function varianceReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return VARIANCE_REASONS.find((r) => r.value === code)?.label ?? code
}

/**
 * Where a line's CURRENT cost comes from: the order price (no posted invoice matched yet), the invoice, both (part of
 * the pieces matched), or the cost typed on a receipt without an order.
 */
export type GoodsReceiptCostSource = 'Order' | 'Invoice' | 'Mixed' | 'Manual'

export const COST_SOURCE_LABELS: Record<GoodsReceiptCostSource, string> = {
  Order: 'Order price',
  Invoice: 'Invoice',
  Mixed: 'Order + invoice',
  Manual: 'Typed',
}

/** What moved the cost of received goods (GoodsReceiptCostChanges.CauseKind). */
export type GoodsReceiptCostCause = 'PINV' | 'PINVCANCEL' | 'LCA' | 'LCACANCEL' | 'GRNPOST' | 'GRNCANCEL' | 'NEGSTOCK'

/** "Invoice PINV-BR-003-000011 posted", "Sold before receipt"... - the Cause column of the "Cost adjustments" card. */
export function costCauseLabel(kind: string, number: string | null): string {
  const ref = number ?? ''
  switch (kind as GoodsReceiptCostCause) {
    case 'PINV':
      return `Invoice ${ref} posted`
    case 'PINVCANCEL':
      return `Invoice ${ref} cancelled`
    case 'LCA':
      return `Landed cost adjustment ${ref}`
    case 'LCACANCEL':
      return `Landed cost adjustment ${ref} cancelled`
    case 'GRNPOST':
      return `Goods receipt ${ref} posted`
    case 'GRNCANCEL':
      return `Goods receipt ${ref} cancelled`
    case 'NEGSTOCK':
      return 'Sold before receipt'
    default:
      return number ? `${kind} ${number}` : kind
  }
}

/* ── the list ───────────────────────────────────────────────────────────────────────────────── */

export interface GoodsReceiptListItemDto {
  id: number
  /** Null on a draft: "Assigned on posting". */
  documentNumber: string | null
  /** The date received (yyyy-MM-dd). */
  documentDate: string
  status: GoodsReceiptStatusCode
  statusName: string
  sourceKind: GoodsReceiptSourceKind
  branchId: number
  branchCode: string | null
  branchName: string
  /** Null on a container of several suppliers: "Several suppliers". */
  supplierId: number | null
  supplierCode: string | null
  supplierName: string | null
  /** "Receive into"; null on a draft whose warehouse is still to choose. */
  warehouseId: number | null
  warehouseCode: string | null
  warehouseName: string | null
  containerId: number | null
  containerRef: string | null
  containerNo: string | null
  purchaseOrderId: number | null
  purchaseOrderNumber: string | null
  purchaseInvoiceId: number | null
  purchaseInvoiceNumber: string | null
  movementId: number | null
  movementNo: string | null
  /** "Delivery note no." */
  supplierReference: string | null
  /** Created by the completion of a Delivery movement. */
  isAuto: boolean
  lineCount: number
  expectedBase: number
  receivedBase: number
  /** Pieces settled short (on a draft: what posting it would settle). */
  shortBase: number
  /** Received pieces matched to posted supplier invoices. */
  invoicedBase: number
  /**
   * At the current cost per piece, in the base currency; an estimate on a draft (isValueEstimate). (94) Null without View
   * item costs (inventory.costs.view).
   */
  valueBase: number | null
  isValueEstimate: boolean
  postedAtUtc: string | null
  postedByName: string | null
  createdAtUtc: string | null
  createdByName: string | null
  updatedAtUtc: string | null
  /** What a row's Post, Cancel and Delete send back (concurrency). */
  rowVersion: string | null
}

/** The totals row of the search: what month-end asks about (posted lines received and not matched to a posted invoice). */
export interface GoodsReceiptTotalsDto {
  receivedNotInvoicedBase: number
  /** The same pieces at the order price, in the base currency. (94) Null without View item costs (the pieces stay). */
  receivedNotInvoicedValueBase: number | null
  /** Receipts matching the filters, and how many of them are drafts. */
  receiptCount: number
  draftCount: number
}

/** The drafts waiting to be posted (`GET …/waiting`): the menu count and its detail. */
export interface GoodsReceiptWaitingDto {
  draftCount: number
  /** Drafts made by the completion of a Delivery movement. */
  autoDraftCount: number
  /** Container drafts whose warehouse is still to choose. */
  withoutWarehouseCount: number
  oldestDraftDate: string | null
  oldestCreatedAtUtc: string | null
}

export interface GoodsReceiptSearchResultDto extends PagedResult<GoodsReceiptListItemDto> {
  totals: GoodsReceiptTotalsDto | null
}

export interface GoodsReceiptQuery {
  /** Number, container ref or no., order and invoice numbers, item code. */
  search?: string
  status?: GoodsReceiptStatusCode
  sourceKind?: GoodsReceiptSourceKind
  branchId?: number
  supplierId?: number
  warehouseId?: number
  dateFrom?: string
  dateTo?: string
  containerId?: number
  purchaseOrderId?: number
  invoiceId?: number
  /** Lines whose received pieces differ from the expected ones. */
  withDifferences?: boolean
  /** Posted lines with pieces not matched to a posted invoice. */
  receivedNotInvoiced?: boolean
  movementId?: number
  isAuto?: boolean
  /** Draft container receipts whose container's Delivery is completed: at the warehouse, not in stock. */
  deliveredNotReceived?: boolean
  /** Drafts of any source (the menu count's list). */
  notReceived?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/* ── the document ───────────────────────────────────────────────────────────────────────────── */

export interface GoodsReceiptLineDto {
  id: number
  goodsReceiptId: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  itemUnitId: number
  unitTypeName: string | null
  skuCode: string | null
  packingFormula: number
  /** Received, in the line's unit. */
  quantity: number
  /** Received pieces. */
  quantityBase: number
  /** Container: loaded; order or invoice: what remained to receive when the draft was made; null on a manual line. */
  expectedQuantityBase: number | null
  /** Received − expected; null without an expected quantity. */
  differenceBase: number | null
  varianceReasonCode: VarianceReasonCode | null
  /** "Short-shipped", "Damaged"…: the code's name. */
  varianceReasonName: string | null
  /** The free note of the reason. */
  varianceReason: string | null
  /** Local lines: "Nothing more will come" (container lines always settle). */
  closeShort: boolean
  /** Set at posting: expected − received when settled, else 0. */
  settledShortBase: number
  warehouseId: number | null
  warehouseCode: string | null
  warehouseName: string | null
  supplierId: number | null
  supplierCode: string | null
  supplierName: string | null
  purchaseOrderId: number | null
  poLineId: number | null
  poLineNumber: number | null
  orderNumber: string | null
  /** The order line's ordered pieces, its unit and packing. */
  orderedBase: number | null
  orderUnitTypeName: string | null
  orderPackingFormula: number | null
  invoiceId: number | null
  invoiceLineId: number | null
  invoiceLineNumber: number | null
  invoiceNumber: string | null
  containerLineId: number | null
  containerLineNumber: number | null
  /** Container lines: the loaded pieces. */
  loadedBase: number | null
  expiryDate: string | null
  /* (94) The costs and values below are null without View item costs (inventory.costs.view); the source names stay. */
  /** The order price per piece in the base currency (frozen at posting). */
  poFobBase: number | null
  /** The order price per piece (frozen, or as it stands on a draft). */
  orderPriceBase: number | null
  /** Manual lines: the typed cost per piece. */
  manualUnitCostBase: number | null
  /** The CURRENT cost per piece; for a container line, the container line's. */
  fobCostBase: number | null
  chargesBase: number | null
  unitCostBase: number | null
  /** The cost is an estimate (a draft). */
  isCostEstimate: boolean
  /** The cost written on the stock movement when the receipt was posted. */
  costAtReceiptBase: number | null
  costSource: GoodsReceiptCostSource | null
  /** "Order price", "Invoice", "Order + invoice", "Typed". */
  costSourceName: string | null
  /** Pieces matched to posted invoices. */
  invoicedBase: number
  notInvoicedBase: number
  /** Received × the current cost, in the base currency. */
  valueBase: number | null
  notes: string | null
}

/** Which received pieces each posted invoice line pays for. */
export interface GoodsReceiptMatchDto {
  goodsReceiptLineId: number
  lineNumber: number | null
  itemId: number
  itemCode: string
  invoiceLineId: number
  invoiceId: number | null
  invoiceNumber: string | null
  invoiceDate: string | null
  invoicePostedAtUtc: string | null
  invoiceLineNumber: number
  quantityBase: number
  /** The invoice's FOB per piece in the base currency. (94) Null, with the landed cost, without View item costs. */
  invoiceFobBase: number | null
  /** The invoice's landed cost per piece in the base currency. */
  invoiceUnitCostBase: number | null
  matchedAtUtc: string | null
}

/** One cost adjustment of one line (rules 9a and 10): Amount = InventoryBase + CogsBase. */
export interface GoodsReceiptCostChangeDto {
  id: number
  goodsReceiptLineId: number
  lineNumber: number | null
  itemId: number | null
  itemCode: string | null
  itemName: string | null
  changedAtUtc: string
  causeKind: GoodsReceiptCostCause
  /** "Invoice posted", "Sold before it was received"…: the server's name of the cause. */
  causeName: string | null
  causeId: number | null
  causeNumber: string | null
  receivedBase: number
  inStockBase: number | null
  /* (94) The figures below are null without View item costs; the cause, the document, the date and the pieces stay. */
  fobBefore: number | null
  fobAfter: number | null
  unitCostBefore: number | null
  unitCostAfter: number | null
  amountBase: number | null
  /** The part still in stock: it changed the average cost. */
  inventoryBase: number | null
  /** The part already sold: it went to the cost of sales. */
  cogsBase: number | null
  createdByName: string | null
}

export interface GoodsReceiptAuditDto {
  id: number
  /** Created, Updated, Posted, Cancelled, CostAdjusted, FileAdded, FileUpdated, FileDeleted. */
  action: string
  details: string | null
  userId: number | null
  userName: string | null
  atUtc: string
}

export interface GoodsReceiptDto {
  id: number
  documentTypeId: number
  documentTypeCode: string
  documentTypeName: string
  /** An inactive GRN type still takes drafts; posting one is refused. */
  documentTypeIsActive: boolean
  documentNumber: string | null
  documentDate: string
  status: GoodsReceiptStatusCode
  statusName: string
  sourceKind: GoodsReceiptSourceKind
  branchId: number
  branchCode: string | null
  branchName: string
  /** "Receive into": required to post a container receipt (every line is booked there). */
  warehouseId: number | null
  warehouseCode: string | null
  warehouseName: string | null
  warehouseIsActive: boolean | null
  /** The warehouse belongs to the branch (the container's, for a container receipt); null without a warehouse. */
  warehouseInBranch: boolean | null
  supplierId: number | null
  supplierCode: string | null
  supplierName: string | null
  /** The supplier's name, or "Several suppliers" on a container of several suppliers' orders. */
  supplierDisplayName: string | null
  containerId: number | null
  containerRef: string | null
  containerNo: string | null
  sealNo: string | null
  truckNo: string | null
  waybillNo: string | null
  /** The container's own status (1 Draft … 8 Cancelled), for a container receipt. */
  containerStatus: number | null
  containerStatusName: string | null
  containerBranchId: number | null
  /** The container's own "Warehouse (offloading destination)": a draft keeps its own "Receive into". */
  containerWarehouseId: number | null
  containerWarehouseCode: string | null
  purchaseOrderId: number | null
  purchaseOrderNumber: string | null
  purchaseInvoiceId: number | null
  purchaseInvoiceNumber: string | null
  /** The Delivery movement whose completion created the draft. */
  movementId: number | null
  movementNo: string | null
  movementTypeName: string | null
  movementFromName: string | null
  movementToName: string | null
  movementEndDate: string | null
  movementStage: string | null
  /** The container's latest completed Delivery-stage movement: the goods cannot be received before it ended. */
  deliveryMovementId: number | null
  deliveryMovementNo: string | null
  deliveredDate: string | null
  deliveryPlaceName: string | null
  isAuto: boolean
  /** "Delivery note no." */
  supplierReference: string | null
  notes: string | null
  lineCount: number
  totalExpectedBase: number
  totalReceivedBase: number
  totalShortBase: number
  totalInvoicedBase: number
  /** Σ received × cost at receipt, fixed at posting. (94) Null, with the value now, without View item costs. */
  valueAtReceiptBase: number | null
  /** Σ received × the current cost; an estimate on a draft (isValueEstimate). */
  currentValueBase: number | null
  isValueEstimate: boolean
  baseCurrencyCode: string | null
  postedAtUtc: string | null
  postedByName: string | null
  cancelledAtUtc: string | null
  cancelledByName: string | null
  cancelReason: string | null
  createdAtUtc: string | null
  createdByName: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  canEdit: boolean
  canPost: boolean
  canCancel: boolean
  canDelete: boolean
  /** Why the action is refused, in the words of the SQL refusal ("Choose the warehouse first."); null when allowed. */
  editBlockedReason: string | null
  postBlockedReason: string | null
  cancelBlockedReason: string | null
  deleteBlockedReason: string | null
  /**
   * (92) Why the reader may not post, cancel or delete this document: the server's sentence ("You have no access to
   * warehouse LKS-01: ask an administrator."), null when they may. Missing from an older API: then nothing is refused.
   */
  warehouseAccessRefusal?: string | null
  /** When goods receipts started; null before the switch. */
  switchedAtUtc: string | null
  rowVersion: string | null
  lines: GoodsReceiptLineDto[]
  matches: GoodsReceiptMatchDto[]
  costChanges: GoodsReceiptCostChangeDto[]
  files: DocumentFileDto[]
  audit: GoodsReceiptAuditDto[]
}

/* ── saving a draft ─────────────────────────────────────────────────────────────────────────── */

export interface GoodsReceiptLineRequest {
  lineNumber: number
  /**
   * (94) The line's id as it was read (null on a new row): lets the server keep the typed cost of a saved line without an
   * order for a reader who may not see item costs. The lines are still a full replace.
   */
  id?: number | null
  itemId: number
  itemUnitId: number
  /** In the line's unit. */
  quantity: number
  warehouseId: number | null
  poLineId: number | null
  invoiceLineId: number | null
  containerLineId: number | null
  expectedQuantityBase: number | null
  varianceReasonCode: VarianceReasonCode | null
  varianceReason: string | null
  closeShort: boolean
  /**
   * Manual lines: the typed cost per piece, in the base currency; null = the item's last cost, else its average. (94)
   * Dropped for a reader without View item costs: a saved line (its id, the same item and unit) keeps its cost.
   */
  manualUnitCostBase: number | null
  expiryDate: string | null
  notes: string | null
}

export interface GoodsReceiptSaveRequest {
  documentDate: string
  branchId: number
  warehouseId: number | null
  supplierId: number | null
  supplierReference: string | null
  notes: string | null
  rowVersion: string | null
  lines: GoodsReceiptLineRequest[]
  /** On a create only: a receipt made on its own page is a receipt without an order. */
  sourceKind?: 'Manual'
  /**
   * (94) The page drew no cost (its reader may not see item costs, or the receipt it holds came without them): a line
   * without an order keeps its saved cost (by its id) whatever it carries. It can only keep a stored figure.
   */
  costsHidden?: boolean
}

/* ── Receive goods… (order, invoice, container) ─────────────────────────────────────────────── */

/**
 * One line the "Receive goods" dialogs and "+ New › From a purchase order…" propose, in pieces: an order line (with
 * `?purchaseOrderId=` or `?supplierId=`), an invoice line not linked to a container (`?invoiceId=`) or a container line
 * (`?containerId=`). The figures are the procedures' own (purchase.fn_PoLine_Progress, fn_InvoiceLine_ToReceive).
 */
export interface ReceivableLineDto {
  /** Order | Invoice | Container: the document the line belongs to. */
  sourceKind: 'Order' | 'Invoice' | 'Container'
  /** The order, invoice or container. */
  documentId: number
  documentNumber: string | null
  lineNumber: number
  purchaseOrderId: number | null
  orderNumber: string | null
  poLineId: number | null
  poLineNumber: number | null
  invoiceId: number | null
  invoiceNumber: string | null
  invoiceLineId: number | null
  containerId: number | null
  containerLineId: number | null
  supplierId: number | null
  supplierCode: string | null
  supplierName: string | null
  itemId: number
  itemCode: string
  itemName: string
  /** The line's unit on its document. */
  itemUnitId: number
  unitTypeName: string | null
  packingFormula: number
  /** The item's base unit (pieces): what the quantities here are in. */
  baseItemUnitId: number | null
  baseUnitTypeName: string | null
  /** The line's warehouse: the default "Receive into" of the line. */
  warehouseId: number | null
  warehouseCode: string | null
  warehouseName: string | null
  expiryDate: string | null
  /** Order line: ordered. Invoice line: its order line's ordered pieces. */
  orderedBase: number | null
  /** Order line: invoiced. Invoice line: its pieces. */
  invoicedBase: number | null
  /** Received by goods receipts (and before them). */
  receivedBase: number
  /** Order line: settled short ("Nothing more will come", or short on a container receipt). */
  shortBase: number
  /** Order line: in containers not received yet. */
  inContainersBase: number
  inDraftReceiptsBase: number
  /** What is still to receive here. */
  toReceiveBase: number
  /** Order line: the posting cap outside containers. */
  maxOutsideBase: number | null
  /** Order line: what Shortages counts as still to come. */
  outstandingBase: number | null
  /** Invoice line: returned. */
  returnedBase: number | null
  /** Container line: loaded (= expected). */
  loadedBase: number | null
  /** What "Receive now" starts at: 0 on an order or invoice shipped in containers, else toReceiveBase. */
  defaultReceiveBase: number
  /** The price per piece in the base currency: the order's (order and container lines) or the invoice's. */
  /** (94) Null without View item costs: the invoice's is the FOB the goods take. No dialog draws it. */
  unitPriceBase: number | null
}

/** An order or an invoice of the dialog, with its totals. */
export interface ReceivableDocumentDto {
  sourceKind: 'Order' | 'Invoice'
  id: number
  documentNumber: string | null
  documentDate: string
  /** The purchase document's status code: 2 Posted (an approved order, or a posted invoice). */
  status: number
  branchId: number
  branchCode: string | null
  branchName: string | null
  warehouseId: number | null
  warehouseCode: string | null
  supplierId: number
  supplierCode: string | null
  supplierName: string | null
  /**
   * An order with containers, or an invoice "Shipped in containers": its goods are received with their containers, so
   * "Receive now" starts at 0 with the orange Alert.
   */
  shippedInContainers: boolean
  /** Invoice: posted before goods receipts without "Shipped in containers" - its stock entered when it was posted. */
  receivedAtPosting: boolean
  lineCount: number
  toReceiveBase: number
  maxOutsideBase: number
  inContainersBase: number
  inDraftReceiptsBase: number
}

/** A container that can be received: "+ New › From a container…" and the container's "Receive goods…". */
export interface ReceivableContainerDto {
  containerId: number
  containerRef: string
  containerNo: string | null
  /** The container's status (2 Confirmed … 5 Cleared when it can be received). */
  status: number
  statusName: string
  branchId: number
  branchCode: string | null
  branchName: string | null
  /** The container's "Warehouse (offloading destination)". */
  warehouseId: number | null
  warehouseCode: string | null
  warehouseName: string | null
  /** The warehouse is active and of the container's branch: the draft takes it as "Receive into". */
  warehouseInBranch: boolean | null
  /** The single supplier of its orders; null with "Several suppliers". */
  supplierId: number | null
  supplierName: string | null
  /** "PO-BR-002-000042, PO-BR-002-000043". */
  orderNumbers: string | null
  lineCount: number
  loadedBase: number
  goodsReceiptId: number | null
  goodsReceiptNumber: string | null
  goodsReceiptStatus: number | null
  /** GRN (received with a goods receipt), Offload (before goods receipts) or null. */
  receivedBy: string | null
  deliveryMovementNo: string | null
  deliveredDate: string | null
  deliveryPlaceName: string | null
  /** A movement of the container in progress: posting its receipt is refused until it is completed. */
  movementInProgressNo: string | null
  /** Status 2-5 and no draft or posted receipt. */
  canReceive: boolean
  /** Confirmed and never dispatched (status 2): "has not left the supplier". */
  notDispatched: boolean
  /** "From a container…" (script 78): how many containers match, of which at most 200 are listed; 0 for one container. */
  totalCount?: number
}

/** What `GET …/receivable` answers: the documents (one order, one invoice, or a supplier's orders) or the container, and the lines. */
export interface ReceivableDto {
  /** Order | Invoice | Supplier | Container: what was asked. */
  kind: 'Order' | 'Invoice' | 'Supplier' | 'Container'
  supplierId: number | null
  supplierCode: string | null
  supplierName: string | null
  documents: ReceivableDocumentDto[]
  container: ReceivableContainerDto | null
  lines: ReceivableLineDto[]
  /** Σ to receive over the lines. */
  toReceiveBase: number
}

/** "+ New › From a container…": the containers Confirmed to Cleared with no receipt. */
export interface ReceivableContainersQuery {
  /** Container ref or no., order number. */
  search?: string
  branchId?: number
  supplierId?: number
  /** Only the containers whose Delivery movement is completed. */
  deliveredOnly?: boolean
}

export interface ReceiveFromOrderLine {
  poLineId: number
  quantityBase: number
  /** Null = the request's, else the order line's. */
  warehouseId: number | null
  /** "Nothing more will come": the rest of the order line is settled short (a reason code or note required). */
  closeShort: boolean
  /** SHORT, DAMAGED, MISSING, LOADCOUNT or OTHER. */
  reasonCode?: VarianceReasonCode | null
  /** The free note of the reason. */
  reason: string | null
  expiryDate?: string | null
  notes?: string | null
}

export interface ReceiveFromOrderRequest {
  purchaseOrderId: number
  documentDate: string | null
  supplierReference: string | null
  /** "Receive into" for the lines that name none; null = each order line's. */
  warehouseId?: number | null
  notes?: string | null
  /** Absent = every line with something to receive. */
  lines?: ReceiveFromOrderLine[]
  /** Post it as well (the post permission). */
  post: boolean
}

export interface ReceiveFromInvoiceLine {
  invoiceLineId: number
  quantityBase: number
  warehouseId: number | null
  closeShort: boolean
  reasonCode?: VarianceReasonCode | null
  reason: string | null
  expiryDate?: string | null
  notes?: string | null
}

export interface ReceiveFromInvoiceRequest {
  invoiceId: number
  documentDate: string | null
  supplierReference: string | null
  warehouseId?: number | null
  notes?: string | null
  lines?: ReceiveFromInvoiceLine[]
  post: boolean
}

export interface ReceiveContainerLine {
  containerLineId: number
  quantityBase: number
  varianceReasonCode: VarianceReasonCode | null
  varianceReason: string | null
  expiryDate?: string | null
  notes?: string | null
}

export interface ReceiveContainerRequest {
  containerId: number
  documentDate?: string | null
  warehouseId?: number | null
  /** Absent = every container line, received = loaded. */
  lines?: ReceiveContainerLine[]
  post: boolean
}

/**
 * What a from-order / from-invoice / from-container answers: the receipt created, posted when asked and allowed. A
 * REFUSED POSTING LEAVES THE DRAFT: postRefusal says why, and the page opens the draft to fix it.
 */
export interface GoodsReceiptCreatedDto {
  id: number
  /** Set when it was posted. */
  documentNumber: string | null
  status: GoodsReceiptStatusCode
  statusName: string
  posted: boolean
  /** "Draft goods receipt created." / "Goods receipt GRN-… posted." / "Draft goods receipt created; it was not posted: …". */
  message: string
  /** Posting was asked for and refused: the draft stays. */
  postRefusal: { code: string; message: string } | null
}

/** When goods receipts started (`GET …/switch`): the date of the purchase invoice list's banner. */
export interface GoodsReceiptSwitchDto {
  switchedAtUtc: string | null
}

/* ── around goods receipts (other pages) ────────────────────────────────────────────────────── */

/** What the completion of a Delivery movement did for one of its containers (the movement's Complete answer). */
export interface MovementReceiptResultDto {
  containerId: number
  containerRef: string
  goodsReceiptId: number | null
  goodsReceiptNumber: string | null
  goodsReceiptStatus: number | null
  /** The draft's warehouse when it was created; null = to choose (and on a skipped container). */
  warehouseCode: string | null
  created: boolean
  /** 'Received', 'HasDraft', 'NotConfirmed', 'Cancelled', 'NoLines', 'InactiveItem' or 'Error'; null when created. */
  skipReason: string | null
  /** The database's sentence for the container ("Draft goods receipt created into LUB-WH.", "Already has a draft…"). */
  message: string | null
}

/** One line of a DRAFT supplier invoice and what posting it would do to the cost of goods already received. */
export interface ReceiptCostPreviewLineDto {
  invoiceLineId: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  invoicedBase: number
  /** Received pieces of the line's group not matched yet, up to the line's pieces (first in, first out). */
  receivedNotInvoicedBase: number
  /** What those pieces cost now, per piece; null when there are none. */
  currentCostBase: number | null
  /** What they would cost with this invoice, per piece; null when there are none. */
  invoiceCostBase: number | null
  /** (invoice cost − current cost) × pieces. */
  differenceBase: number
  estimatedInventoryBase: number
  estimatedCogsBase: number
  companyOnHandBase: number
  /** The goods receipts those pieces came from: "GRN-BR-002-000001, GRN-BR-002-000003". */
  receipts: string | null
  isEstimate: boolean
  /** (79) The PINV type changes item costs: false, the pieces keep their cost (no difference). */
  affectsCost?: boolean
}

/**
 * A DRAFT invoice's effect on the goods already received, if it were posted now (an estimate), and the sentence the
 * post confirmation shows: "60 pcs already received will have their cost adjusted by +60.00 USD (estimate: stock
 * 40.00, cost of sales 20.00)." or "No goods received yet: their cost will be this invoice's when they arrive."
 */
export interface ReceiptCostPreviewDto {
  invoiceId: number
  documentNumber: string | null
  /** Draft, Posted or Cancelled: only a draft is previewed. */
  status: string
  baseCurrencyCode: string | null
  /** Received pieces whose cost the posting would adjust. */
  receivedNotInvoicedBase: number
  differenceBase: number
  estimatedInventoryBase: number
  estimatedCogsBase: number
  hasReceivedGoods: boolean
  isEstimate: boolean
  /** (79) Posting it changes the cost of the goods received against it; false, the message says they keep their cost. */
  affectsCost?: boolean
  message: string | null
  lines: ReceiptCostPreviewLineDto[]
}

/* ── the client ─────────────────────────────────────────────────────────────────────────────── */

function toQueryString(query: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === false) continue
    const text = String(value).trim()
    if (text) params.set(key, text)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function normaliseRow(row: GoodsReceiptListItemDto): GoodsReceiptListItemDto {
  return { ...row, status: toGoodsReceiptStatus(row.status) }
}

/** The receipt with its status as a code and every list present. */
function normaliseDocument(doc: GoodsReceiptDto): GoodsReceiptDto {
  return {
    ...doc,
    status: toGoodsReceiptStatus(doc.status),
    lines: doc.lines ?? [],
    matches: doc.matches ?? [],
    costChanges: doc.costChanges ?? [],
    files: doc.files ?? [],
    audit: doc.audit ?? [],
  }
}

function normaliseCreated(created: GoodsReceiptCreatedDto): GoodsReceiptCreatedDto {
  return { ...created, status: toGoodsReceiptStatus(created.status), postRefusal: created.postRefusal ?? null }
}

export const goodsReceiptsApi = {
  /** Paged, with the totals row (received not invoiced). */
  list: async (query: GoodsReceiptQuery = {}, signal?: AbortSignal): Promise<GoodsReceiptSearchResultDto> => {
    const result = await request<GoodsReceiptSearchResultDto>(`${BASE}${toQueryString(query)}`, { signal })
    return { ...result, items: result.items.map(normaliseRow), totals: result.totals ?? null }
  },

  /** How many drafts wait to be posted: the menu count (`draftCount` of the waiting answer). */
  waiting: async (signal?: AbortSignal): Promise<number> => {
    const answer = await request<GoodsReceiptWaitingDto>(`${BASE}/waiting`, { signal })
    const count = answer?.draftCount
    return typeof count === 'number' && Number.isFinite(count) ? count : 0
  },

  /** When goods receipts started: any signed-in user (the purchase invoice list's banner). */
  switchDate: (signal?: AbortSignal) => request<GoodsReceiptSwitchDto>(`${BASE}/switch`, { signal }),

  get: async (id: number, signal?: AbortSignal) => normaliseDocument(await request<GoodsReceiptDto>(`${BASE}/${id}`, { signal })),

  /** A draft of any source; this page creates receipts without an order. */
  create: async (payload: GoodsReceiptSaveRequest) =>
    normaliseDocument(await request<GoodsReceiptDto>(BASE, { method: 'POST', body: payload })),

  update: async (id: number, payload: GoodsReceiptSaveRequest) =>
    normaliseDocument(await request<GoodsReceiptDto>(`${BASE}/${id}`, { method: 'PUT', body: payload })),

  /** Drafts only. */
  remove: (id: number, rowVersion: string | null) =>
    request<void>(`${BASE}/${id}${rowVersion ? `?rowVersion=${encodeURIComponent(rowVersion)}` : ''}`, { method: 'DELETE' }),

  /** The stock enters, the costs are set and the number is assigned. Answers the receipt, with its number. */
  post: async (id: number, rowVersion: string | null) =>
    normaliseDocument(await request<GoodsReceiptDto>(`${BASE}/${id}/post`, { method: 'POST', body: { rowVersion } })),

  /** Posts each draft on its own, in order: one refusal does not stop the others. */
  postMany: async (ids: number[]): Promise<BulkActionItemResult[]> => {
    const results = await request<BulkActionItemResult[]>(`${BASE}/post-many`, { method: 'POST', body: { ids } })
    return results.map((r) => ({ ...r, documentNumber: r.documentNumber ?? null, code: r.code ?? null, message: r.message ?? null }))
  },

  /** A posted receipt: the stock it brought goes out again and the item costs are replayed. */
  cancel: async (id: number, reason: string, rowVersion: string | null) =>
    normaliseDocument(await request<GoodsReceiptDto>(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason, rowVersion } })),

  /**
   * The lines and the to-receive figures of an order, an invoice, a container, or every approved order of a
   * supplier with something to receive (exactly one of the four).
   */
  receivable: async (
    source: { purchaseOrderId: number } | { invoiceId: number } | { supplierId: number } | { containerId: number },
    signal?: AbortSignal,
  ): Promise<ReceivableDto> => {
    const answer = await request<ReceivableDto>(`${BASE}/receivable${toQueryString(source)}`, { signal })
    return { ...answer, documents: answer.documents ?? [], lines: answer.lines ?? [], container: answer.container ?? null }
  },

  /** "+ New › From a container…": the containers Confirmed to Cleared with no receipt (at most 200, delivered first; totalCount says how many match). */
  receivableContainers: (query: ReceivableContainersQuery = {}, signal?: AbortSignal) =>
    request<ReceivableContainerDto[]>(`${BASE}/receivable-containers${toQueryString(query)}`, { signal }),

  fromOrder: async (payload: ReceiveFromOrderRequest) =>
    normaliseCreated(await request<GoodsReceiptCreatedDto>(`${BASE}/from-order`, { method: 'POST', body: payload })),

  fromInvoice: async (payload: ReceiveFromInvoiceRequest) =>
    normaliseCreated(await request<GoodsReceiptCreatedDto>(`${BASE}/from-invoice`, { method: 'POST', body: payload })),

  fromContainer: async (payload: ReceiveContainerRequest) =>
    normaliseCreated(await request<GoodsReceiptCreatedDto>(`${BASE}/from-container`, { method: 'POST', body: payload })),

  /** GRN-{number}.xlsx: header and lines (expected, received, difference, reason, cost, value, source). */
  exportToExcel: async (id: number, fileName: string) => saveBlob(await fetchBlob(`${BASE}/${id}/export`), fileName),

  /** The files with their type, date and note: list, upload, edit, download, delete (kind GRN). */
  files: documentFilesApi(BASE),

  /**
   * For a DRAFT purchase invoice: how posting it would adjust the cost of the goods already received (an estimate).
   * Served by the purchase documents (`purchase.invoices.post`), kept here beside the receipts it is about.
   */
  receiptCostPreview: (invoiceId: number, signal?: AbortSignal) =>
    request<ReceiptCostPreviewDto>(`/api/purchase/documents/${invoiceId}/receipt-cost-preview`, { signal }),
}

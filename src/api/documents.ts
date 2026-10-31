/**
 * Shapes every document family's bulk and import-create endpoints share.
 *
 * ONE SHAPE, THREE FAMILIES. Inventory, sales and purchase each post and delete in bulk and each
 * turn an imported file into ONE document, each line keeping its own warehouse — or, for sales invoices
 * and stock documents asked to split by warehouse, one document per warehouse; the answers are the same,
 * so the list pages and the wizard read one type rather than three that would drift.
 */

/** What happened to one document of a bulk action. */
export interface BulkActionItemResult {
  id: number
  /** The number after the action (assigned by a posting), or null for a draft or a failure. */
  documentNumber: string | null
  ok: boolean
  /** NO_LINES, INSUFFICIENT_STOCK, NOT_DRAFT, FORBIDDEN… when not ok. */
  code: string | null
  /** The refusal when not ok; when ok, what the action did besides ("Goods received: GRN-…"), else null. */
  message: string | null
  /**
   * Ok, but part of it did not happen: a supplier invoice posted whose goods receipt was refused ("Invoice posted; the
   * goods receipt was not: {reason}. Use Receive goods…", script 79). Absent from the other families.
   */
  warning?: string | null
}

/** The answer to a bulk post or delete: counts, and one result per id in the order sent. */
export interface BulkActionResult {
  requested: number
  succeeded: number
  failed: number
  results: BulkActionItemResult[]
}

/** One validated wizard row as import-create takes it. The warehouse is what the server groups by. */
export interface ImportCreateLine {
  warehouseId: number
  itemId: number
  itemUnitId: number
  quantity: number
  /** Selling price (sales), cost (inventory in / purchase), ignored on an Out. */
  unitPrice?: number | null
  discountPercent?: number | null
  expiryDate?: string | null
  notes?: string | null
  importRowNumber?: number | null
}

export interface ImportCreateDocument {
  id: number
  documentNumber: string | null
  /**
   * The document's own (header) warehouse: the first line's on a single document, whose lines may name
   * others; the group's own on a document split by warehouse.
   */
  warehouseId: number
  warehouseName: string
  /** How many distinct warehouses the lines name. More than 1 is a mixed document; 1 for each document of a split. */
  warehouseCount: number
  lineCount: number
  /** Draft | Posted — Draft when posting was not asked for, or was refused (see failed). */
  status: string
  /** A supplier invoice's item: it holds one, so a file of several items makes one invoice per item. Absent for the other kinds. */
  itemId?: number | null
  itemCode?: string | null
  itemName?: string | null
  /** A supplier invoice posted whose goods receipt was refused (its type receives the goods, script 79). */
  warning?: string | null
  /** The goods receipt made and posted with the invoice, when its type receives the goods (script 79). */
  goodsReceiptNumber?: string | null
}

export interface ImportCreateFailure {
  /**
   * The document's header warehouse. On a file split by warehouse, the group's warehouse even when its
   * document was never created; otherwise null when the document was never created and has none.
   */
  warehouseId: number | null
  warehouseName: string | null
  code: string
  message: string
}

/**
 * What import-create answers: what was created, what was posted, what was refused. A split by warehouse
 * lists every document it made, and each refusal names the warehouse whose document it concerns.
 */
export interface ImportCreateResult {
  documents: ImportCreateDocument[]
  created: number
  posted: number
  failed: ImportCreateFailure[]
}

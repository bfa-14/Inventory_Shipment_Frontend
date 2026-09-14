/**
 * Shapes every document family's bulk and import-create endpoints share.
 *
 * ONE SHAPE, THREE FAMILIES. Inventory, sales and purchase each post and delete in bulk and each
 * turn an imported file into one document per warehouse; the answers are the same for all of them,
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
  message: string | null
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
  warehouseId: number
  warehouseName: string
  lineCount: number
  /** Draft | Posted — Draft when posting was not asked for, or was refused (see failed). */
  status: string
}

export interface ImportCreateFailure {
  warehouseId: number
  warehouseName: string | null
  code: string
  message: string
}

/** What import-create answers: what was created, what was posted, what was refused. */
export interface ImportCreateResult {
  documents: ImportCreateDocument[]
  created: number
  posted: number
  failed: ImportCreateFailure[]
}

import { saveBlob } from '../documentFiles'
import { fetchBlob, postForBlob, postForm, request } from '../http'

/**
 * Stock levels per warehouse (script 91): an item's Min (required, pcs, 0 or more) and Max (optional, not below Min) in
 * ONE warehouse at the bottom of the tree, never an On the way warehouse (`api/inventory/stock-levels`).
 *
 * TWO MIN / MAX, NEVER ONE. Item Definition's Minimum / Maximum Quantity stay the COMPANY's - the Dashboard's "Items
 * below their minimum", and the page's "Company (Item Definition)" view (`company`). These are each warehouse's own, the
 * ones Fill to Max on a transfer order tops a warehouse up to.
 *
 * ONE FORMULA, THE SERVER'S (inventory.fn_StockPosition): Projected = On hand + On the way in + To come in − To go out,
 * released transfer orders only (drafts, orders waiting for approval and purchases are not counted). The status is the
 * first that applies: no level, Below Min (Projected < Min), Below Min covered (On hand < Min ≤ Projected), Above Max
 * (Projected > Max), OK. Every quantity here is in pcs (the item's base unit).
 *
 * PERMISSIONS: inventory.stocklevels.view reads (the list, the company view, the history, the export);
 * inventory.stocklevels.edit writes (set, remove, the import and its template). Creating a transfer order from ticked
 * rows is in transfers.ts (`transferLevelsApi.createFromLevels`), behind transfers.create AND stocklevels.view.
 *
 * EVERY CALL OF THE FEATURE IS IN THIS FILE (the transfer ones excepted), so aligning it with the API is one place.
 */
const BASE = '/api/inventory/stock-levels'

export const STOCK_LEVELS_EXPORT_FILE = 'Stock_Levels.xlsx'
export const STOCK_LEVELS_TEMPLATE_FILE = 'Import_Stock_Levels_Template.xlsx'
export const STOCK_LEVELS_ERRORS_FILE = 'Import_Stock_Levels_Errors.xlsx'

/** The API's limits (StockLevelImportParser), so the wizard's checks and the server's say the same. */
export const STOCK_LEVELS_MAX_FILE_BYTES = 5 * 1024 * 1024
export const STOCK_LEVELS_MAX_ROWS = 20_000

/* ── statuses and sources ───────────────────────────────────────────────────────────────────── */

/** A level's status (fn_StockPosition.Status); NoLevel is a pair (item, warehouse) without a level. */
export type StockLevelStatus = 'BelowMin' | 'Covered' | 'AboveMax' | 'Ok' | 'NoLevel'

/** The company view's status (Item Definition's Minimum / Maximum Quantity against the stock). */
export type CompanyStockLevelStatus = 'BelowMin' | 'AboveMax' | 'Ok'

/** Where a change was made, for the history: the item's card, the Stock Levels page, or an import (with its file). */
export type StockLevelSource = 'ItemCard' | 'StockLevels' | 'Import'

/* ── per warehouse ──────────────────────────────────────────────────────────────────────────── */

export interface StockLevelQuery {
  /** Item code or name (contains), or a unit barcode exactly. */
  search?: string
  branchId?: number
  /** That warehouse, or the warehouses at the bottom of the tree under it. */
  warehouseId?: number
  /** The family and the families under it. */
  itemFamilyId?: number
  brandId?: number
  itemId?: number
  /** Left out: every level. NoLevel lists the pairs WITHOUT a level that hold stock or are on a released transfer. */
  status?: StockLevelStatus
  /** Default true on the server: sent only when false. */
  activeItemsOnly?: boolean
  /** Default false on the server. */
  includeInactiveWarehouses?: boolean
}

/** One item in one warehouse: its level, and where the warehouse stands for it (pcs). */
export interface StockLevelRowDto {
  itemId: number
  itemCode: string
  itemName: string
  itemIsActive: boolean
  itemFamilyName: string | null
  brandName: string | null
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  warehouseIsActive: boolean
  branchId: number
  branchCode: string | null
  branchName: string | null
  hasLevel: boolean
  /** Null without a level. */
  minQuantityBase: number | null
  /** Null: no maximum (Fill to Max fills up to Min), or no level. */
  maxQuantityBase: number | null
  /** The ledger balance. */
  onHandBase: number
  /** Dispatched to this warehouse by released transfer orders, not received or written off yet. */
  inOnTheWayBase: number
  /** Still to dispatch TO this warehouse on released transfer orders. */
  inToDispatchBase: number
  /** Still to dispatch FROM this warehouse on released transfer orders: promised, still on the shelf. */
  outToDispatchBase: number
  /** On hand + on the way in + to come in − to go out. May be negative. */
  projectedBase: number
  /** (Max, else Min) − Projected when Below Min, else 0: what Fill to Max would ask for. */
  toReachMaxBase: number
  status: StockLevelStatus
  /** When the level was last changed, and by whom (null without a level). */
  updatedAtUtc: string | null
  updatedByName: string | null
  /** Base64 ROWVERSION of the level, sent back to change or remove it; null without a level. */
  rowVersion: string | null
}

/** The scope's totals (the status filter ignored, levels only): the page's tiles. */
export interface StockLevelTotalsDto {
  levels: number
  belowMin: number
  covered: number
  aboveMax: number
  ok: number
}

export interface StockLevelListResult {
  rows: StockLevelRowDto[]
  totals: StockLevelTotalsDto
}

/* ── the company view ───────────────────────────────────────────────────────────────────────── */

export interface CompanyStockLevelQuery {
  search?: string
  /** Left out: the company (every warehouse, On the way included); a branch: every warehouse of it. */
  branchId?: number
  itemFamilyId?: number
  brandId?: number
  /** Left out: every item with a company Min or Max. */
  status?: CompanyStockLevelStatus
  activeItemsOnly?: boolean
}

export interface CompanyStockLevelRowDto {
  itemId: number
  itemCode: string
  itemName: string
  itemIsActive: boolean
  itemFamilyName: string | null
  brandName: string | null
  /** The stock of every warehouse of the scope (the branch's or the company's), goods on the way to it included. */
  onHandBase: number
  /** Item Definition's Minimum Quantity. */
  minQuantity: number
  /** Item Definition's Maximum Quantity; null: none. */
  maxQuantity: number | null
  /** Minimum − on hand when Below Min, else 0. */
  missingBase: number
  status: CompanyStockLevelStatus
  /** Warehouses with their own level for the item ("3 warehouses" opens Per warehouse with that item). */
  warehouseLevelCount: number
}

export interface CompanyStockLevelListResult {
  rows: CompanyStockLevelRowDto[]
  totals: { items: number; belowMin: number }
  /** Whose stock the figures are: a branch, or the company when branchId is null. */
  scope: { branchId: number | null; branchName: string | null }
}

/* ── set, remove, history ───────────────────────────────────────────────────────────────────── */

/** One warehouse's level as sent; the RowVersion of a level already read (null: a new level). */
export interface SetStockLevelRequest {
  warehouseId: number
  minQuantityBase: number | null
  maxQuantityBase: number | null
  rowVersion: string | null
}

/** One item's levels in one or more warehouses, all or nothing; each warehouse once. */
export interface SetStockLevelsRequest {
  /** ItemCard (default) or StockLevels: where the change was made, for the history. */
  source: Exclude<StockLevelSource, 'Import'>
  levels: SetStockLevelRequest[]
}

export interface SetStockLevelsResult {
  /** The item's rows again, every warehouse with a level (inactive warehouses and an inactive item included). */
  rows: StockLevelRowDto[]
  /** "2 stock levels saved for TVS-APACHE-160." - shown as it comes. */
  message: string
}

/** One change of a level, newest first. */
export interface StockLevelHistoryDto {
  id: number
  atUtc: string
  userName: string | null
  action: 'Added' | 'Changed' | 'Removed'
  oldMinBase: number | null
  oldMaxBase: number | null
  newMinBase: number | null
  newMaxBase: number | null
  source: StockLevelSource
  /** The imported file's name (source Import). */
  fileName: string | null
}

/* ── the Excel import ───────────────────────────────────────────────────────────────────────── */

/** Valid and Warning rows are imported; Error and Unchanged rows are skipped. */
export type StockLevelImportStatus = 'Valid' | 'Warning' | 'Error' | 'Unchanged'

/** What the row does: Set a level, Remove one, or nothing (every Error and Unchanged row). */
export type StockLevelImportAction = 'Set' | 'Remove' | 'None'

/** One row of the file with its verdict (inventory.fn_ItemWarehouseLevel_ImportJudge) and what the file had. */
export interface StockLevelImportRow {
  /** The worksheet's row number, so a message names the row the reader can scroll to. */
  rowNumber: number
  status: StockLevelImportStatus
  action: StockLevelImportAction
  message: string | null
  /** The Item Code / Barcode cell as typed. */
  itemInput: string | null
  itemId: number | null
  itemCode: string | null
  itemName: string | null
  itemIsActive?: boolean | null
  /** The Warehouse cell as typed: a code, or a name. */
  warehouseInput: string | null
  warehouseId: number | null
  warehouseCode: string | null
  warehouseName: string | null
  branchCode: string | null
  minQuantityBase: number | null
  maxQuantityBase: number | null
  /** The Remove cell is Yes. */
  remove: boolean
  /** Min / Max / Remove as the file had them when they did not read (null otherwise). */
  rawMin: string | null
  rawMax: string | null
  rawRemove: string | null
  parseError: string | null
  /** The warehouse already has a level for the item (Now: "Min 10 / Max 40"). */
  hasLevel?: boolean
  currentMinBase: number | null
  currentMaxBase: number | null
}

export interface StockLevelImportCounts {
  /** Rows that set a level (Valid or Warning). */
  set: number
  /** Rows that remove a level (Valid or Warning). */
  remove: number
  unchanged: number
  warnings: number
  errors: number
}

/** POST import/validate: every row judged, nothing written. */
export interface StockLevelImportValidation {
  fileName: string
  rows: StockLevelImportRow[]
  counts: StockLevelImportCounts
}

/** POST import: the validated rows posted back as they came; they are judged again, in ONE transaction. */
export interface StockLevelImportRequest {
  fileName: string | null
  rows: StockLevelImportRow[]
}

export type StockLevelImportOutcome = 'Added' | 'Changed' | 'Removed' | 'Unchanged' | 'Skipped'

export interface StockLevelImportRowOutcome {
  rowNumber: number
  outcome: StockLevelImportOutcome
  message: string | null
}

export interface StockLevelImportResult {
  added: number
  changed: number
  removed: number
  unchanged: number
  skipped: number
  rows: StockLevelImportRowOutcome[]
  /** "Stock levels imported: 40 added, 12 changed, 3 removed; …" - shown as it comes. */
  message: string
}

/* ── the calls ──────────────────────────────────────────────────────────────────────────────── */

/** The query string, leaving out what the reader did not set (and the server's defaults). */
function toQueryString(query: StockLevelQuery | CompanyStockLevelQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query) as [string, unknown][]) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      const text = value.trim()
      if (text) params.set(key, text)
      continue
    }
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** The answer with every list present and every nullable field null, whatever an older API left out. */
function normaliseRow(row: StockLevelRowDto): StockLevelRowDto {
  return {
    ...row,
    itemFamilyName: row.itemFamilyName ?? null,
    brandName: row.brandName ?? null,
    branchCode: row.branchCode ?? null,
    branchName: row.branchName ?? null,
    minQuantityBase: row.minQuantityBase ?? null,
    maxQuantityBase: row.maxQuantityBase ?? null,
    updatedAtUtc: row.updatedAtUtc ?? null,
    updatedByName: row.updatedByName ?? null,
    rowVersion: row.rowVersion ?? null,
  }
}

const NO_TOTALS: StockLevelTotalsDto = { levels: 0, belowMin: 0, covered: 0, aboveMax: 0, ok: 0 }

export const stockLevelsApi = {
  /** Per warehouse: every level of the scope (or the pairs without one, status NoLevel), with the scope's totals. */
  list: async (query: StockLevelQuery = {}, signal?: AbortSignal): Promise<StockLevelListResult> => {
    const result = await request<StockLevelListResult>(`${BASE}${toQueryString(query)}`, { signal })
    return { rows: (result?.rows ?? []).map(normaliseRow), totals: { ...NO_TOTALS, ...(result?.totals ?? {}) } }
  },

  /** The levels of ONE item in every warehouse, inactive ones included: Item Definition's card, the dialog's "already has". */
  forItem: (itemId: number, signal?: AbortSignal) =>
    stockLevelsApi.list({ itemId, activeItemsOnly: false, includeInactiveWarehouses: true }, signal),

  /** The company view: Item Definition's Minimum / Maximum Quantity against the stock (the Dashboard's figure). */
  company: async (query: CompanyStockLevelQuery = {}, signal?: AbortSignal): Promise<CompanyStockLevelListResult> => {
    const result = await request<CompanyStockLevelListResult>(`${BASE}/company${toQueryString(query)}`, { signal })
    return {
      rows: result?.rows ?? [],
      totals: { items: result?.totals?.items ?? 0, belowMin: result?.totals?.belowMin ?? 0 },
      scope: { branchId: result?.scope?.branchId ?? null, branchName: result?.scope?.branchName ?? null },
    }
  },

  /** Sets one item's levels in one or more warehouses, all or nothing; answers the item's rows again and the message. */
  set: async (itemId: number, payload: SetStockLevelsRequest): Promise<SetStockLevelsResult> => {
    const result = await request<SetStockLevelsResult>(`${BASE}/items/${itemId}`, { method: 'PUT', body: payload })
    return { rows: (result?.rows ?? []).map(normaliseRow), message: result?.message ?? '' }
  },

  /** Removes one level (204); allowed on an inactive warehouse. 404 when it is gone, 409 when it changed. */
  remove: (itemId: number, warehouseId: number, rowVersion: string | null, source: Exclude<StockLevelSource, 'Import'>) => {
    const params = new URLSearchParams({ source })
    if (rowVersion) params.set('rowVersion', rowVersion)
    return request<void>(`${BASE}/items/${itemId}/warehouses/${warehouseId}?${params.toString()}`, { method: 'DELETE' })
  },

  /** Every change of one level (its history outlives the level), newest first. */
  history: async (itemId: number, warehouseId: number, signal?: AbortSignal) =>
    (await request<StockLevelHistoryDto[]>(`${BASE}/items/${itemId}/warehouses/${warehouseId}/history`, { signal })) ?? [],

  /** Stock_Levels.xlsx: the rows of the query, the five import columns first, so the file can be imported back. */
  exportToExcel: async (query: StockLevelQuery = {}) =>
    saveBlob(await fetchBlob(`${BASE}/export${toQueryString(query)}`), STOCK_LEVELS_EXPORT_FILE),

  /** Import_Stock_Levels_Template.xlsx: sheets Levels, Instructions and Example. */
  downloadTemplate: async () => saveBlob(await fetchBlob(`${BASE}/import/template`), STOCK_LEVELS_TEMPLATE_FILE),

  /**
   * Reads and judges the file; nothing is written. A 400 INVALID_FILE is the file's own problem (not .xlsx, too big, too
   * many rows, not the template's columns, no rows); a wrong row comes back as a row with its message.
   */
  validate: (file: File, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return postForm<StockLevelImportValidation>(`${BASE}/import/validate`, form, signal)
  },

  /** The Warning and Error rows posted back as the file, with Row, Status and Message, to correct and upload again. */
  downloadErrorReport: async (rows: StockLevelImportRow[]) =>
    saveBlob(await postForBlob(`${BASE}/import/error-report`, rows), STOCK_LEVELS_ERRORS_FILE),

  /** Every Valid and Warning row in ONE transaction, judged again by the same rule; Error and Unchanged rows skipped. */
  importRows: async (payload: StockLevelImportRequest): Promise<StockLevelImportResult> => {
    const result = await request<StockLevelImportResult>(`${BASE}/import`, { method: 'POST', body: payload })
    return { ...result, rows: result?.rows ?? [], message: result?.message ?? '' }
  },
}

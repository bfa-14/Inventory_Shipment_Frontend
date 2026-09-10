import { fetchBlob, postForBlob, postForm, request } from '../http'

/**
 * The Excel import engine (US-SAL-002).
 *
 * IT VALIDATES AND REPORTS; IT NEVER IMPORTS. The API reads the file, judges every row against
 * master data and hands the rows back — the lines are then added by whichever screen asked for them
 * and saved with the rest of that screen's document. Nothing on the server remembers an upload
 * between calls, which is why the error report is POSTed the rows rather than looking them up.
 */

/** Valid | Warning | Error import; Merged is a row absorbed into an earlier identical one. */
export type ImportRowStatus = 'Valid' | 'Warning' | 'Error' | 'Merged'

/** Where the effective price came from. Null when there was none to find. */
export type ImportPriceSource = 'Manual' | 'Branch' | 'AllBranches'

export interface ImportValidatedRow {
  /** The EXCEL row number, so a message names the row the reader can scroll to. */
  rowNumber: number
  status: ImportRowStatus
  message: string | null

  /** What the file said. On a row whose code is unknown it is the only identification there is. */
  itemRef: string | null

  itemId: number | null
  itemCode: string | null
  itemName: string | null

  itemUnitId: number | null
  unitTypeName: string | null
  packingFormula: number | null

  warehouseId: number | null
  warehouseCode: string | null
  warehouseName: string | null

  quantity: number | null

  /** What will be charged (invoice mode) or what a unit costs (stock mode). Null when neither is known. */
  unitPrice: number | null
  priceSource: ImportPriceSource | null
  manualPrice: number | null

  discountPercent: number
  expiryDate: string | null
  notes: string | null
}

export interface ImportValidationResult {
  fileName: string
  totalRows: number
  validRows: number
  warningRows: number
  errorRows: number
  rows: ImportValidatedRow[]
}

export interface ImportLogRequest {
  branchId: number
  warehouseId: number
  priceListId: number | null
  fileName: string
  totalRows: number
  importedRows: number
  warningRows: number
  rejectedRows: number
  /** The host screen's draft id, so the audit row can be attached to the document once it is saved. */
  draftReference?: string | null
}

export const invoiceImportApi = {
  /**
   * Validates a file against one branch, warehouse and (optionally) price list.
   *
   * OMITTING priceListId IS STOCK MODE, not a missing argument: an Inventory In / Out import has no
   * selling price, so nothing is priced and the Unit Price column is read as the unit cost.
   */
  validate: (
    file: File,
    header: { branchId: number; warehouseId: number; priceListId: number | null },
    signal?: AbortSignal,
  ) => {
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('branchId', String(header.branchId))
    form.append('warehouseId', String(header.warehouseId))
    if (header.priceListId != null) form.append('priceListId', String(header.priceListId))

    return postForm<ImportValidationResult>('/api/sales/invoice-import/validate', form, signal)
  },

  log: (payload: ImportLogRequest) =>
    request<{ id: number }>('/api/sales/invoice-import/log', { method: 'POST', body: payload }),

  /** The blank template, saved by the browser. */
  downloadTemplate: async () =>
    save(await fetchBlob('/api/sales/invoice-import/template'), 'Invoice_Items_Template.xlsx'),

  /** The non-valid rows as a workbook to correct and re-upload. */
  downloadErrorReport: async (rows: ImportValidatedRow[]) =>
    save(
      await postForBlob('/api/sales/invoice-import/error-report', rows),
      'Invoice_Import_Errors.xlsx',
    ),
}

/**
 * Hands a blob to the browser as a download.
 *
 * A plain <a href> cannot carry the Authorization header, so the bytes are fetched first and the
 * link is synthesised around the object URL — which is revoked on the next tick, because revoking it
 * synchronously can beat the browser to the download.
 */
function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

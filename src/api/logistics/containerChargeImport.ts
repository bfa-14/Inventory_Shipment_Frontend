import { fetchBlob, postForBlob, postForm, request } from '../http'
import type { AllocationMethod } from './containerCharges'
import { saveBlob } from './containers'

/**
 * Container charges from an Excel file (`api/logistics/container-charges/import`): ONE ROW = ONE CHARGE
 * ON ONE CONTAINER, the whole amount on that container and divided over its items by the allocation
 * method. The Containers page's "Import charges from Excel…" wizard is the only caller.
 *
 * VALIDATE, THEN IMPORT WHAT WAS SHOWN. The pattern of the invoice import: the file is read and judged
 * on validate and never kept, the client holds the judged rows, the error report is POSTed those rows
 * back, and the import is POSTed the rows the reader saw (the server checks each one again as it
 * creates it). Permissions: containers.charges.create for all of it, + containers.charges.post to post.
 *
 * EVERY CALL OF THE FEATURE IS IN THIS FILE, so aligning it with the API is one place to look.
 */
const BASE = '/api/logistics/container-charges/import'

export const CHARGE_IMPORT_TEMPLATE_FILE = 'Import_Container_Charges_Template.xlsx'
export const CHARGE_IMPORT_ERRORS_FILE = 'Import_Container_Charges_Errors.xlsx'

/** Valid and Warning rows are imported (a Warning is worth a look: a duplicate, a late charge…); Error rows are skipped. */
export type ChargeImportRowStatus = 'Valid' | 'Warning' | 'Error'

/**
 * One row of the "Charges" sheet as the server judged it: what the file said (*Input, raw*) and every value
 * RESOLVED against the master data. It goes back to the import exactly as it came: the import works from the
 * resolved ids and values, never from the text again.
 */
export interface ChargeImportRow {
  /** The EXCEL row number, so a message names the row the reader can scroll to. */
  rowNumber: number
  status: ChargeImportRowStatus
  /** Every problem with the row, one sentence each; null when there is nothing to say. */
  message: string | null

  /** The Container cell: a container no. (MSKU1234565) or an app reference (KTG-2026-0031). */
  containerInput: string | null
  containerId: number | null
  containerRef: string | null
  containerNo: string | null
  /** 1 Draft … 6 Offloaded, 7 Closed, 8 Cancelled. */
  containerStatus: number | null
  containerStatusName: string | null

  chargeTypeInput: string | null
  chargeTypeId: number | null
  chargeCode: string | null
  chargeName: string | null
  includeInLandedCost: boolean | null

  /** In the row's currency, rounded to the cent. */
  amount: number | null
  /** What the cell said when it could not be read as an amount. */
  rawAmount: string | null

  /** Blank in the file = the base currency. */
  currencyInput: string | null
  currencyId: number | null
  currencyCode: string | null
  isBaseCurrency: boolean

  /** A calendar date, "yyyy-MM-dd". */
  chargeDate: string | null
  rawChargeDate: string | null
  /** The Charge Date cell was blank: today. */
  chargeDateDefaulted: boolean

  /** The rate the charge will carry: the one typed, else the rate of the charge date (1 in the base currency). */
  exchangeRate: number | null
  rawExchangeRate: string | null
  /** The Exchange Rate cell was blank: the rate was looked up for the charge date. */
  exchangeRateLookedUp: boolean
  /** The amount in the base currency, at that rate. */
  amountBase: number | null

  providerInput: string | null
  providerPartyId: number | null
  providerCode: string | null
  providerName: string | null
  /** The "Provider Invoice No." column: the charge's Reference. */
  reference: string | null

  allocationInput: string | null
  /** The method the charge will use: Value, Quantity, Weight or Volume (Manual is refused in an import). */
  allocationMethod: AllocationMethod | null
  /** The Allocation cell was blank: the charge type's method. */
  allocationDefaulted: boolean

  notes: string | null

  /**
   * The first row of the charge group this row joins — the rows of one provider invoice (same charge type,
   * provider, invoice no., date, currency, rate and notes), so the invoice is attached once. Null when the
   * row is a charge on its own.
   */
  groupRowNumber: number | null
}

export interface ChargeImportValidation {
  fileName: string
  totalRows: number
  validRows: number
  warningRows: number
  errorRows: number
  /** Valid + Warning: what an import would create. */
  importableRows: number
  baseCurrencyCode: string | null
  rows: ChargeImportRow[]
}

export interface ImportContainerChargesRequest {
  /** Post each charge right after creating it: needs containers.charges.post (403 before anything is created). */
  post: boolean
  /** The file's name, for the log. */
  fileName: string | null
  /** The rows as validate answered them; Error rows are skipped by the server. */
  rows: ChargeImportRow[]
}

/** Posted; Draft (posting not asked, or refused: the message says why); Failed (not created: the message is the reason). */
export type ChargeImportOutcome = 'Posted' | 'Draft' | 'Failed'

/** What happened to one imported row. */
export interface ChargeImportRowResult {
  rowNumber: number
  outcome: ChargeImportOutcome
  /** Failed: why. Draft when posting was asked: why it was not posted. Null otherwise. Shown as it comes. */
  message: string | null
  /** The charge created; null when the row failed. */
  chargeId: number | null
  groupId: string | null
  containerId: number | null
  containerRef: string | null
  containerNo: string | null
  chargeCode: string | null
  chargeName: string | null
  amount: number | null
  currencyCode: string | null
  amountBase: number | null
}

/**
 * EACH ROW IS INDEPENDENT: a row refused at creation or at posting is reported with its reason and the
 * others went on. One entry per row tried, in the file's order.
 */
export interface ChargeImportResult {
  /** The rows the import tried (Valid and Warning). */
  totalRows: number
  /** Error rows sent with the request and left out. */
  skippedRows: number
  /** Charges created, posted or not. */
  createdRows: number
  postedRows: number
  /** Created and left as drafts. */
  draftRows: number
  failedRows: number
  /** Whether posting was asked. */
  post: boolean
  rows: ChargeImportRowResult[]
}

/** Today as "yyyy-MM-dd" in the reader's own timezone. */
function localToday(): string {
  const now = new Date()
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export const containerChargeImportApi = {
  /** The template: sheets Charges (two example rows), Instructions and Lists (active charge types and currencies). */
  downloadTemplate: async () => saveBlob(await fetchBlob(`${BASE}/template`), CHARGE_IMPORT_TEMPLATE_FILE),

  /**
   * Reads and judges the file; nothing is created. A 400 with code INVALID_FILE is the file's own problem
   * (not .xlsx, too big, not the template's columns); a wrong row comes back as a row with its message.
   */
  validate: (file: File, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('file', file, file.name)
    // The reader's today, "yyyy-MM-dd": what a blank Charge Date means (the server's date otherwise).
    form.append('today', localToday())
    return postForm<ChargeImportValidation>(`${BASE}/validate`, form, signal)
  },

  /** Creates one charge per row (the rows of one provider invoice in one group), as drafts or posted; each row on its own. */
  importRows: (payload: ImportContainerChargesRequest) =>
    request<ChargeImportResult>(BASE, { method: 'POST', body: payload }),

  /** The Warning and Error rows posted back as the file, with a Status and a Message column, to correct and upload again. */
  downloadErrorReport: async (rows: ChargeImportRow[]) =>
    saveBlob(await postForBlob(`${BASE}/error-report`, rows), CHARGE_IMPORT_ERRORS_FILE),
}

import type { OpenInvoiceDto, ReceiptPaymentType } from '../../../api/sales/receipts'

/**
 * What the receipt form holds and the arithmetic it shows.
 *
 * THE SERVER DOES THE SAME SUMS AND IS THE AUTHORITY. These exist so the banners can say "short by
 * 40.00" while somebody is still typing, not to decide anything: posting is refused by the procedure
 * whatever this file believes, with the same tolerance.
 *
 * RATES ARE "UNITS OF THE CURRENCY PER 1 BASE" (USD base, CDF 2800), so base = amount / rate.
 */

/** Half a cent of the base currency: what the server forgives when it compares the three totals. */
export const BALANCE_TOLERANCE = 0.01

export interface ReceiptHeaderForm {
  receiptDate: string
  clientId: string | null
  branchId: string | null
  paymentType: ReceiptPaymentType
  currencyId: string | null
  amount: number | null
  /** Null while none is known; the page then warns and the reader types one. */
  exchangeRate: number | null
  notes: string
}

export interface ReceiptLineForm {
  key: string
  paymentMethodId: string | null
  currencyId: string | null
  amount: number | null
  exchangeRate: number | null
  /** True once the reader typed the rate, so a date change does not silently overwrite it. */
  rateEdited: boolean
  cashBankAccountId: string | null
  reference: string
}

/** An amount in the base currency. Zero when the rate is unknown, so a missing rate never shows a fake balance. */
export function toBase(amount: number | null, rate: number | null): number {
  if (amount === null || rate === null || !(rate > 0)) return 0
  return amount / rate
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function isBalanced(a: number, b: number): boolean {
  return Math.abs(a - b) <= BALANCE_TOLERANCE
}

/** An allocation row's value in the base currency: the amount in the invoice's currency over the invoice's own rate. */
export function allocationBase(invoice: OpenInvoiceDto, amount: number | null): number {
  return toBase(amount, invoice.exchangeRate)
}

/**
 * Spreads an amount over the oldest invoices first, each up to what it still owes.
 *
 * `availableBase` is in the base currency; the result is per invoice in the INVOICE's currency,
 * rounded to its decimals, so the figures typed in are the ones the server would accept.
 */
export function fillOldestFirst(invoices: OpenInvoiceDto[], availableBase: number): Record<number, number> {
  const result: Record<number, number> = {}
  let remaining = availableBase
  const ordered = [...invoices].sort((a, b) => a.documentDate.localeCompare(b.documentDate) || a.id - b.id)
  for (const invoice of ordered) {
    if (remaining <= BALANCE_TOLERANCE / 2) break
    const owedBase = invoice.outstandingBase
    const takeBase = Math.min(owedBase, remaining)
    const amount =
      takeBase >= owedBase ? invoice.outstandingAmount : round(takeBase * invoice.exchangeRate, invoice.decimalPlaces)
    if (amount > 0) {
      result[invoice.id] = amount
      remaining -= takeBase
    }
  }
  return result
}

/** Where the customer statement lives; its print view hangs off it. */
export const STATEMENT_ROUTE = '/sales/receipts/statement'

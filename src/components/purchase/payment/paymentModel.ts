import type { OpenPayableDocumentDto, PaymentInvoiceContainerDto, SupplierPaymentType } from '../../../api/purchase/payments'

/**
 * What the supplier payment form holds and the arithmetic it shows.
 *
 * THE SERVER DOES THE SAME SUMS AND IS THE AUTHORITY: these exist so the Total rows and the "Unbalanced"
 * banners are right while somebody types, and so Post Payment can stay disabled until they are. The
 * procedure refuses an unbalanced payment whatever this file believes, with the same tolerance.
 *
 * EVERYTHING BALANCES IN THE PAYMENT CURRENCY (the header's). A line or an allocation in another currency
 * converts with its multiplier: amount x rateToPayment.
 */

/** What the server forgives when it compares the totals (a cent of the payment currency). */
export const BALANCE_TOLERANCE = 0.01

export interface PaymentHeaderForm {
  paymentDate: string
  payeeId: string | null
  branchId: string | null
  paymentType: SupplierPaymentType
  currencyId: string | null
  amount: number | null
  /** Units of the payment currency per 1 base; null while unknown (the page then warns). */
  exchangeRate: number | null
  reference: string
  notes: string
}

export interface PaymentLineForm {
  key: string
  paymentMethodId: string | null
  currencyId: string | null
  amount: number | null
  /** Multiplier to the payment currency; 1 when the line is in the payment currency. */
  rateToPayment: number | null
  /** True once the reader typed the rate, so a date or currency change does not silently overwrite it. */
  rateEdited: boolean
  cashBankAccountId: string | null
  reference: string
  chequeNo: string
  chequeDate: string | null
  chequeDueDate: string | null
}

/** One allocation being typed: amount in the DOCUMENT's currency, and its multiplier to the payment currency. */
export interface AllocationEntry {
  amount: number | null
  rateToPayment: number | null
  /**
   * A purchase invoice with containers (script 73): the amount per container, keyed by containerKey,
   * in the invoice's currency. The invoice amount is always their sum.
   */
  containers?: Record<string, number | null>
}

/**
 * True when the invoice has two rows or more (containers, or a container and unlinked items): only then is
 * the payment split by hand. One container alone takes the whole amount, recorded by the server.
 */
export function needsSplit(doc: Pick<OpenPayableDocumentDto, 'containers'>): boolean {
  return doc.containers.length > 1
}

/** The key of a container row: its id, or "0" for "Unlinked items". */
export function containerKey(container: Pick<PaymentInvoiceContainerDto, 'containerId'>): string {
  return String(container.containerId ?? 0)
}

/**
 * Spreads an invoice amount over its containers, in their order ("Unlinked items" last), each up to what
 * it still owes; whatever is left (more than they owe) goes on the last row, so the server names it.
 */
export function distributeOverContainers(
  containers: PaymentInvoiceContainerDto[],
  amount: number | null,
  decimals: number,
): Record<string, number | null> {
  const result: Record<string, number | null> = {}
  let remaining = amount ?? 0
  containers.forEach((c, index) => {
    const last = index === containers.length - 1
    const take = last ? remaining : Math.min(Math.max(c.outstandingAmount, 0), remaining)
    const value = round(Math.max(take, 0), decimals)
    result[containerKey(c)] = value > 0 ? value : null
    remaining = round(remaining - value, decimals)
  })
  return result
}

/** The sum of an entry's container amounts. */
export function containersTotal(containers: Record<string, number | null> | undefined, decimals: number): number {
  return round(Object.values(containers ?? {}).reduce<number>((sum, v) => sum + (v ?? 0), 0), decimals)
}

/** An entry for a document at an amount: an invoice with containers also gets the amount spread over them. */
export function entryFor(doc: OpenPayableDocumentDto, amount: number | null, rateToPayment: number | null): AllocationEntry {
  if (!needsSplit(doc)) return { amount, rateToPayment }
  return { amount, rateToPayment, containers: distributeOverContainers(doc.containers, amount, doc.decimalPlaces) }
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/** An amount converted to the payment currency, rounded to the cent like the server's computed column. Zero while the rate is unknown. */
export function toPayment(amount: number | null, rate: number | null): number {
  if (amount === null || rate === null || !(rate > 0)) return 0
  return round(amount * rate, 2)
}

export function isBalanced(a: number, b: number): boolean {
  return Math.abs(a - b) <= BALANCE_TOLERANCE
}

/** The key an allocation entry is stored under: kind and id, since an invoice and a charge may share an id. */
export function docKey(kind: string, id: number): string {
  return `${kind}:${id}`
}

/**
 * Spreads an amount (in the payment currency) over the oldest documents first, each up to what it still
 * owes. The result is per document in ITS currency, rounded to its decimals.
 */
export function fillOldestFirst(
  documents: OpenPayableDocumentDto[],
  available: number,
  rateOf: (doc: OpenPayableDocumentDto) => number | null,
): Record<string, AllocationEntry> {
  const result: Record<string, AllocationEntry> = {}
  let remaining = available
  const ordered = [...documents].sort((a, b) => a.documentDate.localeCompare(b.documentDate) || a.documentId - b.documentId)
  for (const doc of ordered) {
    if (remaining <= BALANCE_TOLERANCE / 2) break
    const rate = rateOf(doc)
    if (!rate || !(rate > 0)) continue
    const owed = toPayment(doc.outstandingAmount, rate)
    const take = Math.min(owed, remaining)
    const amount = take >= owed ? doc.outstandingAmount : round(take / rate, doc.decimalPlaces)
    if (amount > 0) {
      result[docKey(doc.documentKind, doc.documentId)] = entryFor(doc, amount, rate)
      remaining -= toPayment(amount, rate)
    }
  }
  return result
}

/** Pending red, Partially Paid orange, Fully Paid green: a container's status at a glance. */
export function containerStatusColour(status: string): string {
  return status === 'Fully Paid' ? 'teal' : status === 'Partially Paid' ? 'orange' : 'red'
}

export const PAYMENTS_ROUTE = '/purchase/payments'

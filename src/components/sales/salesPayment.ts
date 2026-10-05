import type { CashBankAccountType } from '../../api/masterdata/cashBankAccounts'
import type { PaymentMethodLookupDto } from '../../api/masterdata/paymentMethods'
import type { SalesPaymentType } from '../../api/sales/invoices'

/** What the payment section of an invoice holds. The page owns the state; the card draws it. */
export interface SalesPaymentForm {
  /** null until the user chooses; posting needs it. */
  paymentType: SalesPaymentType | null
  receiptMethodId: string | null
  receiptAccountId: string | null
  paymentReference: string
}

export type SalesPaymentErrors = Partial<Record<keyof SalesPaymentForm, string>>

export const EMPTY_PAYMENT: SalesPaymentForm = { paymentType: null, receiptMethodId: null, receiptAccountId: null, paymentReference: '' }

/** The kind of account a receipt method pays into: cash into a cash box, anything else into a bank. */
export const accountTypeFor = (method: PaymentMethodLookupDto): CashBankAccountType =>
  method.methodCode.toUpperCase() === 'CASH' ? 'Cash' : 'Bank'

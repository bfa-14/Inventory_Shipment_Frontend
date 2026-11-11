import type { ChargePaymentType } from '../../api/logistics/containerCharges'

/** What the Payment panel of a container charge holds. The host owns the state; the panel draws it. */
export interface ChargePaymentForm {
  paymentType: ChargePaymentType
  methodId: string | null
  accountId: string | null
  reference: string
}

export type ChargePaymentErrors = Partial<Record<keyof ChargePaymentForm, string>>

/** Every charge before script 113 was on account, and a new one starts so: Cash is a choice. */
export const ON_ACCOUNT: ChargePaymentForm = { paymentType: 2, methodId: null, accountId: null, reference: '' }

/** What the server checks too (logistics.fn_ContainerCharge_PaymentProblem), said before the click. */
export function chargePaymentErrors(form: ChargePaymentForm, providerChosen: boolean): ChargePaymentErrors {
  if (form.paymentType !== 1) return {}
  const found: ChargePaymentErrors = {}
  if (!providerChosen) found.paymentType = 'A cash charge is paid to its provider: choose the provider.'
  if (!form.methodId) found.methodId = 'Choose how it was paid.'
  if (!form.accountId) found.accountId = 'Choose the account it was paid from.'
  return found
}

/** The four request fields of a create or an update. */
export function chargePaymentRequest(form: ChargePaymentForm) {
  const cash = form.paymentType === 1
  return {
    paymentType: form.paymentType,
    paymentMethodId: cash && form.methodId ? Number(form.methodId) : null,
    paymentAccountId: cash && form.accountId ? Number(form.accountId) : null,
    paymentReference: cash ? form.reference.trim() || null : null,
  }
}

/** A saved charge's payment as the panel's form. */
export function chargePaymentForm(dto: {
  paymentType: ChargePaymentType
  paymentMethodId: number | null
  paymentAccountId: number | null
  paymentReference: string | null
}): ChargePaymentForm {
  return {
    paymentType: dto.paymentType,
    methodId: dto.paymentMethodId === null ? null : String(dto.paymentMethodId),
    accountId: dto.paymentAccountId === null ? null : String(dto.paymentAccountId),
    reference: dto.paymentReference ?? '',
  }
}

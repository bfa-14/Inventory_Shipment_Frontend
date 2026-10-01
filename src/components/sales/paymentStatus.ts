/**
 * How an invoice's payment status is worded and coloured, in one place.
 *
 * THE SERVER'S WORDS ARE Unpaid / Partial / Paid and they stay that way on the wire and in the
 * filter values; only what is DRAWN changes to "Partially Paid" and "Fully Paid", the wording of the
 * requirement. Mapping here, once, keeps the list, the invoice page and the receipt's allocation
 * table from each deciding for themselves.
 */
const LABELS: Record<string, string> = {
  Unpaid: 'Unpaid',
  Partial: 'Partially Paid',
  Paid: 'Fully Paid',
}

const COLOURS: Record<string, string> = {
  Unpaid: 'gray',
  Partial: 'orange',
  Paid: 'green',
}

export function paymentStatusLabel(status: string | null | undefined): string {
  return status ? (LABELS[status] ?? status) : '—'
}

export function paymentStatusColour(status: string | null | undefined): string {
  return status ? (COLOURS[status] ?? 'gray') : 'gray'
}

/** The three statuses as a Select's data: the server's value, the requirement's label. */
export const PAYMENT_STATUS_OPTIONS = [
  { value: 'Unpaid', label: LABELS.Unpaid },
  { value: 'Partial', label: LABELS.Partial },
  { value: 'Paid', label: LABELS.Paid },
]

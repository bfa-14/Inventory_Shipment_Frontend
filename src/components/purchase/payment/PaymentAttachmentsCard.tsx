import type { DocumentFileDto } from '../../../api/documentFiles'
import { paymentsApi } from '../../../api/purchase/payments'
import { AttachmentsPanel, type AttachmentsSource } from '../../attachments/AttachmentsPanel'

interface PaymentAttachmentsCardProps {
  /** Null until the payment has been saved once: there is nothing to attach a file to before that. */
  paymentId: number | null
  /** Adding is allowed on a posted payment too — the SWIFT copy often arrives after the transfer. */
  canAdd: boolean
  /** Until the payment is reversed; a reversed payment's evidence stays as it was. */
  canRemove: boolean
  onChanged: () => void
}

/**
 * 4 - Attachments: the proof behind the money - the SWIFT copy, the cheque copy, the payment voucher, the
 * supplier's advice. The shared attachments list with the types used for supplier payments (PAY).
 */
export function PaymentAttachmentsCard({ paymentId, canAdd, canRemove, onChanged }: PaymentAttachmentsCardProps) {
  const api = paymentsApi.files
  const source: AttachmentsSource<DocumentFileDto> | null =
    paymentId === null
      ? null
      : {
          list: () => api.list(paymentId),
          upload: (file, fields) => api.add(paymentId, file, fields),
          update: (row, edit) => api.update(paymentId, row.id, edit),
          download: (row) => api.download(paymentId, row.id, row.fileName),
          remove: (row) => api.remove(paymentId, row.id),
        }

  return (
    <AttachmentsPanel
      title="4 · Attachments"
      documentKind="PAY"
      source={source}
      reloadKey={paymentId ?? 'new'}
      unsavedText="Save the draft first; files are attached to a saved payment."
      canAdd={canAdd}
      canRemove={canRemove}
      emptyText="No attachments."
      onChanged={onChanged}
    />
  )
}

import type { DocumentFileDto } from '../../../api/documentFiles'
import { receiptsApi } from '../../../api/sales/receipts'
import { AttachmentsPanel, type AttachmentsSource } from '../../attachments/AttachmentsPanel'

interface ReceiptAttachmentsCardProps {
  /** Null until the receipt has been saved once: there is nothing to attach a file to before that. */
  receiptId: number | null
  /** Adding (and retyping) is allowed on a posted receipt too - the cheque photo often arrives after the cash. */
  canAdd: boolean
  /** Removing is for drafts only; a posted receipt's evidence stays. */
  canRemove: boolean
  onChanged: () => void
}

/**
 * The paperwork behind the money: the cheque photo, the transfer slip, the signed acknowledgement - the shared
 * attachments list with the types used for customer receipts.
 */
export function ReceiptAttachmentsCard({ receiptId, canAdd, canRemove, onChanged }: ReceiptAttachmentsCardProps) {
  const api = receiptsApi.files
  const source: AttachmentsSource<DocumentFileDto> | null =
    receiptId === null
      ? null
      : {
          list: () => api.list(receiptId),
          upload: (file, fields) => api.add(receiptId, file, fields),
          update: (row, fields) => api.update(receiptId, row.id, fields),
          download: (row) => api.download(receiptId, row.id, row.fileName),
          remove: (row) => api.remove(receiptId, row.id),
        }

  return (
    <AttachmentsPanel
      title="Attachments"
      documentKind="RCPT"
      source={source}
      reloadKey={receiptId ?? 'new'}
      unsavedText="Save the draft first; files are attached to a saved receipt."
      canAdd={canAdd}
      canRemove={canRemove}
      emptyText="No attachments."
      onChanged={onChanged}
    />
  )
}

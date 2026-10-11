import { Stack, Text } from '@mantine/core'
import { goodsReceiptsApi } from '../../api/purchase/goodsReceipts'
import type { PurchaseDocumentDto } from '../../api/purchase/documents'
import { confirm } from '../ui/confirm'
import { PURCHASE_INVOICE, receiptCostPreviewText, receiveNowLabel } from './purchaseKind'
import { ReceiveNowChoice } from './ReceiveNowChoice'

/** The reader's answer to "Post this invoice?". */
export interface InvoicePostAnswer {
  post: boolean
  /** "Receive the goods now" was ticked (rule 15a): the API posts the invoice, then receives its goods. */
  receiveNow: boolean
}

/**
 * THE POST CONFIRMATION OF A SUPPLIER INVOICE since goods receipts (scripts 64-65): the stock does not change.
 *
 * - The sentence of `PURCHASE_INVOICE.postConfirm`.
 * - What the posting will do to goods ALREADY received, asked of the server (`receipt-cost-preview`, an estimate):
 *   "60 pcs already received will have their cost adjusted by +60.00 USD (…)", or "No goods received yet: …". Nothing
 *   is said when the preview cannot be read; the posting itself is the server's either way.
 * - "Receive the goods now into {warehouse}" (rule 15a), OFF by default: a LOCAL invoice (not shipped in containers),
 *   read by someone who may create and post goods receipts, with pieces left to receive.
 */
export async function askInvoicePost(invoice: PurchaseDocumentDto, canReceiveNow: boolean): Promise<InvoicePostAnswer> {
  let previewText: string | null = null
  let receivedAlready = 0
  try {
    const preview = await goodsReceiptsApi.receiptCostPreview(invoice.id)
    // The server's sentence when it sends one; the same sentence from its figures otherwise.
    previewText =
      preview.message ||
      receiptCostPreviewText(
        preview.receivedNotInvoicedBase,
        preview.differenceBase,
        preview.estimatedInventoryBase,
        preview.estimatedCogsBase,
        preview.baseCurrencyCode ?? invoice.baseCurrencyCode ?? 'USD',
      )
    receivedAlready = preview.receivedNotInvoicedBase
  } catch {
    /* An estimate only: without it the question says what posting does, and no more. */
  }

  const invoiced = invoice.lines.reduce((sum, line) => sum + line.quantityBase, 0)
  const warehouses = [...new Set(invoice.lines.map((line) => line.warehouseName || line.warehouseCode).filter(Boolean))]
  const offerReceive = canReceiveNow && !invoice.shippedInContainers && warehouses.length > 0 && receivedAlready < invoiced

  const choice = { receiveNow: false }
  const post = await confirm({
    title: `${PURCHASE_INVOICE.postVerb} this ${PURCHASE_INVOICE.noun}?`,
    confirmLabel: PURCHASE_INVOICE.postVerb,
    message: (
      <Stack gap="xs">
        <Text size="sm">{PURCHASE_INVOICE.postConfirm(invoice.warehouseName)}</Text>
        {previewText && (
          <Text size="sm" data-receipt-cost-preview>
            {previewText}
          </Text>
        )}
        {offerReceive && (
          <ReceiveNowChoice
            label={receiveNowLabel(warehouses)}
            onChange={(value) => {
              choice.receiveNow = value
            }}
          />
        )}
      </Stack>
    ),
  })
  return { post, receiveNow: post && offerReceive && choice.receiveNow }
}

import { Alert, Stack, Text } from '@mantine/core'
import { goodsReceiptsApi } from '../../api/purchase/goodsReceipts'
import type { PurchaseDocumentDto } from '../../api/purchase/documents'
import { confirm } from '../ui/confirm'
import { joinWarehouseCodes, noAccessSentenceFor } from '../../auth/warehouseAccess'
import {
  INVOICE_POST_CONFIRM_RECEIVING,
  isZeroAmount,
  PURCHASE_INVOICE,
  receiptCostPreviewText,
  receiptCostUnchangedText,
  receiveNowLabel,
  receiveOnPostText,
} from './purchaseKind'
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
 *   "60 pcs already received will have their cost adjusted by +60.00 USD (…)", "The invoice price equals the cost of
 *   the 84 pcs already received: their cost does not change." (0.00 on every line) or "No goods received yet: …". Nothing
 *   is said when the preview cannot be read; the posting itself is the server's either way.
 * - "Receive the goods now into {warehouse}" (rule 15a), OFF by default: a LOCAL invoice (not shipped in containers),
 *   read by someone who may create and post goods receipts, with pieces left to receive.
 * - (79) The document type decides instead when its "Affects on-hand" is on (`invoice.receiveOnPost`): the goods are
 *   received whoever posts, so the question SAYS so, with no tick and no goods receipt right needed. And when the type
 *   does not change item costs, the server's sentence ("… keep their cost: this invoice does not change item costs")
 *   is shown as it comes, never the "invoice price equals the cost" wording.
 * - (92) `usable(warehouseId)`: may the reader move stock there (the lookup's `canUse`). The invoice itself is never
 *   limited (A6), but its goods receipt is: "Receive the goods now" can be ticked only when every line it would receive
 *   (not in a container) is in one of the reader's warehouses - otherwise it stays, disabled and unticked, with the
 *   database's sentence under it (G7: a rule that blocks disables with its reason, it does not hide); when the TYPE
 *   receives on posting and one is not, an orange line says the invoice will be posted and its goods receipt refused.
 *   Left out, every warehouse is usable.
 */
export async function askInvoicePost(
  invoice: PurchaseDocumentDto,
  canReceiveNow: boolean,
  usable: (warehouseId: number) => boolean = () => true,
): Promise<InvoicePostAnswer> {
  let previewText: string | null = null
  let receivedAlready = 0
  try {
    const preview = await goodsReceiptsApi.receiptCostPreview(invoice.id)
    // The server's sentence when it sends one; the same sentence from its figures otherwise. A difference of 0.00 is
    // said in words ("…their cost does not change.") rather than "adjusted by 0.00 USD", whatever the server wrote.
    // Every line, not only the total: +10 on one line and -10 on another still changes two costs.
    const unchanged =
      preview.affectsCost !== false &&
      preview.receivedNotInvoicedBase > 0 &&
      isZeroAmount(preview.differenceBase) &&
      (preview.lines ?? []).every((line) => isZeroAmount(line.differenceBase))
    previewText = unchanged
      ? receiptCostUnchangedText(preview.receivedNotInvoicedBase)
      : preview.message ||
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
  const receivable = !invoice.shippedInContainers && warehouses.length > 0 && receivedAlready < invoiced
  const byType = invoice.receiveOnPost === true && receivable
  /* The warehouses its goods receipt would put stock into that the reader may not use: the lines outside containers. */
  const notYours = [
    ...new Set(
      invoice.lines
        .filter((line) => line.containerLineId === null && !usable(line.warehouseId))
        .map((line) => line.warehouseCode || line.warehouseName),
    ),
  ]
  const showReceive = canReceiveNow && receivable && !byType
  const offerReceive = showReceive && notYours.length === 0
  const notYoursCodes = joinWarehouseCodes(notYours)

  const choice = { receiveNow: false }
  const post = await confirm({
    title: `${PURCHASE_INVOICE.postVerb} this ${PURCHASE_INVOICE.noun}?`,
    confirmLabel: PURCHASE_INVOICE.postVerb,
    message: (
      <Stack gap="xs">
        <Text size="sm">{byType ? INVOICE_POST_CONFIRM_RECEIVING : PURCHASE_INVOICE.postConfirm(invoice.warehouseName)}</Text>
        {previewText && (
          <Text size="sm" data-receipt-cost-preview>
            {previewText}
          </Text>
        )}
        {byType && (
          <Text size="sm" data-receive-on-post>
            {receiveOnPostText(warehouses)}
          </Text>
        )}
        {byType && notYours.length > 0 && (
          /* An orange Alert, as every warning (the conventions): orange text alone is too faint to read on white. */
          <Alert color="orange" variant="light" p="xs" data-receive-not-yours>
            <Text size="sm">
              You may not use {notYoursCodes}: the invoice will be posted, but its goods receipt will be refused. Someone
              who may use {notYoursCodes} receives them with Receive goods…
            </Text>
          </Alert>
        )}
        {showReceive && (
          <ReceiveNowChoice
            label={receiveNowLabel(warehouses)}
            disabledReason={offerReceive ? null : noAccessSentenceFor(notYours)}
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

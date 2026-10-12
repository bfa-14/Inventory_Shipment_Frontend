import { Fragment, type MouseEvent } from 'react'
import { Anchor, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { MovementReceiptResultDto } from '../../api/purchase/goodsReceipts'
import { routes } from '../../routes'
import { notCreatedText, warehouseToChooseReason } from './containerReceipt'

/** Long enough to read a list of containers and follow a link. */
const AUTO_CLOSE = 15_000

/**
 * The notification after a Delivery-stage movement was completed (rule 5): "Draft goods receipts created: KTG-2026-0031,
 * KTG-2026-0032 (warehouse to choose). Not created: KTG-2026-0033 already has GRN-BR-002-000004."
 *
 * A draft made without the container's own warehouse says why under that sentence, once per reason for the containers
 * that share it: "KTG-2026-0032: choose the warehouse (LUB, the container's, has warehouses under it: …)." (script 72).
 *
 * Each created draft links to the receipt for a reader with the goods receipts view permission. The notifications are
 * rendered outside the router, so a link navigates through the page's own `navigate` rather than a router Link.
 *
 * A failure to create the drafts never failed the completion: the server's warnings are shown on their own.
 */
export function showDeliveryResult(
  results: MovementReceiptResultDto[] | null | undefined,
  warnings: string[] | null | undefined,
  options: { canViewReceipts: boolean; navigate: (to: string) => void },
): void {
  // The whole call failed: the server's warning stands alone. A container refused on its own is in the list below
  // with its reason, so its warning would only say it twice.
  if (!results || results.length === 0) {
    for (const warning of warnings ?? []) {
      notifications.show({ message: warning, color: 'orange', autoClose: AUTO_CLOSE, withBorder: true })
    }
    return
  }

  const created = results.filter((r) => r.created)
  const skipped = results.filter((r) => !r.created)

  const notificationId = `delivery-receipts-${Date.now()}`
  const open = (id: number) => (event: MouseEvent) => {
    event.preventDefault()
    notifications.hide(notificationId)
    options.navigate(routes.goodsReceipt(id))
  }
  /** One sentence per skipped container, joined, with one full stop at the end. */
  const notCreated = skipped.map((r) => notCreatedText(r).replace(/\.+$/, '')).join('; ')
  /** Why the container's own warehouse was not taken: the containers that share a reason, then the reason. */
  const whyToChoose = new Map<string, string[]>()
  for (const r of created) {
    const reason = warehouseToChooseReason(r)
    if (reason) whyToChoose.set(reason, [...(whyToChoose.get(reason) ?? []), r.containerRef])
  }

  const message = (
    <Stack gap={4} data-delivery-result>
      {created.length > 0 ? (
        <Text fz="sm">
          Draft goods receipts created:{' '}
          {created.map((r, index) => (
            <Fragment key={r.containerId}>
              {index > 0 ? ', ' : ''}
              {options.canViewReceipts && r.goodsReceiptId ? (
                <Anchor href={routes.goodsReceipt(r.goodsReceiptId)} onClick={open(r.goodsReceiptId)} fz="sm" fw={600}>
                  {r.containerRef}
                </Anchor>
              ) : (
                r.containerRef
              )}
              {r.warehouseCode ? '' : ' (warehouse to choose)'}
            </Fragment>
          ))}
          .
        </Text>
      ) : (
        <Text fz="sm">No draft goods receipt was created.</Text>
      )}
      {[...whyToChoose].map(([reason, refs]) => (
        <Text key={reason} fz="sm" c="orange.8">
          {refs.join(', ')}: {reason}.
        </Text>
      ))}
      {skipped.length > 0 ? <Text fz="sm">Not created: {notCreated}.</Text> : null}
    </Stack>
  )

  notifications.show({
    id: notificationId,
    message,
    color: created.length > 0 ? 'green' : 'orange',
    autoClose: AUTO_CLOSE,
    withBorder: true,
  })
}

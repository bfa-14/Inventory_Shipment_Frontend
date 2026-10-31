import { Fragment, type MouseEvent } from 'react'
import { Anchor, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { MovementReceiptResultDto } from '../../api/purchase/goodsReceipts'
import { routes } from '../../routes'
import { formatNumber } from '../format'
import { notCreatedText, warehouseToChooseReason } from './containerReceipt'

/** Long enough to read a list of containers and follow a link. */
const AUTO_CLOSE = 15_000

/**
 * How many containers each list of the notification names before "and N more" (script 78: a Delivery of 8,000
 * containers drew 8,000 links, a toast that covered the screen). The rest are on Purchase › Goods Receipts.
 */
const NAMED = 10

/** " and 7,990 more" after the first NAMED, else nothing. */
function andMore(total: number): string {
  return total > NAMED ? ` and ${formatNumber(total - NAMED)} more` : ''
}

/**
 * The notification after a Delivery-stage movement was completed (rule 5): "Draft goods receipts created: KTG-2026-0031,
 * KTG-2026-0032 (warehouse to choose). Not created: KTG-2026-0033 already has GRN-BR-002-000004."
 *
 * A draft made without the container's own warehouse says why under that sentence, once per reason for the containers
 * that share it: "KTG-2026-0032: choose the warehouse (LUB, the container's, has warehouses under it: …)." (script 72).
 *
 * Each created draft links to the receipt for a reader with the goods receipts view permission. The notifications are
 * rendered outside the router, so a link navigates through the page's own `navigate` rather than a router Link. Each
 * list names its first 10 containers, then "and N more"; past 10 drafts a link opens the Goods Receipts list.
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
  const go = (to: string) => (event: MouseEvent) => {
    event.preventDefault()
    notifications.hide(notificationId)
    options.navigate(to)
  }
  const open = (id: number) => go(routes.goodsReceipt(id))
  /** One sentence per skipped container (the first 10), joined, with one full stop at the end. */
  const notCreated =
    skipped
      .slice(0, NAMED)
      .map((r) => notCreatedText(r).replace(/\.+$/, ''))
      .join('; ') + andMore(skipped.length)
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
          {created.slice(0, NAMED).map((r, index) => (
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
          {andMore(created.length)}.
          {created.length > NAMED && options.canViewReceipts ? (
            <>
              {' '}
              <Anchor href={routes.goodsReceipts} onClick={go(routes.goodsReceipts)} fz="sm" fw={600}>
                Open Goods Receipts
              </Anchor>
            </>
          ) : null}
        </Text>
      ) : (
        <Text fz="sm">No draft goods receipt was created.</Text>
      )}
      {[...whyToChoose].map(([reason, refs]) => (
        <Text key={reason} fz="sm" c="orange.8">
          {refs.slice(0, NAMED).join(', ')}
          {andMore(refs.length)}: {reason}.
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

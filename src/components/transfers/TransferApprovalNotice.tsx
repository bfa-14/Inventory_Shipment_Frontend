import { Alert, Stack } from '@mantine/core'
import type { TransferOrderDto } from '../../api/inventory/transfers'
import { stamp } from '../documents/documentKind'
import { NEEDS_APPROVAL_HINT, notSentNotice } from './transferModel'

interface TransferApprovalNoticeProps {
  order: TransferOrderDto | null
  /** A NEW order: the TRO type's "Needs approval before release" (a loaded order carries its own). */
  needsApproval: boolean
  /** The reader holds Approve Transfer Orders: the gray hint is for the others. */
  canApprove: boolean
}

/**
 * What the order says about its approval and its end, above the header (2.6.3): who sent it for approval and when,
 * who rejected it and why, that a draft needs approval before release, that nothing more will be sent, that it was
 * cancelled. Each in the colour of what it is: yellow waits, red stops, teal is closed, gray is a hint.
 */
export function TransferApprovalNotice({ order, needsApproval, canApprove }: TransferApprovalNoticeProps) {
  const status = order?.status ?? 'Draft'
  const approval = order?.approval
  const notices = []

  if (order && status === 'PendingApproval') {
    notices.push(
      <Alert key="waiting" color="yellow" data-transfer-waiting>
        Waiting for approval since {stamp(approval?.requestedAtUtc)} (sent by {approval?.requestedByName ?? 'unknown'}).
      </Alert>,
    )
  }

  // Shown on the draft until it is sent again (Send for approval, Release and Approve clear the stamps).
  if (order && status === 'Draft' && approval?.rejectedAtUtc) {
    notices.push(
      <Alert key="rejected" color="red" data-transfer-rejected>
        Rejected by {approval.rejectedByName ?? 'an approver'} on {stamp(approval.rejectedAtUtc)}:{' '}
        {approval.rejectReason ?? ''}
      </Alert>,
    )
  }

  const draftNeedsApproval = status === 'Draft' && (order ? order.needsApproval : needsApproval)
  if (draftNeedsApproval && !canApprove) {
    notices.push(
      <Alert key="needs-approval" color="gray" data-transfer-needs-approval>
        {NEEDS_APPROVAL_HINT}
      </Alert>,
    )
  }

  if (order?.notSent) {
    notices.push(
      <Alert key="closed" color="teal" data-transfer-closed>
        {notSentNotice(order, stamp(order.notSent.atUtc))}
      </Alert>,
    )
  }

  if (order && status === 'Cancelled') {
    notices.push(
      <Alert key="cancelled" color="red" data-transfer-cancelled>
        Cancelled on {stamp(order.cancelled?.atUtc)} by {order.cancelled?.byName ?? 'unknown'}:{' '}
        {order.cancelled?.reason ?? ''}
      </Alert>,
    )
  }

  if (notices.length === 0) return null
  return <Stack gap="xs">{notices}</Stack>
}

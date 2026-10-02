import type { ApprovalDecisionResultDto } from '../../api/purchase/approvals'
import { notify } from '../ui/notify'

/**
 * What an approval decided, said the same way wherever it was decided (the order page, the Approvals
 * list): "Approved: PO-…" in green, then every warning the server sent — the supplier not emailed, an
 * email that could not be queued — each in orange, because the approval itself stands either way.
 */
export function announceApproved(result: ApprovalDecisionResultDto) {
  notify.success(`Approved: ${result.documentNumber ?? `order #${result.id}`}`)
  for (const warning of result.warnings) notify.warning(warning)
}

/** "45 min", "5 h", "2 d" — how long an order has waited, read at a glance. */
export function waitingLabel(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return 'less than 1 h'
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`
}

/** An order waiting longer than a day is late: the list shows it in orange. */
export const WAITING_LATE_HOURS = 24

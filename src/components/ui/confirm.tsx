import type { ReactNode } from 'react'
import { Text } from '@mantine/core'
import { modals } from '@mantine/modals'

export interface ConfirmOptions {
  title: string

  /**
   * Usually a sentence. A NODE is allowed for the few questions that have to show what they are
   * about — the purchase orders a shortage plan already produced — because a list of facts the
   * reader is being asked to weigh belongs in the question, not in a paragraph describing it.
   */
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button for destructive actions. */
  danger?: boolean
}

/**
 * Opens a confirmation dialog and resolves to the user's answer.
 *
 *   if (!(await confirm({ title: 'Delete branch', message: '...', danger: true }))) return
 */
export function confirm({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    modals.openConfirmModal({
      title,
      centered: true,
      // component="div": a node message may bring block elements, which are invalid inside a <p>.
      children: <Text size="sm" component="div">{message}</Text>,
      labels: { confirm: confirmLabel, cancel: cancelLabel },
      confirmProps: danger ? { color: 'red' } : undefined,
      onConfirm: () => resolve(true),
      // Cancelling and dismissing both mean "no"; the first resolve wins.
      onCancel: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
}

import { Text } from '@mantine/core'
import { modals } from '@mantine/modals'

export interface ConfirmOptions {
  title: string
  message: string
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
      children: <Text size="sm">{message}</Text>,
      labels: { confirm: confirmLabel, cancel: cancelLabel },
      confirmProps: danger ? { color: 'red' } : undefined,
      onConfirm: () => resolve(true),
      // Cancelling and dismissing both mean "no"; the first resolve wins.
      onCancel: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
}

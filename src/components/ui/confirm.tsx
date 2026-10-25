import type { ReactNode } from 'react'
import { Alert, Stack, Text } from '@mantine/core'
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
      // (90) The close button says what it is (it had no name for a screen reader).
      closeButtonProps: { 'aria-label': 'Close' },
      onConfirm: () => resolve(true),
      // Cancelling and dismissing both mean "no"; the first resolve wins.
      onCancel: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
}

export interface ConfirmActionOptions<T> extends ConfirmOptions {
  /** The action, run when the reader confirms: the dialog stays open, its button loading, until it answers. */
  run: () => Promise<T>
  /** The sentence a refusal is shown with, in the dialog (the server's words, as they come). */
  describeError: (error: unknown) => string
}

/**
 * A confirmation THAT DOES THE ACTION (script 90): resolves to the action's answer, or null when the reader said no.
 *
 * ENTER CONFIRMS: the cursor starts on the confirm button (on Cancel's side - the close button - for a `danger`
 * question, where Enter must not destroy anything). A REFUSAL STAYS IN THE DIALOG, red under the question, as the
 * server said it; the reader may try again or cancel. While the action runs nothing closes the dialog: an answer that
 * arrived after a cancel would be an action the page never shows.
 */
export function confirmAction<T>({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  run,
  describeError,
}: ConfirmActionOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: T | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const body = (error: string | null) => (
      <Stack gap="sm">
        <Text size="sm" component="div">
          {message}
        </Text>
        {error ? <Alert color="red">{error}</Alert> : null}
      </Stack>
    )
    const state = (busy: boolean, error: string | null) => ({
      children: body(error),
      confirmProps: { ...(danger ? { color: 'red' } : { 'data-autofocus': true }), loading: busy },
      cancelProps: { disabled: busy },
      closeOnEscape: !busy,
      closeOnClickOutside: !busy,
      withCloseButton: !busy,
    })

    const modalId = modals.openConfirmModal({
      title,
      centered: true,
      labels: { confirm: confirmLabel, cancel: cancelLabel },
      closeButtonProps: { 'aria-label': 'Close' },
      closeOnConfirm: false,
      ...state(false, null),
      onConfirm: () => {
        modals.updateModal({ modalId, ...state(true, null) })
        run().then(
          (value) => {
            finish(value)
            modals.close(modalId)
          },
          (error: unknown) => modals.updateModal({ modalId, ...state(false, describeError(error)) }),
        )
      },
      onCancel: () => finish(null),
      onClose: () => finish(null),
    })
  })
}

import { useState } from 'react'
import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core'

interface CancelReasonModalProps {
  opened: boolean
  onClose: () => void
  /** What is being cancelled, named in the question so nobody cancels the wrong document. */
  documentLabel: string
  busy?: boolean
  onConfirm: (reason: string) => void
}

/**
 * Asks why a posted document is being cancelled.
 *
 * THE REASON IS REQUIRED AND THE SERVER AGREES. Cancelling writes reversal movements into the
 * ledger, and a reversal nobody can account for is worse than no reversal at all — six months later
 * somebody is looking at two opposite movements on the same day with nothing to say why.
 *
 * A DIALOG RATHER THAN window.prompt: the native one cannot say what is being cancelled, cannot be
 * styled, cannot be dismissed by anything but its own two buttons, and is suppressed outright by
 * some browsers — which would turn "ask for a reason" into "cancel silently".
 */
export function CancelReasonModal({
  opened,
  onClose,
  documentLabel,
  busy,
  onConfirm,
}: CancelReasonModalProps) {
  /*
   * THE FORM IS A CHILD SO THAT CLOSING FORGETS IT. Mantine unmounts a modal's children when it
   * closes, so the reason box is empty on the next opening without an effect that has to remember
   * to clear it — and the previous cancellation's reason can never be attached to this one.
   */
  return (
    <Modal opened={opened} onClose={onClose} title={`Cancel ${documentLabel}`} centered>
      <ReasonForm onClose={onClose} busy={busy} onConfirm={onConfirm} />
    </Modal>
  )
}

function ReasonForm({
  onClose,
  busy,
  onConfirm,
}: Pick<CancelReasonModalProps, 'onClose' | 'busy' | 'onConfirm'>) {
  const [reason, setReason] = useState('')
  const ready = reason.trim().length > 0

  return (
    <>
      <Stack>
        <Text size="sm">
          Cancelling writes the opposite stock movements and leaves the document in place as a
          record. It cannot be undone.
        </Text>

        <Textarea
          label="Reason"
          withAsterisk
          placeholder="Why is this being cancelled?"
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          maxLength={300}
          autosize
          minRows={2}
          data-autofocus
        />

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button color="red" disabled={!ready} loading={busy} onClick={() => onConfirm(reason.trim())}>
            Cancel document
          </Button>
        </Group>
      </Stack>
    </>
  )
}

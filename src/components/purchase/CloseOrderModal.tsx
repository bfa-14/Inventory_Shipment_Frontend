import { useState } from 'react'
import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core'

interface CloseOrderModalProps {
  opened: boolean
  onClose: () => void
  documentLabel: string
  busy?: boolean
  onConfirm: (reason: string | null) => void
}

/**
 * Ends an open purchase order that will not be received any further.
 *
 * CLOSING IS NOT CANCELLING. Nothing is reversed: what was invoiced stays invoiced, and what was
 * not simply stops counting as incoming stock. The reason is optional — "the supplier is out of
 * it" is worth writing down, but an order closed because it is finished needs no explanation.
 */
export function CloseOrderModal({ opened, onClose, documentLabel, busy, onConfirm }: CloseOrderModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={`Close ${documentLabel}`} centered>
      <CloseForm onClose={onClose} busy={busy} onConfirm={onConfirm} />
    </Modal>
  )
}

function CloseForm({ onClose, busy, onConfirm }: Pick<CloseOrderModalProps, 'onClose' | 'busy' | 'onConfirm'>) {
  const [reason, setReason] = useState('')

  return (
    <Stack>
      <Text size="sm">
        Closing stops the remaining quantities counting as incoming stock. What has already been
        invoiced stays as it is, and no further purchase invoice can be made from this order.
      </Text>

      <Textarea
        label="Reason"
        placeholder="Optional — why is the rest not coming?"
        value={reason}
        onChange={(event) => setReason(event.currentTarget.value)}
        maxLength={300}
        autosize
        minRows={2}
        data-autofocus
      />

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={busy}>
          Keep it open
        </Button>
        <Button color="teal" loading={busy} onClick={() => onConfirm(reason.trim() || null)}>
          Close order
        </Button>
      </Group>
    </Stack>
  )
}

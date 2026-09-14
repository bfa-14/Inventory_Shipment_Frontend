import { Button, Group, Paper, Text } from '@mantine/core'
import { IconSend, IconTrash, IconX } from '@tabler/icons-react'
import { formatNumber } from '../format'

interface BulkActionsBarProps {
  count: number
  canPost: boolean
  canDelete: boolean
  busy: boolean
  onPost(): void
  onDelete(): void
  onClear(): void
}

/**
 * The strip above a document list once rows are ticked: how many, and what can be done to them.
 *
 * NOTHING UNTIL SOMETHING IS SELECTED. A bar with disabled buttons above an untouched grid is
 * furniture; one that appears with "3 selected" is a sentence. The actions are the family's own
 * permissions — a reader who may not post sees only Delete and Clear.
 */
export function BulkActionsBar({ count, canPost, canDelete, busy, onPost, onDelete, onClear }: BulkActionsBarProps) {
  if (count === 0) return null

  return (
    <Paper radius="lg" p="xs" withBorder mb="xs" bg="var(--mantine-color-blue-0)">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text fz="sm" fw={600} px="xs">
          {formatNumber(count)} selected
        </Text>
        <Group gap="xs">
          {canPost && (
            <Button size="xs" leftSection={<IconSend size={14} />} loading={busy} onClick={onPost}>
              Post selected
            </Button>
          )}
          {canDelete && (
            <Button size="xs" color="red" variant="light" leftSection={<IconTrash size={14} />} disabled={busy} onClick={onDelete}>
              Delete selected
            </Button>
          )}
          <Button size="xs" variant="subtle" leftSection={<IconX size={14} />} disabled={busy} onClick={onClear}>
            Clear
          </Button>
        </Group>
      </Group>
    </Paper>
  )
}

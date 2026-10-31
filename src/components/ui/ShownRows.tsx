import { Button, Group, Text } from '@mantine/core'
import { formatNumber } from '../format'
import { SHOWN_ROWS_STEP } from './useShownRows'

/** "Showing 200 of 1,049 containers. Show 200 more · Show all" under a list drawn in steps; nothing when all are drawn. */
export function ShownRowsFooter({
  limit,
  total,
  noun,
  more,
  all,
}: {
  limit: number
  total: number
  noun: string
  more(): void
  all(): void
}) {
  if (limit >= total) return null
  return (
    <Group gap="xs" mt="xs" data-shown-rows>
      <Text fz="sm" c="dimmed">
        Showing {formatNumber(limit)} of {formatNumber(total)} {noun}.
      </Text>
      <Button size="compact-xs" variant="light" onClick={more}>
        Show {formatNumber(Math.min(SHOWN_ROWS_STEP, total - limit))} more
      </Button>
      <Button size="compact-xs" variant="subtle" onClick={all}>
        Show all
      </Button>
    </Group>
  )
}

import { Divider, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { formatNumber } from '../format'
import { money } from './documentKind'

interface DocumentSummaryProps {
  totalItems: number
  /** Base units, the measure the ledger moves in. */
  totalQuantity: number
  totalCost: number | null
  currencyCode: string
  /**
   * (94) False for a reader without View item costs (inventory.costs.view): the Total Cost row and the divider above it
   * are not drawn. Absent: true.
   */
  showCost?: boolean
}

/**
 * What the document adds up to.
 *
 * QUANTITY IS IN BASE UNITS AND SAYS SO. Two boxes of twelve is twenty-four pieces, and a total
 * that said "2" would disagree with every stock report the same document produces. Naming the unit
 * in the label is cheaper than explaining the discrepancy later.
 *
 * IT IS COMPUTED FROM THE LINES ON SCREEN, not read back from the server, so it moves as the reader
 * types. The server's own totals are what a saved document shows, and the two agree because they are
 * the same arithmetic — but a total that only updated on save would make the form feel broken.
 */
export function DocumentSummary({ totalItems, totalQuantity, totalCost, currencyCode, showCost = true }: DocumentSummaryProps) {
  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        Summary
      </Title>

      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">Total Items</Text>
          <Text fw={500}>{formatNumber(totalItems)}</Text>
        </Group>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">Total Quantity (base units)</Text>
          <Text fw={500}>{formatNumber(totalQuantity)}</Text>
        </Group>

        {showCost && (
          <>
            <Divider />

            <Group justify="space-between">
              <Text fw={600}>Total Cost</Text>
              <Text fw={700} fz="lg">{money(totalCost, currencyCode)}</Text>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  )
}

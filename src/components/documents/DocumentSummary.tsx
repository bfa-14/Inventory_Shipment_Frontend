import { Divider, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { money } from './documentKind'

interface DocumentSummaryProps {
  totalItems: number
  /** Base units, the measure the ledger moves in. */
  totalQuantity: number
  totalCost: number
  currencyCode: string
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
export function DocumentSummary({ totalItems, totalQuantity, totalCost, currencyCode }: DocumentSummaryProps) {
  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        Summary
      </Title>

      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">Total Items</Text>
          <Text fw={500}>{totalItems}</Text>
        </Group>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">Total Quantity (base units)</Text>
          <Text fw={500}>{totalQuantity}</Text>
        </Group>

        <Divider />

        <Group justify="space-between">
          <Text fw={600}>Total Cost</Text>
          <Text fw={700} fz="lg">{money(totalCost, currencyCode)}</Text>
        </Group>
      </Stack>
    </Paper>
  )
}

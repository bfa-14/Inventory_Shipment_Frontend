import { Divider, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { formatMoney, formatNumber } from '../format'

interface SalesTotalsProps {
  totalItems: number
  /** Base units, the measure the ledger moves in. */
  totalQuantity: number
  subtotal: number
  totalDiscount: number
  totalAmount: number
  currencyCode: string
  decimalPlaces: number
  /** The base currency and the rate, for the "≈ … USD" line. Omitted on a base-currency invoice. */
  baseCurrencyCode?: string | null
  exchangeRate?: number | null
  isBaseCurrency: boolean
  title?: string
}

/**
 * What the sale adds up to.
 *
 * COMPUTED ON THE PAGE WHILE THE LINES ARE EDITED, and read back from the server once they are
 * posted — the same arithmetic, so the two agree, but a total that only moved on posting would
 * make the grid feel dead.
 *
 * THE BASE-CURRENCY LINE IS APPROXIMATE AND SAYS SO. The server converts at the rate stored on
 * the invoice with its own rounding; "≈" is honest about a figure that may differ by a cent.
 */
export function SalesTotals({
  totalItems,
  totalQuantity,
  subtotal,
  totalDiscount,
  totalAmount,
  currencyCode,
  decimalPlaces,
  baseCurrencyCode,
  exchangeRate,
  isBaseCurrency,
  title = 'Totals',
}: SalesTotalsProps) {
  const showBase = !isBaseCurrency && typeof exchangeRate === 'number' && exchangeRate > 0

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        {title}
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

        <Divider />

        <Group justify="space-between">
          <Text size="sm" c="dimmed">Subtotal</Text>
          <Text fw={500}>{formatMoney(subtotal, currencyCode, decimalPlaces)}</Text>
        </Group>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">Total Discount</Text>
          <Text fw={500}>{formatMoney(totalDiscount, currencyCode, decimalPlaces)}</Text>
        </Group>

        <Divider />

        <Group justify="space-between">
          <Text fw={600}>Grand Total</Text>
          <Text fw={700} fz="lg">{formatMoney(totalAmount, currencyCode, decimalPlaces)}</Text>
        </Group>

        {showBase && (
          <Text size="xs" c="dimmed" ta="right">
            ≈ {formatMoney(totalAmount / exchangeRate, baseCurrencyCode ?? 'USD')} at{' '}
            {formatNumber(exchangeRate, decimalPlaces)}
          </Text>
        )}
      </Stack>
    </Paper>
  )
}

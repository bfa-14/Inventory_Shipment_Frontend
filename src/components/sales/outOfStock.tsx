import { Alert, Button, Group, Stack, Table, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconAlertTriangle } from '@tabler/icons-react'
import { salesInvoicesApi, type OutOfStockLineDto } from '../../api/sales/invoices'
import { formatNumber } from '../format'
import { confirm } from '../ui/confirm'

/**
 * SELLING MORE THAN A WAREHOUSE HOLDS, from the user's side.
 *
 * The rule itself is the server's (a warehouse's own setting, else the global "Allow selling out-of-stock
 * items"): the server refuses a post it does not allow and refuses an allowed one until the user has
 * confirmed. This file is the asking. It shows the warning EVEN WHEN THE SETTING IS ON, because the
 * setting lets a sale through; it does not make the shortage unremarkable.
 */

/** A shortage as the dialog shows it. Names are optional: a refusal message carries only the codes. */
export interface OutOfStockRow {
  itemCode: string
  itemName?: string
  warehouseCode: string
  warehouseName?: string
  /** What the warehouse holds, in base units. */
  currentQty: number
  /** What is about to be sold, in base units. */
  quantitySold: number
}

const fromLine = (line: OutOfStockLineDto): OutOfStockRow => ({
  itemCode: line.itemCode,
  itemName: line.itemName,
  warehouseCode: line.warehouseCode,
  warehouseName: line.warehouseName,
  currentQty: line.currentQty,
  quantitySold: line.quantitySold,
})

/** "Item XYZ is out of stock in Warehouse ABC. Current Qty: 0. You're about to sell: 5 units." */
function sentence(row: OutOfStockRow): string {
  const item = row.itemName ? `${row.itemName} (${row.itemCode})` : row.itemCode
  const warehouse = row.warehouseName ?? row.warehouseCode
  return `Item ${item} is out of stock in Warehouse ${warehouse}. Current Qty: ${formatNumber(row.currentQty)}. You're about to sell: ${formatNumber(row.quantitySold)} unit${row.quantitySold === 1 ? '' : 's'}.`
}

function renderShortageTable(rows: OutOfStockRow[]) {
  return (
    <Table withTableBorder withColumnBorders fz="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Item</Table.Th>
          <Table.Th>Warehouse</Table.Th>
          <Table.Th ta="right">Current qty</Table.Th>
          <Table.Th ta="right">Selling</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={`${row.itemCode}|${row.warehouseCode}`}>
            <Table.Td>
              <Text fz="sm" fw={600}>
                {row.itemName ?? row.itemCode}
              </Text>
              {row.itemName ? (
                <Text fz="xs" c="dimmed">
                  {row.itemCode}
                </Text>
              ) : null}
            </Table.Td>
            <Table.Td>{row.warehouseName ? `${row.warehouseName} (${row.warehouseCode})` : row.warehouseCode}</Table.Td>
            <Table.Td ta="right" c={row.currentQty <= 0 ? 'red' : undefined}>
              {formatNumber(row.currentQty)}
            </Table.Td>
            <Table.Td ta="right" fw={600}>
              {formatNumber(row.quantitySold)}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

/**
 * The warning, with [Proceed] and [Cancel]. Resolves true when the user proceeds.
 */
export function confirmOutOfStock(rows: OutOfStockRow[]): Promise<boolean> {
  return confirm({
    title: 'Out of stock',
    confirmLabel: 'Proceed',
    cancelLabel: 'Cancel',
    message: (
      <Stack gap="sm">
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} p="sm">
          {rows.length === 1 ? sentence(rows[0]) : `${rows.length} items are out of stock in the warehouses they are sold from.`}
        </Alert>
        {rows.length > 1 ? renderShortageTable(rows) : null}
        <Text fz="sm">
          Proceeding posts the invoice anyway: the stock of {rows.length === 1 ? 'this item' : 'these items'} will go negative, and the sale is recorded in the
          out-of-stock log.
        </Text>
      </Stack>
    ),
  })
}

/** The refusal: the warehouse (or the global setting) does not allow selling what it does not hold. */
export function showOutOfStockBlocked(rows: OutOfStockRow[]): void {
  modals.open({
    title: 'Not enough stock',
    centered: true,
    children: (
      <Stack gap="sm">
        <Alert color="red" icon={<IconAlertTriangle size={18} />} p="sm">
          This invoice cannot be posted: {rows.length === 1 ? 'a line asks' : 'some lines ask'} for more than the warehouse holds, and selling out-of-stock items is not
          allowed there. Reduce the quantities, or ask an administrator to allow it in Settings (or on the warehouse).
        </Alert>
        {renderShortageTable(rows)}
        <Group justify="flex-end">
          <Button onClick={() => modals.closeAll()}>Close</Button>
        </Group>
      </Stack>
    ),
  })
}

export interface OutOfStockDecision {
  /** False when the user cancelled or the policy refuses the sale: do not post. */
  proceed: boolean
  /** True when a shortage was shown and accepted: post with acknowledgeOutOfStock. */
  acknowledge: boolean
}

/**
 * Asks the server what posting this invoice would run into and settles it with the user BEFORE posting:
 * nothing short means go ahead; a shortage the policy forbids is shown as a refusal; an allowed shortage
 * is shown as the warning and needs the user's [Proceed].
 */
export async function decideOutOfStock(invoiceId: number): Promise<OutOfStockDecision> {
  const check = await salesInvoicesApi.stockCheck(invoiceId)
  if (check.lines.length === 0) return { proceed: true, acknowledge: false }

  if (check.hasBlocked) {
    showOutOfStockBlocked(check.lines.map(fromLine))
    return { proceed: false, acknowledge: false }
  }

  const proceed = await confirmOutOfStock(check.lines.map(fromLine))
  return { proceed, acknowledge: proceed }
}

/**
 * The shortage a refusal message names: "Out of stock - confirmation required: TVS-AP160 in WH-001
 * (available 0, selling 5); ...". Used where there is no invoice to ask yet (the import page posts
 * in one call), so the dialog is built from what the server said.
 */
export function parseOutOfStockMessage(message: string): OutOfStockRow[] {
  const rows: OutOfStockRow[] = []
  for (const match of message.matchAll(/(\S+) in (\S+) \(available (-?\d+), selling (\d+)\)/g)) {
    rows.push({ itemCode: match[1], warehouseCode: match[2], currentQty: Number(match[3]), quantitySold: Number(match[4]) })
  }
  return rows
}

import { Alert, Button, Group, Stack, Table, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconAlertTriangle } from '@tabler/icons-react'
import { goodsReceiptsApi, type GoodsReceiptListItemDto } from '../../api/purchase/goodsReceipts'
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
  /** Draft goods receipts holding the item ("GRN draft of KTG-2026-0031"): stock on its way into the warehouse. */
  waitingReceipts?: string[]
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

/** "A goods receipt is waiting to be posted: GRN draft of KTG-2026-0031." - the stock may only be waiting for it. */
function waitingSentence(row: OutOfStockRow): string | null {
  if (!row.waitingReceipts || row.waitingReceipts.length === 0) return null
  return `A goods receipt is waiting to be posted: ${row.waitingReceipts.join(', ')}.`
}

/** The waiting receipts of every row that has one, one line per item, under the alert or the table. */
function waitingNotes(rows: OutOfStockRow[], single: boolean) {
  const notes = rows
    .map((row) => ({ row, text: waitingSentence(row) }))
    .filter((entry): entry is { row: OutOfStockRow; text: string } => entry.text !== null)
  if (notes.length === 0) return null
  return (
    <Stack gap={2} data-waiting-goods-receipts>
      {notes.map(({ row, text }) => (
        <Text key={`${row.itemCode}|${row.warehouseCode}`} fz="sm" fw={500}>
          {single ? text : `${row.itemCode}: ${text}`}
        </Text>
      ))}
    </Stack>
  )
}

/** "GRN draft of KTG-2026-0031" (of its container, order or invoice), or "GRN draft #12" for one without an order. */
function draftLabel(receipt: GoodsReceiptListItemDto): string {
  const of = receipt.containerRef ?? receipt.purchaseOrderNumber ?? receipt.purchaseInvoiceNumber
  return of ? `GRN draft of ${of}` : `GRN draft #${receipt.id}`
}

/**
 * The draft goods receipts that hold the items short on this invoice (rule 5.8 of goods receipts): a container delivered
 * to the warehouse whose receipt is not posted yet is the usual reason a sale finds no stock.
 *
 * Asked of the goods receipts list (drafts whose search matches the item code), then confirmed on each draft's lines,
 * because a search by code can also match another code that contains it. Bounded: a few items, a few drafts each.
 * Anything that fails leaves the warning as it was.
 */
async function waitingReceiptsFor(itemCodes: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>()
  const codes = [...new Set(itemCodes)].slice(0, 5)
  if (codes.length === 0) return found
  try {
    const pages = await Promise.all(codes.map((code) => goodsReceiptsApi.list({ status: 1, search: code, page: 1, pageSize: 10 })))
    const drafts = new Map<number, GoodsReceiptListItemDto>()
    for (const page of pages) for (const row of page.items) if (row.status === 1) drafts.set(row.id, row)
    const documents = await Promise.all([...drafts.values()].slice(0, 10).map((row) => goodsReceiptsApi.get(row.id)))
    for (const receipt of documents) {
      const row = drafts.get(receipt.id)
      if (!row) continue
      for (const code of codes) {
        if (!receipt.lines.some((line) => line.itemCode === code)) continue
        const labels = found.get(code) ?? []
        const label = draftLabel(row)
        if (!labels.includes(label)) labels.push(label)
        found.set(code, labels)
      }
    }
  } catch {
    /* Not readable (no permission, an older API): the warning goes without it. */
  }
  return found
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
        {waitingNotes(rows, rows.length === 1)}
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
        {waitingNotes(rows, false)}
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
 *
 * @param withGoodsReceipts the reader may see goods receipts: the warning then names the draft receipts waiting to be
 *        posted for the items short ("A goods receipt is waiting to be posted: GRN draft of KTG-2026-0031.").
 */
export async function decideOutOfStock(invoiceId: number, withGoodsReceipts = false): Promise<OutOfStockDecision> {
  const check = await salesInvoicesApi.stockCheck(invoiceId)
  if (check.lines.length === 0) return { proceed: true, acknowledge: false }

  const waiting = withGoodsReceipts ? await waitingReceiptsFor(check.lines.map((line) => line.itemCode)) : new Map<string, string[]>()
  const rows = check.lines.map((line) => ({ ...fromLine(line), waitingReceipts: waiting.get(line.itemCode) }))

  if (check.hasBlocked) {
    showOutOfStockBlocked(rows)
    return { proceed: false, acknowledge: false }
  }

  const proceed = await confirmOutOfStock(rows)
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

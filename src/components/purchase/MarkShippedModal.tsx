import { useState } from 'react'
import { Button, Group, Modal, NumberInput, Stack, Table, Text } from '@mantine/core'
import type { PurchaseDocumentLineDto } from '../../api/purchase/documents'
import { formatNumber, numberInputValue } from '../format'

interface MarkShippedModalProps {
  opened: boolean
  onClose: () => void
  documentLabel: string
  lines: PurchaseDocumentLineDto[]
  busy?: boolean
  /** The TOTAL shipped so far per line, in base units. */
  onConfirm: (lines: { lineId: number; shippedQuantityBase: number }[]) => void
}

/**
 * Records what the supplier has shipped on an open purchase order.
 *
 * IT MOVES NO STOCK. The shipped quantity is only what the shortage plan counts as Transit — on its
 * way, so not to be ordered again — until a purchase invoice receives it. The figure typed is the
 * TOTAL shipped so far on the line, not an addition to it: a second partial shipment of 3 after a
 * first of 4 is 7, and correcting a mistake is typing the right number.
 */
export function MarkShippedModal({ opened, onClose, documentLabel, lines, busy, onConfirm }: MarkShippedModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={`Mark as shipped — ${documentLabel}`} size="xl" centered>
      {opened && <ShippedForm onClose={onClose} lines={lines} busy={busy} onConfirm={onConfirm} />}
    </Modal>
  )
}

function ShippedForm({ onClose, lines, busy, onConfirm }: Pick<MarkShippedModalProps, 'onClose' | 'lines' | 'busy' | 'onConfirm'>) {
  const [shipped, setShipped] = useState<Record<number, number>>(() => Object.fromEntries(lines.map((l) => [l.id, l.shippedQuantityBase])))

  const changed = lines.some((l) => (shipped[l.id] ?? 0) !== l.shippedQuantityBase)
  const invalid = lines.some((l) => (shipped[l.id] ?? 0) < 0 || (shipped[l.id] ?? 0) > l.quantityBase)

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Quantities in base units. Shipped is the total the supplier has sent so far on each line; what is shipped and not yet
        received counts as <b>in transit</b> in the shortage plans.
      </Text>

      <Table.ScrollContainer minWidth={620}>
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={44}>#</Table.Th>
              <Table.Th>Item</Table.Th>
              <Table.Th ta="right">Ordered</Table.Th>
              <Table.Th ta="right">Received</Table.Th>
              <Table.Th ta="right">Shipped so far</Table.Th>
              <Table.Th w={150} ta="right">Shipped</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((line, index) => {
              const value = shipped[line.id] ?? 0
              return (
                <Table.Tr key={line.id}>
                  <Table.Td>{line.lineNo}</Table.Td>
                  <Table.Td>
                    <Text fz="sm" fw={500}>{line.itemCode}</Text>
                    <Text fz="xs" c="dimmed" lineClamp={1}>{line.itemName}</Text>
                  </Table.Td>
                  <Table.Td ta="right">{formatNumber(line.quantityBase)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(line.receivedQuantityBase)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(line.shippedQuantityBase)}</Table.Td>
                  <Table.Td>
                    <NumberInput
                      // Nothing shipped shows as an empty box over a "0" placeholder, so the first digit typed is the quantity.
                      value={value === 0 ? '' : value}
                      placeholder="0"
                      min={0}
                      max={line.quantityBase}
                      step={1}
                      allowDecimal={false}
                      allowNegative={false}
                      thousandSeparator=","
                      clampBehavior="strict"
                      onChange={(next) => setShipped((current) => ({ ...current, [line.id]: numberInputValue(next) ?? 0 }))}
                      aria-label={`Shipped quantity of line ${line.lineNo}`}
                      {...(index === 0 ? { 'data-autofocus': true } : {})}
                    />
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Group justify="space-between">
        <Button variant="default" disabled={busy} onClick={() => setShipped(Object.fromEntries(lines.map((l) => [l.id, l.quantityBase])))} data-all-shipped>
          All shipped
        </Button>
        <Group gap="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} disabled={!changed || invalid} onClick={() => onConfirm(lines.map((l) => ({ lineId: l.id, shippedQuantityBase: shipped[l.id] ?? 0 })))} data-mark-shipped-save>
            Save shipped quantities
          </Button>
        </Group>
      </Group>
    </Stack>
  )
}

import { Anchor, Button, Group, Modal, Table, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { Link } from 'react-router'
import type { CreatedPurchaseInvoiceDto } from '../../api/purchase/documents'
import { routes } from '../../routes'
import { formatMoney, formatNumber } from '../format'

interface CreatedInvoicesModalProps {
  opened: boolean
  invoices: CreatedPurchaseInvoiceDto[]
  /** The order's currency, for the totals; left out where it is not known (the container page). */
  currencyCode?: string
  /** The title; "{n} invoices created, one per item" (or "one per order") when left out. */
  title?: string
  /**
   * True (the default): each invoice holds one item, shown in the Item column. False: "One invoice per item" was off
   * and each invoice holds an order's items, so the column says how many lines it has.
   */
  onePerItem?: boolean
  /** The order the invoices are of, for "Go to the order's invoices"; none = no such button. */
  onGoToOrder?: () => void
  onClose: () => void
}

/**
 * The invoices a create or a split made. ONE INVOICE PER ITEM makes an order of three items three drafts
 * (and "Create Invoice from Containers" with the switch off makes one per order): they are listed here —
 * item, quantity, total, a link to each — rather than one of them being opened and the others left for the
 * reader to find.
 */
export function CreatedInvoicesModal({ opened, invoices, currencyCode, title, onePerItem = true, onGoToOrder, onClose }: CreatedInvoicesModalProps) {
  const fullScreen = useMediaQuery('(max-width: 768px)')
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title ?? `${formatNumber(invoices.length)} invoices created, one per ${onePerItem ? 'item' : 'order'}`}
      size="lg"
      fullScreen={fullScreen}
      centered={!fullScreen}
    >
      {/* NARROW ENOUGH FOR A PHONE: the item name wraps, the figures and the Open link stay in view at 390 px. */}
      <Table.ScrollContainer minWidth={320}>
        <Table verticalSpacing="xs" data-created-invoices>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Invoice</Table.Th>
              <Table.Th>{onePerItem ? 'Item' : 'Lines'}</Table.Th>
              <Table.Th ta="right">Qty</Table.Th>
              <Table.Th ta="right">Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {invoices.map((invoice) => (
              <Table.Tr key={invoice.id} data-created-invoice={invoice.id}>
                <Table.Td>
                  <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
                    Draft #{invoice.id}
                  </Text>
                  <Anchor component={Link} to={routes.purchaseInvoice(invoice.id)} fz="sm" fw={500} onClick={onClose}>
                    Open
                  </Anchor>
                </Table.Td>
                {onePerItem ? (
                  <Table.Td>
                    <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
                      {invoice.itemCode ?? '—'}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {invoice.itemName}
                    </Text>
                  </Table.Td>
                ) : (
                  <Table.Td>{formatNumber(invoice.lineCount)}</Table.Td>
                )}
                <Table.Td ta="right">{formatNumber(invoice.quantityBase)}</Table.Td>
                <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                  {currencyCode ? formatMoney(invoice.totalAmount, currencyCode) : formatNumber(invoice.totalAmount, 2)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>
          Close
        </Button>
        {onGoToOrder ? <Button onClick={onGoToOrder}>Go to the order's invoices</Button> : null}
      </Group>
    </Modal>
  )
}


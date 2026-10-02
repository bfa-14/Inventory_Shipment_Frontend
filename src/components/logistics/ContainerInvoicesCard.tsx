import { Anchor, Badge, Button, Group, Paper, ScrollArea, Table, Text, Title } from '@mantine/core'
import { IconFileInvoice } from '@tabler/icons-react'
import { Link } from 'react-router'
import { routes } from '../../routes'
import type { ContainerInvoiceDto } from '../../api/logistics/containers'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'

const INVOICE_STATUS: Record<number, { label: string; colour: string }> = {
  1: { label: 'Draft', colour: 'gray' },
  2: { label: 'Posted', colour: 'green' },
  3: { label: 'Cancelled', colour: 'red' },
  4: { label: 'Closed', colour: 'teal' },
}

/**
 * The purchase invoices covering the container's lines — derived from the invoice lines, never
 * linked by hand. Qty and amount are what each invoice puts IN THIS container.
 */
export function ContainerInvoicesCard({
  invoices,
  canInvoice,
  onCreate,
}: {
  invoices: ContainerInvoiceDto[]
  /** container.canInvoice and purchase.invoices.create. */
  canInvoice: boolean
  onCreate: () => void
}) {
  return (
    <Paper radius="lg" p="md" withBorder data-container-invoices>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Title order={5}>Invoices</Title>
        {canInvoice ? (
          <Button size="xs" color="green" leftSection={<IconFileInvoice size={14} />} onClick={onCreate}>
            Create invoice…
          </Button>
        ) : null}
      </Group>
      {invoices.length === 0 ? (
        <Text fz="sm" c="dimmed" ta="center" py="md">
          No invoice covers this container yet.
        </Text>
      ) : (
        <ScrollArea type="auto">
          <Table miw={920} verticalSpacing={6} striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Number</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Supplier</Table.Th>
                <Table.Th>Exporter ref.</Table.Th>
                <Table.Th>Commercial invoice no.</Table.Th>
                <Table.Th ta="right">Qty here</Table.Th>
                <Table.Th ta="right">Amount here</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {invoices.map((i) => {
                const status = INVOICE_STATUS[i.invoiceStatus] ?? { label: String(i.invoiceStatus), colour: 'gray' }
                return (
                  <Table.Tr key={i.purchaseDocumentId}>
                    <Table.Td>
                      <Anchor component={Link} to={routes.purchaseInvoice(i.purchaseDocumentId)} fz="sm" fw={600}>
                        {i.documentNumber ?? `Draft #${i.purchaseDocumentId}`}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>{dateLabel(i.documentDate)}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={status.colour}>
                        {status.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{i.supplierName}</Table.Td>
                    <Table.Td>{i.exporterReference ?? '—'}</Table.Td>
                    <Table.Td>{i.commercialInvoiceNo ?? '—'}</Table.Td>
                    <Table.Td ta="right">{formatNumber(i.qtyInContainerBase)}</Table.Td>
                    <Table.Td ta="right">{`${formatNumber(i.amountInContainer, 2)} ${i.currencyCode}`}</Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Paper>
  )
}

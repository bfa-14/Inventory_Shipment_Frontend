import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Loader, Modal, ScrollArea, Table, Text, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, isLoadable, type AvailableInvoiceDto } from '../../api/logistics/containers'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'

interface LinkInvoiceModalProps {
  opened: boolean
  onClose: () => void
  /** The container being edited, so what it already holds counts as available to it. */
  containerId: number | null
  /** Already linked; shown but not pickable again. */
  linkedIds: number[]
  onPick: (invoice: AvailableInvoiceDto) => void
}

/**
 * The purchase invoices that still have something to load. An invoice already received on posting
 * is in stock and cannot travel in a container: the server lists it, the page does not offer it.
 */
export function LinkInvoiceModal({ opened, onClose, containerId, linkedIds, onPick }: LinkInvoiceModalProps) {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 350)
  // The answer is kept with the query it answers, so a stale one is simply not shown: nothing has to
  // be reset when the query changes, and the loader is whatever has not answered yet.
  const key = `${debounced}|${containerId ?? ''}`
  const [answer, setAnswer] = useState<{ key: string; rows: AvailableInvoiceDto[] | null; error: string | null } | null>(null)
  const rows = answer?.key === key ? answer.rows : null
  const error = answer?.key === key ? answer.error : null

  useEffect(() => {
    if (!opened) return
    const controller = new AbortController()
    containersApi
      .availableInvoices({ search: debounced, containerId: containerId ?? undefined }, controller.signal)
      .then((result) => setAnswer({ key, rows: result.filter(isLoadable), error: null }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setAnswer({ key, rows: null, error: err instanceof ApiError ? err.message : 'The invoices could not be loaded.' })
      })
    return () => controller.abort()
  }, [opened, debounced, containerId, key])

  return (
    <Modal opened={opened} onClose={onClose} title="Link Purchase Invoice" size="80rem">
      <TextInput
        placeholder="PI no., commercial invoice no., exporter ref. or supplier"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        mb="sm"
        data-autofocus
      />
      {error ? <Alert color="red">{error}</Alert> : null}
      {rows === null && !error ? <Loader size="sm" /> : null}
      {rows && rows.length === 0 ? (
        <Text c="dimmed" ta="center" py="lg">
          No purchase invoice has anything left to load.
        </Text>
      ) : null}
      {rows && rows.length > 0 ? (
        <ScrollArea type="auto">
          <Table striped highlightOnHover miw={980}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>PI No.</Table.Th>
                <Table.Th>PI Date</Table.Th>
                <Table.Th>Supplier</Table.Th>
                <Table.Th>Currency</Table.Th>
                <Table.Th>Exporter Ref.</Table.Th>
                <Table.Th>Commercial Invoice No.</Table.Th>
                <Table.Th ta="right">Total</Table.Th>
                <Table.Th ta="right">Allocated</Table.Th>
                <Table.Th ta="right">Remaining</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => {
                const linked = linkedIds.includes(row.id)
                return (
                  <Table.Tr key={row.id}>
                    <Table.Td>
                      {row.documentNumber ?? (
                        <Badge color="gray" variant="light">
                          DRAFT #{row.id}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>{dateLabel(row.documentDate)}</Table.Td>
                    <Table.Td>{row.supplierName}</Table.Td>
                    <Table.Td>{row.currencyCode}</Table.Td>
                    <Table.Td>{row.exporterReference ?? '—'}</Table.Td>
                    <Table.Td>{row.commercialInvoiceNo ?? '—'}</Table.Td>
                    <Table.Td ta="right">{formatNumber(row.totalQtyBase)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(row.allocatedBase)}</Table.Td>
                    <Table.Td ta="right" fw={600}>
                      {formatNumber(row.remainingBase)}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Button size="xs" variant="light" disabled={linked} onClick={() => onPick(row)}>
                        {linked ? 'Linked' : 'Link'}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      ) : null}
    </Modal>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { Anchor, Badge, Checkbox, Group, Paper, Progress, ScrollArea, Table, Text, Title } from '@mantine/core'
import { Link } from 'react-router'
import { fetchAllPages, WHOLE_LIST_PAGE_SIZE } from '../../api/fetchAllPages'
import { containersApi, containerStatusColour, containerStatusLabel, type ContainerListDto } from '../../api/logistics/containers'
import type { PurchaseInvoiceContainerDto } from '../../api/purchase/documents'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'
import { fillColour } from '../logistics/containerFill'
import { ContainerFillCell } from '../logistics/ContainerFillLine'
import { containerReceiptOf } from '../logistics/containerReceipt'
import { ContainerSelectionBar } from '../logistics/ContainerSelectionBar'
import { refreshSelection } from '../logistics/containerSelection'
import { ShownRowsFooter } from '../ui/ShownRows'
import { useShownRows } from '../ui/useShownRows'

interface OrderContainersCardProps {
  purchaseOrderId: number
  containers: PurchaseInvoiceContainerDto[]
  actions?: ReactNode
  /**
   * The ticked containers, held by the host: its reload shows a loader in place of the page, which
   * unmounts this card - a selection kept here would not survive the reload after an action.
   */
  selected: ContainerListDto[]
  onSelectedChange(next: ContainerListDto[]): void
  /** After a bulk action: the host reloads the order (and with it this card). */
  onChanged(): void
  /** What an empty card says. The default points at Add Container, for a reader who can press it. */
  emptyText?: string
}

/**
 * "Received 05/10/2026 into LUB-WH (GRN-BR-002-000001)": the goods of the container are in stock. The GRN number comes
 * from the container list (a container offloaded before goods receipts has none).
 */
function receivedText(date: string, warehouseCode: string | null, row: ContainerListDto | undefined): string {
  const receipt = row ? containerReceiptOf(row) : null
  const number = receipt?.status === 2 && receipt.number ? ` (${receipt.number})` : ''
  return `Received ${dateLabel(date)} into ${warehouseCode ?? '—'}${number}`
}

/**
 * The containers of a purchase ORDER: where its goods are. Loaded, Invoiced and Received are this
 * order's quantities on each container (a container may carry lines of other orders too). The
 * buttons — Add Container, Auto-plan, Create Invoice from Containers — are the host's, passed as
 * `actions`.
 *
 * TICKED ROWS ARE CONTAINER LIST ROWS. The order's own figures come with the order; the rest — the
 * capacity and fill, the movement in progress that the quick selectors read — is the container
 * list for this order, asked again whenever the order is reloaded. Without containers.view that
 * list is refused and the card stays as it was: no checkboxes, no fill. EVERY PAGE OF IT (script 78:
 * any number of containers): one page of 200 left the containers after it without a checkbox, out of
 * "Select every container" and of the bulk actions.
 */
export function OrderContainersCard({
  purchaseOrderId,
  containers,
  actions,
  selected: heldSelection,
  onSelectedChange: setSelected,
  onChanged,
  emptyText = 'No container yet - use Add Container or Auto-plan.',
}: OrderContainersCardProps) {
  const [rows, setRows] = useState<ContainerListDto[]>([])
  // Drawn in steps (2,000 rows at once froze the page); every row is loaded, so the selection reaches all of them.
  const shown = useShownRows(containers.length)

  useEffect(() => {
    const controller = new AbortController()
    fetchAllPages(
      (page, pageSize) => containersApi.list({ purchaseOrderId, page, pageSize, sortBy: 'ContainerRef', sortDir: 'asc' }, controller.signal),
      { maxRows: Infinity, pageSize: WHOLE_LIST_PAGE_SIZE },
    )
      .then((result) => {
        if (!controller.signal.aborted) setRows(result.items)
      })
      .catch(() => {
        if (!controller.signal.aborted) setRows([])
      })
    return () => controller.abort()
    // Asked again with every reload of the order: the host passes a new array then.
  }, [purchaseOrderId, containers])

  const byId = new Map(rows.map((row) => [row.id, row]))
  // The ticked rows as they are now (a confirm changes their status); gone ones (deleted) drop out.
  const selected = refreshSelection(heldSelection, rows).filter((row) => byId.has(row.id))
  const selectable = rows.length > 0
  const selectedIds = new Set(selected.map((row) => row.id))
  const allTicked = selectable && rows.every((row) => selectedIds.has(row.id))
  const someTicked = selected.length > 0 && !allTicked

  function toggle(row: ContainerListDto, on: boolean) {
    setSelected(on ? [...selected.filter((r) => r.id !== row.id), row] : selected.filter((r) => r.id !== row.id))
  }

  return (
    <Paper radius="lg" p="md" withBorder data-order-containers>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
        <Title order={5}>Containers</Title>
        {actions ? <Group gap="xs">{actions}</Group> : null}
      </Group>
      {containers.length === 0 ? (
        <Text fz="sm" c="dimmed" ta="center" py="md">
          {emptyText}
        </Text>
      ) : (
        <>
          {selectable ? (
            <ContainerSelectionBar
              rows={rows}
              selected={selected}
              onSelectedChange={setSelected}
              onChanged={onChanged}
            />
          ) : null}
          <ScrollArea type="auto">
            <Table miw={1100} verticalSpacing={6} striped>
              <Table.Thead>
                <Table.Tr>
                  {selectable ? (
                    <Table.Th w={36}>
                      <Checkbox
                        size="xs"
                        aria-label="Select every container"
                        checked={allTicked}
                        indeterminate={someTicked}
                        onChange={(e) => setSelected(e.currentTarget.checked ? rows : [])}
                      />
                    </Table.Th>
                  ) : null}
                  <Table.Th>Ref.</Table.Th>
                  <Table.Th>Container No.</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right">Loaded (this order)</Table.Th>
                  <Table.Th w={150}>Fill</Table.Th>
                  <Table.Th ta="right">Invoiced</Table.Th>
                  <Table.Th ta="right">Received</Table.Th>
                  <Table.Th>Current location</Table.Th>
                  <Table.Th>ETA</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {containers.slice(0, shown.limit).map((c) => {
                  const row = byId.get(c.id)
                  return (
                    <Table.Tr key={c.id} bg={selectedIds.has(c.id) ? 'var(--mantine-color-blue-0)' : undefined} data-container-row={c.containerRef}>
                      {selectable ? (
                        <Table.Td>
                          {row ? (
                            <Checkbox
                              size="xs"
                              aria-label={`Select ${c.containerRef}`}
                              checked={selectedIds.has(c.id)}
                              onChange={(e) => toggle(row, e.currentTarget.checked)}
                            />
                          ) : null}
                        </Table.Td>
                      ) : null}
                      <Table.Td>
                        <Anchor component={Link} to={`/logistics/containers/${c.id}`} fz="sm" fw={600}>
                          {c.containerRef}
                        </Anchor>
                      </Table.Td>
                      <Table.Td>{c.containerNo ?? '—'}</Table.Td>
                      <Table.Td>{c.containerTypeCode}</Table.Td>
                      <Table.Td>
                        <Badge color={containerStatusColour(c.status)} variant={c.status === 7 ? 'filled' : 'light'}>
                          {containerStatusLabel(c.status)}
                        </Badge>
                      </Table.Td>
                      <Table.Td ta="right">{formatNumber(c.allocatedBase)}</Table.Td>
                      <Table.Td>
                        {row ? (
                          <div data-container-fill-cell>
                            <ContainerFillCell fillPct={row.fillPct} missingItems={row.missingContainerUnitItems} />
                            {row.fillPct !== null ? (
                              <Progress value={Math.min(100, row.fillPct)} color={fillColour(row.fillPct)} size="sm" radius="xl" mt={2} />
                            ) : null}
                          </div>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td ta="right">{formatNumber(c.invoicedBase)}</Table.Td>
                      <Table.Td ta="right">{formatNumber(c.receivedBase)}</Table.Td>
                      <Table.Td>
                        {c.offloadedDate ? receivedText(c.offloadedDate, c.warehouseCode, row) : (c.currentLocation ?? '—')}
                      </Table.Td>
                      <Table.Td>{c.eta ? dateLabel(c.eta) : '—'}</Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <ShownRowsFooter limit={shown.limit} total={containers.length} noun="containers" more={shown.more} all={shown.all} />
        </>
      )}
    </Paper>
  )
}

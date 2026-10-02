import { useEffect, useState } from 'react'
import { Alert, Anchor, Badge, Button, Group, Loader, Paper, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconBox, IconBoxMultiple, IconLink, IconUnlink } from '@tabler/icons-react'
import { Link } from 'react-router'
import { ApiError } from '../../api/http'
import { containerStatusColour } from '../../api/logistics/containers'
import type { PurchaseDocumentDto } from '../../api/purchase/documents'
import { invoiceContainersApi, type InvoiceContainerSummaryDto } from '../../api/purchase/invoiceContainers'
import { formatNumber } from '../format'
import { AddContainerModal } from '../logistics/AddContainerModal'
import { AutoPlanModal } from '../logistics/AutoPlanModal'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { LinkContainersModal } from './LinkContainersModal'

interface ShippedInvoiceContainersCardProps {
  invoice: PurchaseDocumentDto
  /** The switch is on but not saved yet: nothing can be linked before the save. */
  pendingSwitch: boolean
  /** The invoice edit permission, on an invoice that can still take containers (draft, or posted and shipped). */
  canLink: boolean
  /** containers.create on top of it: Add container… and Auto-plan…. */
  canAddContainers: boolean
  canOverCapacity: boolean
  canConfirmContainers: boolean
  /** Linking rewrites the invoice's lines: false (and the reader told) while the page holds unsaved changes. */
  ensureSaved: () => boolean
  /** The invoice changed on the server: the page reads it again (lines, row version, totals). */
  onChanged: () => void
}

type Dialog = 'link' | 'add' | 'plan'

const containersLabel = (n: number) => (n === 1 ? '1 container' : `${formatNumber(n)} containers`)

/**
 * The containers of an invoice SHIPPED IN CONTAINERS: per item what it needs and what is linked, the containers it
 * is linked to, and the three ways to complete it - link existing containers of the order, add one, or auto-plan.
 * Its goods enter the stock at the offload of those containers, so pieces "not in a container yet" are the ones the
 * reader still has to place (orange).
 */
export function ShippedInvoiceContainersCard({
  invoice,
  pendingSwitch,
  canLink,
  canAddContainers,
  canOverCapacity,
  canConfirmContainers,
  ensureSaved,
  onChanged,
}: ShippedInvoiceContainersCardProps) {
  const [summary, setSummary] = useState<InvoiceContainerSummaryDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [unlinking, setUnlinking] = useState<number | null>(null)

  // Read again whenever the invoice changes on the server (a new row version).
  useEffect(() => {
    if (pendingSwitch) return
    const controller = new AbortController()
    invoiceContainersApi
      .summary(invoice.id, controller.signal)
      .then((result) => {
        setSummary(result)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoadError(err instanceof ApiError ? err.message : 'The containers could not be loaded.')
      })
    return () => controller.abort()
  }, [invoice.id, invoice.rowVersion, pendingSwitch])

  const unlinked = summary?.items.reduce((sum, item) => sum + item.unlinkedBase, 0) ?? 0
  const blocked = pendingSwitch
    ? 'Save the invoice first: its containers are linked once "Shipped in containers" is saved.'
    : unlinked === 0
      ? 'Every piece of this invoice is in a container.'
      : null

  // The invoice's pieces outside containers, per order line: what Add container may load.
  const unlinkedByPoLine: Record<number, number> = {}
  for (const line of invoice.lines) {
    if (line.containerLineId == null && line.sourceLineId != null) {
      unlinkedByPoLine[line.sourceLineId] = (unlinkedByPoLine[line.sourceLineId] ?? 0) + line.quantityBase
    }
  }
  const order = {
    id: invoice.sourceDocumentId ?? 0,
    documentNumber: invoice.sourceDocumentNumber ?? null,
    branchId: invoice.branchId,
    warehouseId: invoice.warehouseId,
  }

  function open(next: Dialog) {
    if (ensureSaved()) setDialog(next)
  }

  function changed(next?: InvoiceContainerSummaryDto) {
    if (next) setSummary(next)
    setDialog(null)
    onChanged()
  }

  async function unlink(containerId: number, containerRef: string, pieces: number) {
    if (!ensureSaved()) return
    const ok = await confirm({
      title: 'Unlink container',
      message: `The invoice's ${formatNumber(pieces)} pieces on ${containerRef} go back to "Not in a container yet". The container stays on the order.`,
      confirmLabel: 'Unlink',
    })
    if (!ok) return

    setUnlinking(containerId)
    try {
      changed(await invoiceContainersApi.unlink(invoice.id, containerId, invoice.rowVersion))
      notify.success(`${containerRef} unlinked from the invoice.`)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The container could not be unlinked.')
    } finally {
      setUnlinking(null)
    }
  }

  const action = (key: Dialog, label: string, icon: React.ReactNode, visible: boolean) =>
    !visible ? null : blocked ? (
      <Tooltip key={key} label={blocked} withArrow multiline w={260}>
        <Button size="xs" variant={key === 'link' ? 'filled' : 'light'} leftSection={icon} data-disabled aria-disabled onClick={(e) => e.preventDefault()}>
          {label}
        </Button>
      </Tooltip>
    ) : (
      <Button key={key} size="xs" variant={key === 'link' ? 'filled' : 'light'} leftSection={icon} onClick={() => open(key)} data-invoice-container-action={key}>
        {label}
      </Button>
    )

  // Several items: one container per item from the invoice, so the summary per container lists its item.
  const containerRows = summary?.containers ?? []
  const pieces = (containerId: number) => containerRows.filter((c) => c.containerId === containerId).reduce((sum, c) => sum + c.quantityBase, 0)

  return (
    <Paper radius="lg" p="md" withBorder data-shipped-invoice-containers>
      <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
        <div>
          <Title order={5}>Containers</Title>
          <Text fz="xs" c="dimmed">Shipped in containers: the goods enter the stock at the offload of these containers.</Text>
        </div>
        <Group gap="xs">
          {action('link', 'Link containers…', <IconLink size={14} />, canLink)}
          {action('add', 'Add container…', <IconBox size={14} />, canLink && canAddContainers)}
          {action('plan', 'Auto-plan…', <IconBoxMultiple size={14} />, canLink && canAddContainers)}
        </Group>
      </Group>

      {pendingSwitch ? (
        <Alert color="blue" variant="light">Save the invoice to ship it in containers, then link its containers here.</Alert>
      ) : loadError ? (
        <Alert color="red" variant="light">{loadError}</Alert>
      ) : summary === null ? (
        <Group justify="center" py="md"><Loader size="sm" /></Group>
      ) : (
        <>
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing={6} data-invoice-container-items>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Item</Table.Th>
                  <Table.Th ta="right">Invoiced</Table.Th>
                  <Table.Th ta="right">Pcs per container</Table.Th>
                  <Table.Th ta="right">Containers needed</Table.Th>
                  <Table.Th>Linked</Table.Th>
                  <Table.Th ta="right">Not linked</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {summary.items.map((item) => (
                  <Table.Tr key={item.itemId}>
                    <Table.Td>
                      <Text fz="sm" fw={500}>{item.itemCode}</Text>
                      <Text fz="xs" c="dimmed" lineClamp={1}>{item.itemName}</Text>
                    </Table.Td>
                    <Table.Td ta="right">{formatNumber(item.invoicedBase)} pcs</Table.Td>
                    <Table.Td ta="right">
                      {item.pcsPerContainer === null ? (
                        <Anchor component={Link} to={`/inventory/items/${item.itemId}`} fz="sm" c="orange" fw={500}>
                          Set the Container unit in Item Definition
                        </Anchor>
                      ) : (
                        formatNumber(item.pcsPerContainer)
                      )}
                    </Table.Td>
                    <Table.Td ta="right" data-containers-needed>
                      {item.containersNeeded === null
                        ? '—'
                        : `${formatNumber(item.containersNeeded, item.containersNeeded % 1 === 0 ? 0 : 1)} (${formatNumber(item.fullContainers)} full${item.partialPieces ? ` + ${formatNumber(item.partialPieces)} pcs` : ''})`}
                    </Table.Td>
                    <Table.Td data-linked>
                      {item.linkedBase === 0 ? <Text fz="sm" c="dimmed">None yet</Text> : `${formatNumber(item.linkedBase)} pcs in ${containersLabel(item.containersLinked)}`}
                    </Table.Td>
                    <Table.Td ta="right" fw={item.unlinkedBase > 0 ? 700 : 400} c={item.unlinkedBase > 0 ? 'orange' : undefined} data-not-linked>
                      {formatNumber(item.unlinkedBase)} pcs
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          {containerRows.length > 0 && (
            <Table.ScrollContainer minWidth={760} mt="sm">
              <Table striped verticalSpacing={6} data-invoice-linked-containers>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Container</Table.Th>
                    <Table.Th>No.</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Item</Table.Th>
                    <Table.Th ta="right">Pieces</Table.Th>
                    <Table.Th ta="right">Share of the container</Table.Th>
                    <Table.Th w={110} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {containerRows.map((c, index) => {
                    const first = index === 0 || containerRows[index - 1].containerId !== c.containerId
                    return (
                      <Table.Tr key={`${c.containerId}-${c.itemId}`} data-linked-container={c.containerRef}>
                        <Table.Td>
                          <Anchor component={Link} to={`/logistics/containers/${c.containerId}`} fz="sm" fw={600}>{c.containerRef}</Anchor>
                        </Table.Td>
                        <Table.Td>{c.containerNo ?? '—'}</Table.Td>
                        <Table.Td>
                          <Badge size="sm" variant="light" color={containerStatusColour(c.status)}>{c.statusName}</Badge>
                        </Table.Td>
                        <Table.Td>{c.itemCode}</Table.Td>
                        <Table.Td ta="right">{formatNumber(c.quantityBase)}</Table.Td>
                        <Table.Td ta="right">{c.shareOfContainerPct === null ? '—' : `${formatNumber(c.shareOfContainerPct, 0)} %`}</Table.Td>
                        <Table.Td ta="right">
                          {first && canLink && c.canUnlink && (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              color="red"
                              leftSection={<IconUnlink size={13} />}
                              loading={unlinking === c.containerId}
                              onClick={() => void unlink(c.containerId, c.containerRef, pieces(c.containerId))}
                              data-unlink={c.containerRef}
                            >
                              Unlink
                            </Button>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </>
      )}

      {dialog === 'link' && (
        <LinkContainersModal invoiceId={invoice.id} rowVersion={invoice.rowVersion} onClose={() => setDialog(null)} onLinked={(next) => changed(next)} />
      )}
      {dialog === 'add' && (
        <AddContainerModal
          opened
          onClose={() => setDialog(null)}
          order={order}
          invoice={{ id: invoice.id, documentNumber: invoice.documentNumber, rowVersion: invoice.rowVersion, unlinkedByPoLine }}
          canOverCapacity={canOverCapacity}
          onInvoiceSaved={(result) => changed(result.summary)}
        />
      )}
      {dialog === 'plan' && (
        <AutoPlanModal
          order={order}
          invoice={{ id: invoice.id, documentNumber: invoice.documentNumber, rowVersion: invoice.rowVersion }}
          canOverCapacity={canOverCapacity}
          canConfirm={canConfirmContainers}
          onClose={() => setDialog(null)}
          onCreated={() => changed()}
        />
      )}
    </Paper>
  )
}

import { useEffect, useState } from 'react'
import { Alert, Anchor, Badge, Button, Group, Loader, Paper, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
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
  /** The invoice edit permission, on an invoice that can still change its containers: Unlink. */
  canLink: boolean
  /** containers.create: the three buttons are shown - enabled or not by the invoice's state, with its reason. */
  canAddContainers: boolean
  canOverCapacity: boolean
  canConfirmContainers: boolean
  /** Linking rewrites the invoice's lines: false (and the reader told) while the page holds unsaved changes. */
  ensureSaved: () => boolean
  /** The invoice changed on the server: the page reads it again (lines, row version, totals). */
  onChanged: () => void
  /** "Turn on 'Shipped in containers'": the page saves the draft with the switch on. Absent = the reader cannot edit it. */
  onTurnOnShipped?: () => Promise<void>
}

type Dialog = 'link' | 'add' | 'plan'

const containersLabel = (n: number) => (n === 1 ? '1 container' : `${formatNumber(n)} containers`)

/**
 * The containers of a purchase invoice - on EVERY one (script 47): per item what it needs and what is linked, the
 * containers it is linked to, and the three ways to complete it - link existing containers of the order, add one, or
 * auto-plan. Shipped in containers, its goods enter the stock at the offload of those containers, so pieces "not in a
 * container yet" are the ones the reader still has to place (orange).
 *
 * The buttons are there for every reader who may create containers; the invoice's state (the server's) enables them
 * or says why not - in the tooltip, and in words under the title for a phone. A draft that is not shipped in
 * containers yet offers to turn it on.
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
  onTurnOnShipped,
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

  /* THE STATE IS THE SERVER'S (script 47): whether the invoice can take containers, and the first rule that says no -
     the same sentence the add and the link would refuse with. Nothing is guessed here from the lines or the status. */
  const state = summary?.state ?? null
  const saveFirst = 'Save the invoice first: its containers are linked once "Shipped in containers" is saved.'
  const addBlocked = pendingSwitch ? saveFirst : state === null ? 'Reading the invoice…' : state.canAddContainers ? null : state.reason
  const linkBlocked = pendingSwitch ? saveFirst : state === null ? 'Reading the invoice…' : state.canLink ? null : state.linkReason
  const reasons = [...new Set([addBlocked, linkBlocked].filter((r): r is string => r !== null && state !== null))]
  /* RECEIVED ON POSTING (not shipped in containers): nothing has to be linked, so no "Not linked" warning; a posted one
     says why it never takes containers (rule 4) to every reader, not only to those who see the buttons. */
  const shipped = invoice.receiptMode === 2
  const showReasons =
    reasons.length > 0 && !(state?.canTurnOnShipped && onTurnOnShipped) && (canAddContainers || (!shipped && state?.failedRule === 4))
  const [turningOn, setTurningOn] = useState(false)

  async function turnOn() {
    if (!onTurnOnShipped) return
    const ok = await confirm({
      title: 'Turn on "Shipped in containers"',
      message: 'The goods will enter the stock at the container offload, not when the invoice is posted.',
      confirmLabel: 'Turn on',
    })
    if (!ok) return
    setTurningOn(true)
    try {
      await onTurnOnShipped()
    } finally {
      setTurningOn(false)
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

  const action = (key: Dialog, label: string, icon: React.ReactNode, visible: boolean, blocked: string | null) =>
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
          <Text fz="xs" c="dimmed">
            {shipped
              ? 'Shipped in containers: the goods enter the stock at the offload of these containers.'
              : 'Received when the invoice is posted: no containers needed.'}
          </Text>
        </div>
        <Group gap="xs">
          {action('link', 'Link containers…', <IconLink size={14} />, canAddContainers, linkBlocked)}
          {action('add', 'Add container…', <IconBox size={14} />, canAddContainers, addBlocked)}
          {action('plan', 'Auto-plan…', <IconBoxMultiple size={14} />, canAddContainers, addBlocked)}
        </Group>
      </Group>

      {/* The reason in words as well as in the tooltips: a phone has no hover. */}
      {showReasons ? (
        <Stack gap={2} mb="sm" data-container-reason>
          {reasons.map((reason) => (
            <Text key={reason} fz="sm" c="dimmed">
              {reason}
            </Text>
          ))}
        </Stack>
      ) : null}

      {state?.canTurnOnShipped && onTurnOnShipped && !pendingSwitch ? (
        <Alert color="blue" variant="light" mb="sm" data-turn-on-shipped>
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text fz="sm">The goods of this invoice can travel in containers.</Text>
            <Button size="xs" loading={turningOn} onClick={() => void turnOn()}>
              Turn on 'Shipped in containers'
            </Button>
          </Group>
        </Alert>
      ) : null}

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
                  {shipped ? (
                    <>
                      <Table.Th>Linked</Table.Th>
                      <Table.Th ta="right">Not linked</Table.Th>
                    </>
                  ) : null}
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
                    {shipped ? (
                      <>
                        <Table.Td data-linked>
                          {item.linkedBase === 0 ? <Text fz="sm" c="dimmed">None yet</Text> : `${formatNumber(item.linkedBase)} pcs in ${containersLabel(item.containersLinked)}`}
                        </Table.Td>
                        <Table.Td ta="right" fw={item.unlinkedBase > 0 ? 700 : 400} c={item.unlinkedBase > 0 ? 'orange' : undefined} data-not-linked>
                          {formatNumber(item.unlinkedBase)} pcs
                        </Table.Td>
                      </>
                    ) : null}
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
                        <Table.Td ta="right" data-share-of-container>
                          {c.shareOfContainerPct === null ? (
                            <Tooltip label={`${c.itemCode} has no Container unit (Item Definition)`} withArrow>
                              <Text span fz="sm" c="dimmed">
                                —
                              </Text>
                            </Tooltip>
                          ) : (
                            <Text span fz="sm" c={c.shareOfContainerPct > 100 ? 'red.7' : undefined} fw={c.shareOfContainerPct > 100 ? 700 : undefined}>
                              {formatNumber(c.shareOfContainerPct, 0)} %
                            </Text>
                          )}
                        </Table.Td>
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
          invoice={{
            id: invoice.id,
            documentNumber: invoice.documentNumber,
            rowVersion: invoice.rowVersion,
            maxAddQty: state?.maxAddQty ?? 0,
            notInContainerQty: state?.notInContainerQty ?? 0,
            orderLinesAvailableQty: state?.orderLinesAvailableQty ?? 0,
            items: (summary?.items ?? []).filter((i) => i.unlinkedBase > 0).map((i) => ({ itemId: i.itemId, itemCode: i.itemCode, pcsPerContainer: i.pcsPerContainer })),
          }}
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

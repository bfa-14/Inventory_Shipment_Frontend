import { Fragment, useEffect, useState } from 'react'
import { Alert, Anchor, Badge, Group, Loader, NumberInput, Table, Text } from '@mantine/core'
import { Link } from 'react-router'
import { ApiError } from '../../api/http'
import { containerStatusColour } from '../../api/logistics/containers'
import { invoiceContainersApi, type InvoiceContainerSummaryDto, type InvoiceLinkCandidateDto } from '../../api/purchase/invoiceContainers'
import { formatNumber, numberInputValue } from '../format'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'

interface LinkContainersModalProps {
  invoiceId: number
  rowVersion: string | null
  onClose: () => void
  onLinked: (summary: InvoiceContainerSummaryDto) => void
}

interface Row {
  candidate: InvoiceLinkCandidateDto
  quantity: number | ''
}

/** The most a row can take: what the container line has free, and what the invoice has of that order line outside containers. */
const maxOf = (c: InvoiceLinkCandidateDto) => Math.min(c.availableBase, c.unlinkedBase)

/**
 * "Link containers…": the container lines of the invoice's order that can still take its pieces - Draft or Confirmed
 * containers only (one that started moving is not offered), grouped by container. Every line starts at what is free
 * on it, spread so the invoice's pieces of an order line are not used twice; the server checks it all again.
 */
export function LinkContainersModal({ invoiceId, rowVersion, onClose, onLinked }: LinkContainersModalProps) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    invoiceContainersApi
      .candidates(invoiceId, controller.signal)
      .then((candidates) => {
        // The invoice's pieces of an order line, handed out to its container lines in order.
        const left = new Map<number, number>()
        setRows(
          candidates.map((candidate) => {
            const remaining = left.get(candidate.poLineId) ?? candidate.unlinkedBase
            const take = Math.max(0, Math.min(candidate.availableBase, remaining))
            left.set(candidate.poLineId, remaining - take)
            return { candidate, quantity: take > 0 ? take : '' }
          }),
        )
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoadError(err instanceof ApiError ? err.message : 'The containers could not be loaded.')
      })
    return () => controller.abort()
  }, [invoiceId])

  const picked = (rows ?? []).filter((row) => Number(row.quantity || 0) > 0)

  // Per order line: no more than the invoice has outside containers.
  const usedByOrderLine = new Map<number, number>()
  for (const row of picked) {
    usedByOrderLine.set(row.candidate.poLineId, (usedByOrderLine.get(row.candidate.poLineId) ?? 0) + Number(row.quantity))
  }
  const overUsed = (rows ?? []).find((row) => (usedByOrderLine.get(row.candidate.poLineId) ?? 0) > row.candidate.unlinkedBase)

  async function link() {
    setFormError(null)
    if (picked.length === 0) {
      setFormError('Enter a quantity on at least one container line.')
      return
    }
    const tooMuch = picked.find((row) => Number(row.quantity) > maxOf(row.candidate))
    if (tooMuch) {
      setFormError(`${tooMuch.candidate.containerRef} line ${tooMuch.candidate.containerLineNumber}: at most ${formatNumber(maxOf(tooMuch.candidate))} pieces.`)
      return
    }
    if (overUsed) {
      setFormError(`${overUsed.candidate.itemCode}: only ${formatNumber(overUsed.candidate.unlinkedBase)} pieces of this invoice are not in a container yet.`)
      return
    }

    setSaving(true)
    try {
      const summary = await invoiceContainersApi.link(
        invoiceId,
        rowVersion,
        picked.map((row) => ({ containerLineId: row.candidate.containerLineId, quantityBase: Number(row.quantity) })),
      )
      notify.success('Containers linked to the invoice.')
      onLinked(summary)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'The containers could not be linked.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal opened title="Link containers" onSubmit={() => void link()} onClose={onClose} saving={saving} saveLabel="Link" size="xl" saveDisabled={rows === null || rows.length === 0}>
      {loadError && <Alert color="red" variant="light">{loadError}</Alert>}
      {formError && <Alert color="red" variant="light" mb="sm" data-link-error>{formError}</Alert>}
      {rows === null && !loadError ? (
        <Group justify="center" py="md"><Loader size="sm" /></Group>
      ) : rows && rows.length === 0 ? (
        <Text fz="sm" c="dimmed" ta="center" py="md">
          No container of the order can take this invoice's pieces: only Draft or Confirmed containers with something not yet invoiced are offered.
        </Text>
      ) : rows ? (
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing={4} data-link-candidates>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Item</Table.Th>
                <Table.Th ta="right">Loaded</Table.Th>
                <Table.Th ta="right">Invoiced</Table.Th>
                <Table.Th ta="right">Free</Table.Th>
                <Table.Th w={150}>Link (pcs)</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row, index) => {
                const c = row.candidate
                const newContainer = index === 0 || rows[index - 1].candidate.containerId !== c.containerId
                const qty = Number(row.quantity || 0)
                return (
                  <Fragment key={c.containerLineId}>
                    {newContainer && (
                      <Table.Tr>
                        <Table.Td colSpan={5} bg="var(--mantine-color-gray-0)">
                          <Group gap="xs" wrap="wrap">
                            <Anchor component={Link} to={`/logistics/containers/${c.containerId}`} fw={700} fz="sm" target="_blank">
                              {c.containerRef}
                            </Anchor>
                            {c.containerNo && <Text fz="sm" c="dimmed">{c.containerNo}</Text>}
                            <Badge size="sm" variant="light" color={containerStatusColour(c.containerStatus)}>{c.containerStatusName}</Badge>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    )}
                    <Table.Tr>
                      <Table.Td>
                        <Text fz="sm" fw={500}>{c.itemCode}</Text>
                        <Text fz="xs" c="dimmed" lineClamp={1}>{c.itemName}</Text>
                      </Table.Td>
                      <Table.Td ta="right">{formatNumber(c.loadedBase)}</Table.Td>
                      <Table.Td ta="right">{formatNumber(c.invoicedBase)}</Table.Td>
                      <Table.Td ta="right" fw={600}>{formatNumber(c.availableBase)}</Table.Td>
                      <Table.Td>
                        <NumberInput
                          size="xs"
                          min={0}
                          max={maxOf(c)}
                          allowDecimal={false}
                          allowNegative={false}
                          thousandSeparator=","
                          value={row.quantity}
                          error={qty > maxOf(c) ? `Max ${formatNumber(maxOf(c))}` : undefined}
                          onChange={(next) =>
                            setRows((current) => current?.map((r) => (r.candidate.containerLineId === c.containerLineId ? { ...r, quantity: numberInputValue(next) ?? '' } : r)) ?? null)
                          }
                          aria-label={`Pieces to link from ${c.containerRef} line ${c.containerLineNumber}`}
                          data-link-quantity={c.containerLineId}
                        />
                      </Table.Td>
                    </Table.Tr>
                  </Fragment>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : null}
    </FormModal>
  )
}

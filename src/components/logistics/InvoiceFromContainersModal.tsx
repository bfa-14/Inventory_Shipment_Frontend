import { useEffect, useMemo, useState } from 'react'
import { Alert, Anchor, Badge, Checkbox, Group, Loader, NumberInput, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { Link } from 'react-router'
import { ApiError } from '../../api/http'
import { containersApi, containerStatusColour, containerStatusLabel, type InvoiceCandidateDto } from '../../api/logistics/containers'
import { purchaseDocumentsApi } from '../../api/purchase/documents'
import { fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'

interface InvoiceFromContainersModalProps {
  opened: boolean
  onClose: () => void
  /** The lines of this order's containers… */
  purchaseOrderId?: number
  /** …or of this one container (any order on board: one invoice per order). */
  containerId?: number
  /** The drafts created, one per purchase order; the host opens the first. */
  onCreated: (invoiceIds: number[]) => void
}

interface Pick {
  checked: boolean
  quantity: number | ''
}

/**
 * "Create Invoice from Containers…": the container lines still to invoice, grouped by container,
 * each ticked with its available quantity. Create makes ONE draft purchase invoice per purchase
 * order (an order's lines may sit in several containers; a container may carry several orders),
 * every line pointing to its container line. The server re-checks every quantity (65019 / 65011).
 */
export function InvoiceFromContainersModal({ opened, onClose, purchaseOrderId, containerId, onCreated }: InvoiceFromContainersModalProps) {
  const [rows, setRows] = useState<InvoiceCandidateDto[] | null>(null)
  const [picks, setPicks] = useState<Record<number, Pick>>({})
  const [documentDate, setDocumentDate] = useState<string | null>(isoDate(new Date()))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!opened) return
    // Mounted only while open (the host renders it conditionally), so the state starts empty.
    let live = true
    containersApi
      .invoiceCandidates({ purchaseOrderId, containerId })
      .then((list) => {
        if (!live) return
        setRows(list)
        setPicks(Object.fromEntries(list.map((row) => [row.containerLineId, { checked: row.availableBase > 0, quantity: row.availableBase }])))
      })
      .catch((err: unknown) => live && setError(err instanceof ApiError ? err.message : 'The container lines could not be loaded.'))
    return () => {
      live = false
    }
  }, [opened, purchaseOrderId, containerId])

  const groups = useMemo(() => {
    const byContainer = new Map<number, InvoiceCandidateDto[]>()
    for (const row of rows ?? []) byContainer.set(row.containerId, [...(byContainer.get(row.containerId) ?? []), row])
    return [...byContainer.values()]
  }, [rows])

  const chosen = (rows ?? []).filter((row) => picks[row.containerLineId]?.checked && Number(picks[row.containerLineId]?.quantity || 0) > 0)
  const invalid = chosen.find((row) => Number(picks[row.containerLineId].quantity) > row.availableBase)
  const orderCount = new Set(chosen.map((row) => row.purchaseOrderId)).size

  function patch(containerLineId: number, next: Partial<Pick>) {
    setPicks((all) => ({ ...all, [containerLineId]: { ...all[containerLineId], ...next } }))
  }

  async function create() {
    if (chosen.length === 0 || invalid) return
    setSaving(true)
    setError(null)
    const created: number[] = []
    try {
      for (const orderId of [...new Set(chosen.map((row) => row.purchaseOrderId))]) {
        const lines = chosen
          .filter((row) => row.purchaseOrderId === orderId)
          .map((row) => ({ containerLineId: row.containerLineId, quantityBase: Number(picks[row.containerLineId].quantity) }))
        const { id } = await purchaseDocumentsApi.invoiceFromContainers(orderId, documentDate, lines)
        created.push(id)
      }
      notify.success(created.length === 1 ? 'Draft purchase invoice created.' : `${created.length} draft purchase invoices created (one per order).`)
      onCreated(created)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The invoice could not be created.')
      if (created.length > 0) onCreated(created)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened={opened}
      onClose={onClose}
      title="Create Invoice from Containers"
      size="80rem"
      saving={saving}
      saveLabel={orderCount > 1 ? `Create ${orderCount} invoices` : 'Create invoice'}
      saveDisabled={chosen.length === 0 || Boolean(invalid)}
      onSubmit={() => void create()}
    >
      <Stack gap="md">
        {/* A picker that opens on click, not on focus: the modal puts the cursor in its first field. */}
        <DatePickerInput
          label="Document Date"
          withAsterisk
          valueFormat="DD/MM/YYYY"
          maxDate={new Date()}
          value={fromIsoDate(documentDate)}
          onChange={(next) => setDocumentDate(next ? isoDate(new Date(next)) : null)}
          w={220}
        />
        {error ? <Alert color="red">{error}</Alert> : null}
        {rows === null && !error ? <Loader size="sm" /> : null}
        {rows && rows.length === 0 ? (
          <Text c="dimmed" ta="center" py="md">
            Every loaded line is already in an invoice.
          </Text>
        ) : null}
        {groups.map((group) => {
          const head = group[0]
          return (
            <div key={head.containerId}>
              <Group gap="xs" mb={4} wrap="wrap">
                <Anchor component={Link} to={`/logistics/containers/${head.containerId}`} fw={700} fz="sm">
                  {head.containerRef}
                </Anchor>
                {head.containerNo ? (
                  <Text fz="sm" c="dimmed">
                    {head.containerNo}
                  </Text>
                ) : null}
                <Badge size="sm" variant="light" color={containerStatusColour(head.containerStatus)}>
                  {containerStatusLabel(head.containerStatus)}
                </Badge>
              </Group>
              <ScrollArea type="auto">
                <Table miw={820} verticalSpacing={4} striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={36} />
                      <Table.Th>Item</Table.Th>
                      <Table.Th>Order</Table.Th>
                      <Table.Th ta="right">Loaded</Table.Th>
                      <Table.Th ta="right">Invoiced</Table.Th>
                      <Table.Th ta="right">In drafts</Table.Th>
                      <Table.Th ta="right">Available</Table.Th>
                      <Table.Th w={130}>Quantity (pcs)</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {group.map((row) => {
                      const pick = picks[row.containerLineId] ?? { checked: false, quantity: '' }
                      const qty = Number(pick.quantity || 0)
                      const tooMuch = qty > row.availableBase
                      return (
                        <Table.Tr key={row.containerLineId}>
                          <Table.Td>
                            <Checkbox
                              checked={pick.checked}
                              disabled={row.availableBase <= 0}
                              onChange={(e) => patch(row.containerLineId, { checked: e.currentTarget.checked })}
                              aria-label={`Invoice ${row.itemCode} of ${row.containerRef}`}
                            />
                          </Table.Td>
                          <Table.Td>
                            <Text fz="sm" fw={600}>
                              {row.itemCode}
                            </Text>
                            <Text fz="xs" c="dimmed">
                              {row.itemName}
                            </Text>
                          </Table.Td>
                          <Table.Td>{row.purchaseOrderNumber ?? `#${row.purchaseOrderId}`}</Table.Td>
                          <Table.Td ta="right">{formatNumber(row.loadedBase)}</Table.Td>
                          <Table.Td ta="right">{formatNumber(row.invoicedPostedBase)}</Table.Td>
                          <Table.Td ta="right">{formatNumber(row.invoicedDraftBase)}</Table.Td>
                          <Table.Td ta="right" fw={600}>
                            {formatNumber(row.availableBase)}
                          </Table.Td>
                          <Table.Td>
                            <NumberInput
                              size="xs"
                              min={1}
                              max={row.availableBase}
                              allowDecimal={false}
                              allowNegative={false}
                              thousandSeparator=","
                              disabled={!pick.checked}
                              value={pick.quantity}
                              error={tooMuch ? `Max ${formatNumber(row.availableBase)}` : undefined}
                              onChange={(next) => patch(row.containerLineId, { quantity: numberInputValue(next) ?? '' })}
                              aria-label={`Quantity of ${row.itemCode} in ${row.containerRef}`}
                            />
                          </Table.Td>
                        </Table.Tr>
                      )
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </div>
          )
        })}
      </Stack>
    </FormModal>
  )
}

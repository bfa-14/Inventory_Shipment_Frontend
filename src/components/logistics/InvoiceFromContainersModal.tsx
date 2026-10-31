import { useEffect, useMemo, useState } from 'react'
import { Alert, Anchor, Badge, Checkbox, Group, Loader, NumberInput, ScrollArea, SimpleGrid, Stack, Switch, Table, Text, TextInput } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { Link } from 'react-router'
import { ApiError } from '../../api/http'
import { containersApi, containerStatusColour, containerStatusLabel, type InvoiceCandidateDto } from '../../api/logistics/containers'
import { purchaseDocumentsApi, type CreatedPurchaseInvoiceDto } from '../../api/purchase/documents'
import { distinctInOrder, oneInvoiceLine, onePerItemDescription, onePerItemLine, onePerItemToSend, onePerOrderLine, useOneItemPerInvoice } from '../purchase/onePerItem'
import { fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { FormModal } from '../ui/FormModal'
import { ShownRowsFooter } from '../ui/ShownRows'
import { useShownRows } from '../ui/useShownRows'
import { notify } from '../ui/notify'

interface InvoiceFromContainersModalProps {
  opened: boolean
  onClose: () => void
  /** The lines of this order's containers… */
  purchaseOrderId?: number
  /** …or of this one container (any order on board: one invoice per order). */
  containerId?: number
  /**
   * The drafts created — one per item of each order, or one per order with every item (`onePerItem` false) —
   * and the orders they are of. The host opens the one, or lists the several.
   */
  onCreated: (invoices: CreatedPurchaseInvoiceDto[], orderIds: number[], onePerItem: boolean) => void
}

interface Pick {
  checked: boolean
  quantity: number | ''
}

/**
 * "Create Invoice from Containers…": the container lines still to invoice, grouped by container,
 * each ticked with its available quantity. Create makes ONE draft purchase invoice per ITEM of each
 * purchase order — or, with "One invoice per item" off, one draft per order holding every item (an
 * order's lines may sit in several containers; a container may carry several orders) — every line
 * pointing to its container line, the exporter's reference and the commercial invoice number copied to
 * each. The switch starts from the setting Purchase.OneItemPerInvoice. The server re-checks every
 * quantity (65019 / 65011).
 */
export function InvoiceFromContainersModal({ opened, onClose, purchaseOrderId, containerId, onCreated }: InvoiceFromContainersModalProps) {
  const [rows, setRows] = useState<InvoiceCandidateDto[] | null>(null)
  const [picks, setPicks] = useState<Record<number, Pick>>({})
  const [documentDate, setDocumentDate] = useState<string | null>(isoDate(new Date()))
  const [exporterReference, setExporterReference] = useState('')
  const [commercialInvoiceNo, setCommercialInvoiceNo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /* THE SETTING IS THE DEFAULT, THE SWITCH THE CHOICE: null until the reader flips it, so a setting read late still applies. */
  const setting = useOneItemPerInvoice()
  const [choice, setChoice] = useState<boolean | null>(null)
  const onePerItem = choice ?? setting.value

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
  /* DRAWN 200 CONTAINERS AT A TIME (conventions, "Lists of any length"): an order of 1,250 containers took 8 s to open
     when every block and quantity input was drawn at once. Only the drawing is cut - every line stays ticked and
     counted, so Create still invoices all of them. */
  const shown = useShownRows(groups.length, rows)

  const chosen = (rows ?? []).filter((row) => picks[row.containerLineId]?.checked && Number(picks[row.containerLineId]?.quantity || 0) > 0)
  const invalid = chosen.find((row) => Number(picks[row.containerLineId].quantity) > row.availableBase)
  const orderIds = distinctInOrder(chosen.map((row) => row.purchaseOrderId))
  /* One invoice per item of each order: the item codes in the order of their first ticked line. */
  const invoiceItems = orderIds.flatMap((orderId) =>
    distinctInOrder(chosen.filter((row) => row.purchaseOrderId === orderId).map((row) => row.itemCode)),
  )
  /* How many invoices Create makes: one per item of each order, or one per order. */
  const invoiceCount = onePerItem ? invoiceItems.length : orderIds.length
  const orderNumbers = orderIds.map((orderId) => {
    const row = chosen.find((r) => r.purchaseOrderId === orderId)
    return row?.purchaseOrderNumber ?? `#${orderId}`
  })

  function patch(containerLineId: number, next: Partial<Pick>) {
    setPicks((all) => ({ ...all, [containerLineId]: { ...all[containerLineId], ...next } }))
  }

  async function create() {
    if (chosen.length === 0 || invalid) return
    setSaving(true)
    setError(null)
    const created: CreatedPurchaseInvoiceDto[] = []
    const createdFor: number[] = []
    // Not flipped and the setting not read (still loading, or unreadable): null, and the server applies the setting itself.
    const sent = onePerItemToSend(choice, setting)
    try {
      for (const orderId of orderIds) {
        const lines = chosen
          .filter((row) => row.purchaseOrderId === orderId)
          .map((row) => ({ containerLineId: row.containerLineId, quantityBase: Number(picks[row.containerLineId].quantity) }))
        const answer = await purchaseDocumentsApi.invoiceFromContainers(orderId, documentDate, lines, { exporterReference, commercialInvoiceNo }, sent)
        created.push(...answer.invoices)
        createdFor.push(orderId)
      }
      notify.success(
        created.length === 1
          ? 'Draft purchase invoice created.'
          : `${created.length} draft purchase invoices created, one per ${onePerItem ? 'item' : 'order'}.`,
      )
      onCreated(created, createdFor, onePerItem)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The invoice could not be created.')
      if (created.length > 0) onCreated(created, createdFor, onePerItem)
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
      saveLabel={invoiceCount > 1 ? `Create ${invoiceCount} invoices` : 'Create invoice'}
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
          onChange={(next) => setDocumentDate(next ? isoDate(next) : null)}
          w={220}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" maw={560}>
          <TextInput
            label="Exporter's ref."
            description="copied to every invoice"
            maxLength={50}
            value={exporterReference}
            onChange={(event) => setExporterReference(event.currentTarget.value)}
          />
          <TextInput
            label="Commercial invoice no."
            description="copied to every invoice"
            maxLength={50}
            value={commercialInvoiceNo}
            onChange={(event) => setCommercialInvoiceNo(event.currentTarget.value)}
          />
        </SimpleGrid>
        {error ? <Alert color="red">{error}</Alert> : null}
        {rows === null && !error ? <Loader size="sm" /> : null}
        {rows && rows.length === 0 ? (
          <Text c="dimmed" ta="center" py="md">
            Every loaded line is already in an invoice.
          </Text>
        ) : null}
        {groups.slice(0, shown.limit).map((group) => {
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
        <ShownRowsFooter limit={shown.limit} total={groups.length} noun="containers" more={shown.more} all={shown.all} />
        <Switch
          label="One invoice per item"
          description={onePerItemDescription('Off: one invoice holds every item of an order.', choice, setting)}
          checked={onePerItem}
          disabled={setting.loading && choice === null}
          onChange={(event) => setChoice(event.currentTarget.checked)}
          data-one-per-item-switch
        />
        {invoiceItems.length > 0 ? (
          <Alert color="blue" variant="light" data-one-invoice-per-item={onePerItem}>
            {onePerItem
              ? onePerItemLine(invoiceItems)
              : orderIds.length > 1
                ? onePerOrderLine(orderNumbers)
                : oneInvoiceLine(invoiceItems.length)}
          </Alert>
        ) : null}
      </Stack>
    </FormModal>
  )
}

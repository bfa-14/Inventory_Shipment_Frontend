import { useEffect, useState } from 'react'
import { Alert, Badge, Checkbox, Group, Loader, NumberInput, ScrollArea, SimpleGrid, Stack, Switch, Table, Text, TextInput } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { ApiError } from '../../api/http'
import {
  purchaseDocumentsApi,
  type CreatedPurchaseInvoicesDto,
  type OrderInvoiceCandidateDto,
  type PurchaseDocumentDto,
} from '../../api/purchase/documents'
import { fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { FormModal } from '../ui/FormModal'
import { ShownRowsFooter } from '../ui/ShownRows'
import { useShownRows } from '../ui/useShownRows'
import { distinctInOrder, oneInvoiceLine, onePerItemDescription, onePerItemLine, onePerItemToSend, useOneItemPerInvoice } from './onePerItem'
import { purchaseStatusColour, purchaseStatusLabel } from './purchaseKind'

interface CreateInvoiceFromOrderModalProps {
  /** The order, when the page already holds it; otherwise it is read by id. */
  order?: PurchaseDocumentDto
  orderId: number
  onClose: () => void
  onCreated: (created: CreatedPurchaseInvoicesDto) => void
}

interface Pick {
  checked: boolean
  quantity: number | ''
}

/**
 * "Create Purchase Invoice" on an approved order, THE SAME WAY AS "Create Invoice from Containers…" (script 86, the
 * owner's words): the document date, the exporter's reference and the commercial invoice number once for every invoice,
 * and the order's lines still to invoice (`invoice-candidates`), each ticked with its available quantity - ordered less
 * posted invoices less draft invoices - which the reader may lower, or untick the line. Create makes ONE DRAFT PER ITEM
 * of the ticked lines, or one draft holding every item: "One invoice per item" starts from the setting
 * (Purchase.OneItemPerInvoice) and is chosen for this creation only. The server re-checks every quantity (65011).
 */
export function CreateInvoiceFromOrderModal({ order: given, orderId, onClose, onCreated }: CreateInvoiceFromOrderModalProps) {
  const [order, setOrder] = useState<PurchaseDocumentDto | null>(given ?? null)
  const [rows, setRows] = useState<OrderInvoiceCandidateDto[] | null>(null)
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
    if (given) return
    let live = true
    purchaseDocumentsApi
      .get(orderId)
      .then((loaded) => live && setOrder(loaded))
      .catch((err: unknown) => live && setError(err instanceof ApiError ? err.message : 'The order could not be loaded.'))
    return () => {
      live = false
    }
  }, [given, orderId])

  useEffect(() => {
    // Mounted only while open (the hosts render it conditionally), so the state starts empty.
    let live = true
    purchaseDocumentsApi
      .invoiceCandidates(orderId)
      .then((list) => {
        if (!live) return
        setRows(list)
        setPicks(Object.fromEntries(list.map((row) => [row.lineId, { checked: row.availableBase > 0, quantity: row.availableBase }])))
      })
      .catch((err: unknown) => live && setError(err instanceof ApiError ? err.message : 'The order lines could not be loaded.'))
    return () => {
      live = false
    }
  }, [orderId])

  /* DRAWN 200 LINES AT A TIME (conventions, "Lists of any length"): only the drawing is cut - every line stays ticked
     and counted, so Create still invoices all of them. */
  const shown = useShownRows(rows?.length ?? 0, rows)

  const chosen = (rows ?? []).filter((row) => picks[row.lineId]?.checked && Number(picks[row.lineId]?.quantity || 0) > 0)
  const invalid = chosen.find((row) => Number(picks[row.lineId].quantity) > row.availableBase)
  /* The items of the ticked lines, in the order of their first line: one invoice each, or one invoice for all. */
  const itemCodes = distinctInOrder(chosen.map((row) => row.itemCode))
  const invoiceCount = onePerItem ? itemCodes.length : Math.min(itemCodes.length, 1)

  /* NOTHING LEFT TO INVOICE: a fully invoiced order shows Posted and is never closed (script 77), so the order list can
     still reach this dialog for it. Said here instead of a Create the server would refuse (65011); the lines say what
     is in drafts. */
  const nothingLeft =
    order?.canCreateInvoice === false
      ? 'Everything ordered is already invoiced.'
      : rows === null || rows.length > 0
        ? null
        : order && order.inDraftInvoicesBase > 0
          ? 'The rest of this order is already in draft invoices: post or delete them first.'
          : 'Everything ordered is already invoiced.'

  function patch(lineId: number, next: Partial<Pick>) {
    setPicks((all) => ({ ...all, [lineId]: { ...all[lineId], ...next } }))
  }

  async function create() {
    if (chosen.length === 0 || invalid) return
    setSaving(true)
    setError(null)
    try {
      // Not flipped and the setting not read (still loading, or unreadable): null, and the server applies the setting itself.
      const sent = onePerItemToSend(choice, setting)
      const lines = chosen.map((row) => ({ sourceLineId: row.lineId, quantityBase: Number(picks[row.lineId].quantity) }))
      onCreated(await purchaseDocumentsApi.createInvoice(orderId, documentDate, { exporterReference, commercialInvoiceNo }, sent, lines))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The invoice could not be created.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened
      onClose={onClose}
      title="Create Purchase Invoice"
      size="80rem"
      saving={saving}
      saveLabel={invoiceCount > 1 ? `Create ${invoiceCount} invoices` : 'Create invoice'}
      saveDisabled={order === null || chosen.length === 0 || Boolean(invalid) || nothingLeft !== null}
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
        {(rows === null || order === null) && !error ? <Loader size="sm" /> : null}
        {nothingLeft ? (
          <Alert color="orange" data-nothing-to-invoice>
            {nothingLeft}
          </Alert>
        ) : null}
        {rows && rows.length > 0 && nothingLeft === null ? (
          <div>
            <Group gap="xs" mb={4} wrap="wrap">
              <Text fw={700} fz="sm">
                {order?.documentNumber ?? `Order #${orderId}`}
              </Text>
              {order?.supplierName ? (
                <Text fz="sm" c="dimmed">
                  {order.supplierName}
                </Text>
              ) : null}
              {order ? (
                <Badge size="sm" variant="light" color={purchaseStatusColour(order.status, order.documentTypeCode, order.invoicingStatus)}>
                  {purchaseStatusLabel(order.status, order.documentTypeCode, order.invoicingStatus)}
                </Badge>
              ) : null}
            </Group>
            <ScrollArea type="auto">
              <Table miw={860} verticalSpacing={4} striped data-order-invoice-lines>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={36} />
                    <Table.Th w={36}>#</Table.Th>
                    <Table.Th>Item</Table.Th>
                    <Table.Th>Warehouse</Table.Th>
                    <Table.Th ta="right">Ordered</Table.Th>
                    <Table.Th ta="right">Invoiced</Table.Th>
                    <Table.Th ta="right">In drafts</Table.Th>
                    <Table.Th ta="right">Available</Table.Th>
                    <Table.Th w={130}>Quantity (pcs)</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.slice(0, shown.limit).map((row) => {
                    const pick = picks[row.lineId] ?? { checked: false, quantity: '' }
                    const qty = Number(pick.quantity || 0)
                    const tooMuch = qty > row.availableBase
                    return (
                      <Table.Tr key={row.lineId}>
                        <Table.Td>
                          <Checkbox
                            checked={pick.checked}
                            disabled={row.availableBase <= 0}
                            onChange={(e) => patch(row.lineId, { checked: e.currentTarget.checked })}
                            aria-label={`Invoice line ${row.lineNumber}, ${row.itemCode}`}
                          />
                        </Table.Td>
                        <Table.Td>{row.lineNumber}</Table.Td>
                        <Table.Td>
                          <Text fz="sm" fw={600}>
                            {row.itemCode}
                          </Text>
                          <Text fz="xs" c="dimmed">
                            {row.itemName}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text fz="sm">{row.warehouseCode}</Text>
                          <Text fz="xs" c="dimmed">
                            {row.warehouseName}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right">{formatNumber(row.orderedBase)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(row.invoicedBase)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(row.inDraftsBase)}</Table.Td>
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
                            onChange={(next) => patch(row.lineId, { quantity: numberInputValue(next) ?? '' })}
                            aria-label={`Quantity of line ${row.lineNumber}, ${row.itemCode}`}
                          />
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <ShownRowsFooter limit={shown.limit} total={rows.length} noun="lines" more={shown.more} all={shown.all} />
          </div>
        ) : null}
        <Switch
          label="One invoice per item"
          description={onePerItemDescription('Off: one invoice holds every item.', choice, setting)}
          checked={onePerItem}
          disabled={setting.loading && choice === null}
          onChange={(event) => setChoice(event.currentTarget.checked)}
          data-one-per-item-switch
        />
        {itemCodes.length > 0 && nothingLeft === null ? (
          <Alert color="blue" variant="light" data-one-invoice-per-item={onePerItem}>
            {onePerItem ? onePerItemLine(itemCodes) : oneInvoiceLine(itemCodes.length)}
          </Alert>
        ) : null}
      </Stack>
    </FormModal>
  )
}

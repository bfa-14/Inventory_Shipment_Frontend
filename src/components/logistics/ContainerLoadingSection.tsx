import { useEffect, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconLink, IconLinkOff, IconPlus, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, type AvailableInvoiceLineDto } from '../../api/logistics/containers'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'
import { fromInvoiceLine, lineBase, lineOil, type LinkedInvoice, type LoadLine } from './containerForm'

interface ContainerLoadingSectionProps {
  containerId: number | null
  invoices: LinkedInvoice[]
  lines: LoadLine[]
  readOnly: boolean
  onLinkInvoice: () => void
  onUnlinkInvoice: (purchaseDocumentId: number) => void
  onLinesChange: (lines: LoadLine[]) => void
  /** Line numbers the server refused ("Line 2: ..."), highlighted with the message. */
  lineErrors: Record<number, string>
  /** The invoice whose items are listed; the page moves it to an invoice as it is linked. */
  selectedInvoiceId: number | null
  onSelectInvoice: (purchaseDocumentId: number) => void
}

interface Draft {
  quantity: number | ''
  oilIncluded: boolean
  oilQtyPerUnit: number | ''
}

/**
 * Section 5: what the container carries. An invoice is linked first, its lines are listed with what
 * other containers already hold of each, and the chosen quantities go into "Linked items in this
 * container" below — the list that is saved. The ceiling of every line is what is left on the
 * invoice line after the OTHER containers; the server checks it again (ALLOCATION_EXCEEDS_INVOICE).
 */
export function ContainerLoadingSection({
  containerId,
  invoices,
  lines,
  readOnly,
  onLinkInvoice,
  onUnlinkInvoice,
  onLinesChange,
  lineErrors,
  selectedInvoiceId,
  onSelectInvoice,
}: ContainerLoadingSectionProps) {
  const [invoiceLines, setInvoiceLines] = useState<Record<number, AvailableInvoiceLineDto[]>>({})
  const [loadErrors, setLoadErrors] = useState<Record<number, string>>({})
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})

  // An unlinked invoice hands over to the last one left.
  const current = invoices.find((i) => i.purchaseDocumentId === selectedInvoiceId) ?? invoices[invoices.length - 1] ?? null
  const currentId = current?.purchaseDocumentId ?? null

  useEffect(() => {
    if (currentId === null || readOnly) return
    let live = true
    containersApi
      .invoiceLines(currentId, containerId ?? undefined)
      .then((result) => {
        if (!live) return
        setInvoiceLines((all) => ({ ...all, [currentId]: result }))
        setLoadErrors((all) => {
          const { [currentId]: _gone, ...rest } = all
          return rest
        })
      })
      .catch((err: unknown) => {
        if (live) setLoadErrors((all) => ({ ...all, [currentId]: err instanceof ApiError ? err.message : 'The invoice lines could not be loaded.' }))
      })
    return () => {
      live = false
    }
  }, [currentId, containerId, readOnly])

  const loadedBase = (purchaseLineId: number) =>
    lines.filter((l) => l.purchaseLineId === purchaseLineId).reduce((sum, l) => sum + lineBase(l), 0)

  function draftOf(row: AvailableInvoiceLineDto): Draft {
    return (
      drafts[row.purchaseLineId] ?? {
        quantity: '',
        oilIncluded: row.oilQtyPerUnit !== null && row.oilQtyPerUnit > 0,
        oilQtyPerUnit: row.oilQtyPerUnit ?? '',
      }
    )
  }

  function setDraft(row: AvailableInvoiceLineDto, patch: Partial<Draft>) {
    setDrafts((all) => ({ ...all, [row.purchaseLineId]: { ...draftOf(row), ...patch } }))
  }

  function add(row: AvailableInvoiceLineDto) {
    if (!current) return
    const draft = draftOf(row)
    const quantity = Number(draft.quantity)
    if (!quantity) return
    const oilQty = draft.oilQtyPerUnit === '' ? null : Number(draft.oilQtyPerUnit)
    const existing = lines.find((l) => l.purchaseLineId === row.purchaseLineId)
    const next = existing
      ? lines.map((l) =>
          l.purchaseLineId === row.purchaseLineId
            ? { ...l, quantity: l.quantity + quantity, oilIncluded: draft.oilIncluded, oilQtyPerUnit: draft.oilIncluded ? oilQty : null }
            : l,
        )
      : [...lines, fromInvoiceLine(row, current, quantity, draft.oilIncluded, oilQty)]
    onLinesChange(next)
    setDrafts((all) => ({ ...all, [row.purchaseLineId]: { ...draft, quantity: '' } }))
  }

  function updateLine(key: string, patch: Partial<LoadLine>) {
    onLinesChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  const rows = currentId === null ? [] : invoiceLines[currentId]
  const loadError = currentId === null ? null : (loadErrors[currentId] ?? null)
  const received = lines.some((l) => l.receivedQuantityBase !== null)

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={5}>5. Purchase invoices and items</Title>
        {!readOnly ? (
          <Button size="xs" leftSection={<IconLink size={14} />} onClick={onLinkInvoice}>
            Link Purchase Invoice
          </Button>
        ) : null}
      </Group>

      {invoices.length === 0 ? (
        <Text c="dimmed" fz="sm" ta="center" py="md">
          No purchase invoice linked yet. {readOnly ? '' : 'Link one to load its items into the container.'}
        </Text>
      ) : (
        <ScrollArea type="auto" mb="md">
          <Table miw={760} verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>PI No.</Table.Th>
                <Table.Th>PI Date</Table.Th>
                <Table.Th>Supplier</Table.Th>
                <Table.Th>Commercial Invoice No.</Table.Th>
                <Table.Th>Exporter Ref.</Table.Th>
                <Table.Th ta="right">Loaded here</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {invoices.map((invoice) => {
                const here = lines.filter((l) => l.purchaseDocumentId === invoice.purchaseDocumentId)
                return (
                  <Table.Tr key={invoice.purchaseDocumentId}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <Text fz="sm" fw={600}>{invoice.documentNumber ?? `Draft #${invoice.purchaseDocumentId}`}</Text>
                        {invoice.invoiceStatus === 1 ? <Badge size="xs" color="gray" variant="light">Draft</Badge> : null}
                      </Group>
                    </Table.Td>
                    <Table.Td>{dateLabel(invoice.documentDate)}</Table.Td>
                    <Table.Td>{invoice.supplierName}</Table.Td>
                    <Table.Td>{invoice.commercialInvoiceNo ?? '—'}</Table.Td>
                    <Table.Td>{invoice.exporterReference ?? '—'}</Table.Td>
                    <Table.Td ta="right">{formatNumber(here.reduce((s, l) => s + lineBase(l), 0))}</Table.Td>
                    <Table.Td ta="right">
                      {!readOnly ? (
                        <Tooltip label={here.length ? 'Remove its items first' : 'Unlink'} withArrow>
                          <span>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              disabled={here.length > 0}
                              aria-label={`Unlink ${invoice.documentNumber ?? invoice.purchaseDocumentId}`}
                              onClick={() => onUnlinkInvoice(invoice.purchaseDocumentId)}
                            >
                              <IconLinkOff size={16} />
                            </ActionIcon>
                          </span>
                        </Tooltip>
                      ) : null}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      {!readOnly && current ? (
        <>
          <Group justify="space-between" mb="xs" wrap="wrap">
            <Text fw={600} fz="sm">
              Items of the invoice
            </Text>
            {invoices.length > 1 ? (
              <SegmentedControl
                size="xs"
                value={String(current.purchaseDocumentId)}
                onChange={(value) => onSelectInvoice(Number(value))}
                data={invoices.map((i) => ({
                  value: String(i.purchaseDocumentId),
                  label: i.documentNumber ?? `Draft #${i.purchaseDocumentId}`,
                }))}
              />
            ) : null}
          </Group>
          {loadError ? <Alert color="red" mb="sm">{loadError}</Alert> : null}
          {rows === undefined && !loadError ? <Loader size="sm" mb="sm" /> : null}
          {rows ? (
            <ScrollArea type="auto" mb="md">
              <Table miw={1180} verticalSpacing={4} striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Item Code</Table.Th>
                    <Table.Th>Model</Table.Th>
                    <Table.Th ta="right">PI Qty</Table.Th>
                    <Table.Th ta="right">Already Allocated</Table.Th>
                    <Table.Th ta="right">Available</Table.Th>
                    <Table.Th ta="right">Max for Container</Table.Th>
                    <Table.Th w={120}>Container Qty</Table.Th>
                    <Table.Th>Unit</Table.Th>
                    <Table.Th>Oil Included</Table.Th>
                    <Table.Th w={110}>Oil Qty/Unit</Table.Th>
                    <Table.Th ta="right">Total Oil</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((row) => {
                    const draft = draftOf(row)
                    const availableBase = row.availableBase - loadedBase(row.purchaseLineId)
                    const maxQty = Math.max(0, Math.floor(availableBase / row.packingFormula))
                    const qty = Number(draft.quantity || 0)
                    const tooMuch = qty > maxQty
                    return (
                      <Table.Tr key={row.purchaseLineId}>
                        <Table.Td>
                          <Text fz="sm" fw={600}>{row.itemCode}</Text>
                          <Text fz="xs" c="dimmed">{row.itemName}</Text>
                        </Table.Td>
                        <Table.Td>{row.model ?? '—'}</Table.Td>
                        <Table.Td ta="right">{formatNumber(row.quantityBase)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(row.allocatedElsewhereBase + loadedBase(row.purchaseLineId))}</Table.Td>
                        <Table.Td ta="right">{formatNumber(availableBase)}</Table.Td>
                        <Table.Td ta="right" fw={600}>{formatNumber(maxQty)}</Table.Td>
                        <Table.Td>
                          <NumberInput
                            size="xs"
                            min={1}
                            max={maxQty}
                            allowDecimal={false}
                            thousandSeparator=","
                            disabled={maxQty === 0}
                            value={draft.quantity}
                            error={tooMuch ? `Max ${formatNumber(maxQty)}` : undefined}
                            onChange={(value) => setDraft(row, { quantity: value === '' ? '' : Number(value) })}
                            aria-label={`Container quantity for ${row.itemCode}`}
                          />
                        </Table.Td>
                        <Table.Td>{row.packingFormula > 1 ? `${row.unitTypeName} (x${row.packingFormula})` : row.unitTypeName}</Table.Td>
                        <Table.Td>
                          <Checkbox
                            checked={draft.oilIncluded}
                            onChange={(e) => setDraft(row, { oilIncluded: e.currentTarget.checked })}
                            aria-label={`Oil included for ${row.itemCode}`}
                          />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput
                            size="xs"
                            min={0}
                            decimalScale={2}
                            disabled={!draft.oilIncluded}
                            value={draft.oilQtyPerUnit}
                            onChange={(value) => setDraft(row, { oilQtyPerUnit: value === '' ? '' : Number(value) })}
                            aria-label={`Oil per unit for ${row.itemCode}`}
                          />
                        </Table.Td>
                        <Table.Td ta="right">
                          {draft.oilIncluded ? formatNumber(qty * Number(draft.oilQtyPerUnit || 0), 2) : '—'}
                        </Table.Td>
                        <Table.Td>
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconPlus size={14} />}
                            disabled={!qty || tooMuch}
                            onClick={() => add(row)}
                          >
                            Add
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          ) : null}
        </>
      ) : null}

      <Text fw={600} fz="sm" mb="xs">
        Linked items in this container
      </Text>
      {lines.length === 0 ? (
        <Text c="dimmed" fz="sm" ta="center" py="md">
          No items loaded yet.
        </Text>
      ) : (
        <ScrollArea type="auto">
          <Table miw={1100} verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>PI No.</Table.Th>
                <Table.Th>Item</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th w={120}>Qty</Table.Th>
                <Table.Th>Unit</Table.Th>
                <Table.Th ta="right">Base units</Table.Th>
                <Table.Th>Oil</Table.Th>
                <Table.Th w={110}>Oil Qty/Unit</Table.Th>
                <Table.Th ta="right">Total Oil</Table.Th>
                {received ? <Table.Th ta="right">Received</Table.Th> : null}
                {received ? <Table.Th>Variance reason</Table.Th> : null}
                {!readOnly ? <Table.Th /> : null}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line, index) => {
                const maxQty = Math.floor(line.maxBase / line.packingFormula)
                const error = lineErrors[index + 1]
                const short = line.receivedQuantityBase !== null && line.receivedQuantityBase < lineBase(line)
                return (
                  <Table.Tr key={line.key} bg={error ? 'var(--mantine-color-red-0)' : undefined}>
                    <Table.Td>
                      {error ? (
                        <Tooltip label={error} multiline w={320} withArrow>
                          <Text fz="sm" c="red" fw={700}>{index + 1}</Text>
                        </Tooltip>
                      ) : (
                        index + 1
                      )}
                    </Table.Td>
                    <Table.Td>{line.invoiceNumber ?? '—'}</Table.Td>
                    <Table.Td>
                      <Text fz="sm" fw={600}>{line.itemCode}</Text>
                      <Text fz="xs" c="dimmed">{line.itemName}</Text>
                    </Table.Td>
                    <Table.Td>{line.model ?? '—'}</Table.Td>
                    <Table.Td>
                      {readOnly ? (
                        formatNumber(line.quantity)
                      ) : (
                        <NumberInput
                          size="xs"
                          min={1}
                          max={maxQty}
                          allowDecimal={false}
                          thousandSeparator=","
                          // Empty while retyping (0 in state): snapping to 1 would glue the next digits onto it.
                          value={line.quantity || ''}
                          error={line.quantity < 1 ? 'Required' : line.quantity > maxQty ? `Max ${formatNumber(maxQty)}` : undefined}
                          onChange={(value) => updateLine(line.key, { quantity: value === '' ? 0 : Number(value) })}
                          aria-label={`Quantity of ${line.itemCode}`}
                        />
                      )}
                    </Table.Td>
                    <Table.Td>{line.packingFormula > 1 ? `${line.unitTypeName} (x${line.packingFormula})` : line.unitTypeName}</Table.Td>
                    <Table.Td ta="right">{formatNumber(lineBase(line))}</Table.Td>
                    <Table.Td>
                      {readOnly ? (
                        line.oilIncluded ? 'Yes' : 'No'
                      ) : (
                        <Checkbox
                          checked={line.oilIncluded}
                          onChange={(e) => updateLine(line.key, { oilIncluded: e.currentTarget.checked })}
                          aria-label={`Oil included for ${line.itemCode}`}
                        />
                      )}
                    </Table.Td>
                    <Table.Td>
                      {readOnly ? (
                        formatNumber(line.oilQtyPerUnit, 2)
                      ) : (
                        <NumberInput
                          size="xs"
                          min={0}
                          decimalScale={2}
                          disabled={!line.oilIncluded}
                          value={line.oilQtyPerUnit ?? ''}
                          onChange={(value) => updateLine(line.key, { oilQtyPerUnit: value === '' ? null : Number(value) })}
                          aria-label={`Oil per unit for ${line.itemCode}`}
                        />
                      )}
                    </Table.Td>
                    <Table.Td ta="right">{line.oilIncluded ? formatNumber(lineOil(line), 2) : '—'}</Table.Td>
                    {received ? (
                      <Table.Td ta="right" c={short ? 'orange' : undefined} fw={short ? 700 : undefined}>
                        {formatNumber(line.receivedQuantityBase)}
                      </Table.Td>
                    ) : null}
                    {received ? <Table.Td>{line.varianceReason ?? '—'}</Table.Td> : null}
                    {!readOnly ? (
                      <Table.Td>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Remove ${line.itemCode}`}
                          onClick={() => onLinesChange(lines.filter((l) => l.key !== line.key))}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Table.Td>
                    ) : null}
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

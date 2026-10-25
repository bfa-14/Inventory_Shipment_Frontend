import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { ApiError } from '../../../api/http'
import { warehousesApi } from '../../../api/masterdata/warehouses'
import { goodsReceiptsApi, type GoodsReceiptCreatedDto, type ReceivableLineDto } from '../../../api/purchase/goodsReceipts'
import type { WarehouseLookupDto } from '../../../api/types'
import { useAuth } from '../../../auth/useAuth'
import { noAccessSentence } from '../../../auth/warehouseAccess'
import { refreshGoodsReceiptsWaiting } from '../../../hooks/useGoodsReceiptsWaiting'
import { PERMISSIONS } from '../../../navigation'
import { routes } from '../../../routes'
import { fromIsoDate, isoDate } from '../../documents/documentKind'
import { formatNumber, numberInputValue } from '../../format'
import { notify } from '../../ui/notify'
import { useDocumentTypes } from '../../../hooks/useDocumentTypes'
import { CONTAINERS_HINT, orderPriceHint, warehouseChoices } from './goodsReceiptModel'
import { notYoursNote } from '../../documents/lineWarehouses'

/** What is being received: an approved purchase order, or a posted purchase invoice. */
export interface ReceiveGoodsSource {
  kind: 'order' | 'invoice'
  id: number
  /** The order's or the invoice's number: the dialog is "Receive goods - {document no.}". */
  documentNumber: string | null
}

export interface ReceiveGoodsModalProps {
  opened: boolean
  /** Null while closed. */
  source: ReceiveGoodsSource | null
  onClose(): void
  /** Once the receipt exists (posted or not), before it opens: a host refreshes its own figures here. */
  onCreated?(created: GoodsReceiptCreatedDto): void
  /** False keeps the reader on the host page; by default the new receipt opens. */
  openReceipt?: boolean
}

/** The orange Alert of an order in containers / a shipped-in-containers invoice: everything starts at 0. */
const SHIPPED_ALERT = {
  order:
    'This order is shipped in containers: its goods are received with their containers. Receive pieces here only if they arrived without a container.',
  invoice:
    'This invoice is shipped in containers: its goods are received with their containers. Receive pieces here only if they arrived without a container.',
} as const

/** What the dialog says when nothing is left (the SQL's own sentences, rule 3.1 #13 / #14). */
const NOTHING_LEFT = {
  order: 'Nothing is left to receive on this order.',
  invoice: 'Every piece of this invoice is already received.',
} as const

/**
 * Why an order has nothing to receive here - rule 14's sentences, the ones the order page's disabled "Receive goods…"
 * gives (`receiveBlockedReason`), worked out from the order's own totals in the answer. The order list's row action and
 * every other way in then say the same thing instead of a grid of zeros the server would refuse (63011).
 */
function orderBlockedReason(order: { toReceiveBase: number; maxOutsideBase: number; inContainersBase: number } | undefined): string | null {
  if (!order || order.toReceiveBase > 0 || order.maxOutsideBase > 0) return null
  return order.inContainersBase > 0
    ? 'Everything still to receive travels in containers: it is received with its containers.'
    : 'Everything ordered is already received.'
}

interface RowState {
  receiveNow: number
  closeShort: boolean
  reason: string
  warehouseId: string | null
}

const keyOf = (line: ReceivableLineDto) => `${line.poLineId ?? ''}:${line.invoiceLineId ?? ''}:${line.lineNumber}`

/**
 * (92) A ROW WHOSE OWN WAREHOUSE IS NOT THE READER'S starts in the reader's only usable warehouse when they have exactly
 * one, else empty ("choose the warehouse…"): the receipt would be refused there (W9). Idempotent, so it runs both when
 * the lines arrive and when the warehouses do, whichever comes last; for an unrestricted reader it changes nothing.
 */
function startInYours(rows: Record<string, RowState>, warehouses: WarehouseLookupDto[] | null): Record<string, RowState> {
  if (warehouses === null) return rows
  const notYours = new Set(warehouses.filter((w) => w.canUse === false).map((w) => w.id))
  if (notYours.size === 0) return rows
  const usable = warehouses.filter((w) => w.isActive && w.childCount === 0 && !w.isTransit && w.canUse !== false)
  const only = usable.length === 1 ? String(usable[0].id) : null
  let changed = false
  const next = Object.fromEntries(
    Object.entries(rows).map(([key, row]) => {
      if (row.warehouseId === null || !notYours.has(Number(row.warehouseId))) return [key, row]
      changed = true
      return [key, { ...row, warehouseId: only }]
    }),
  )
  return changed ? next : rows
}

/**
 * "Receive goods - {document no.}": the goods of a purchase order or of a posted purchase invoice that arrived WITHOUT a
 * container, received into the stock (rules 14 and 15).
 *
 * EVERY LINE IS PROPOSED, with what was ordered (or invoiced), received, settled short, in containers and in draft
 * receipts, and what is left to receive. "Receive now" starts at the rest - or at 0 on an order in containers and on a
 * shipped-in-containers invoice, whose goods normally come with their containers: typing a figure there is a decision,
 * never a default. "Nothing more will come" (with its reason) settles the rest of an order line.
 *
 * THE SERVER DECIDES THE LIMITS. What can still be received outside containers, and whether a line may be settled, are
 * checked when the receipt is posted, and the refusal is shown as it comes.
 *
 * Shared by the purchase order page, the invoice page and "+ New › From a purchase order…" on the Goods Receipts list.
 */
export function ReceiveGoodsModal({ opened, source, onClose, onCreated, openReceipt = true }: ReceiveGoodsModalProps) {
  const fullScreen = useMediaQuery('(max-width: 768px)')
  const [busy, setBusy] = useState(false)

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={`Receive goods - ${source?.documentNumber ?? (source ? `#${source.id}` : '')}`}
      size={1280}
      fullScreen={fullScreen}
      centered={!fullScreen}
      closeOnClickOutside={!busy}
    >
      {opened && source ? (
        <ReceiveGoodsBody source={source} onClose={onClose} onCreated={onCreated} openReceipt={openReceipt} busy={busy} setBusy={setBusy} />
      ) : null}
    </Modal>
  )
}

function ReceiveGoodsBody({
  source,
  onClose,
  onCreated,
  openReceipt,
  busy,
  setBusy,
}: {
  source: ReceiveGoodsSource
  onClose(): void
  onCreated?(created: GoodsReceiptCreatedDto): void
  openReceipt: boolean
  busy: boolean
  setBusy(busy: boolean): void
}) {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canPost = hasPermission(PERMISSIONS.goodsReceiptsPost)
  const invoiceType = useDocumentTypes().byCode('PINV')
  const phone = useMediaQuery('(max-width: 48em)')

  const [lines, setLines] = useState<ReceivableLineDto[] | null>(null)
  /** The order's or invoice's branch: its warehouses come first in the pickers. */
  const [documentBranchId, setDocumentBranchId] = useState<number | null>(null)
  /** The order has containers / the invoice is "Shipped in containers": the server says it on the document. */
  const [shipped, setShipped] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** An order with nothing left to receive outside containers: the sentence replaces the lines. */
  const [blocked, setBlocked] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [documentDate, setDocumentDate] = useState<string | null>(isoDate(new Date()))
  const [deliveryNote, setDeliveryNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({})
  /** The warehouse lookup once it is in: the lines may arrive before or after it (startInYours runs on both). */
  const warehousesRef = useRef<WarehouseLookupDto[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    goodsReceiptsApi
      .receivable(source.kind === 'order' ? { purchaseOrderId: source.id } : { invoiceId: source.id }, controller.signal)
      .then((result) => {
        setLines(result.lines)
        setDocumentBranchId(result.documents[0]?.branchId ?? null)
        setShipped(result.documents.some((d) => d.shippedInContainers))
        setBlocked(source.kind === 'order' ? orderBlockedReason(result.documents[0]) : null)
        // Receive now starts where the server says: the rest, or 0 where the goods travel in containers (rules 14, 15).
        // (92) A line whose warehouse is not the reader's starts in their only one, else empty (startInYours).
        const seeded: Record<string, RowState> = Object.fromEntries(
          result.lines.map((line) => [
            keyOf(line),
            {
              receiveNow: Math.max(0, line.defaultReceiveBase),
              closeShort: false,
              reason: '',
              warehouseId: line.warehouseId === null ? null : String(line.warehouseId),
            },
          ]),
        )
        setRows(startInYours(seeded, warehousesRef.current))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(err instanceof ApiError ? err.message : 'The lines to receive could not be loaded.')
      })
    return () => controller.abort()
  }, [source.kind, source.id])

  useEffect(() => {
    warehousesApi
      .lookup(true)
      .then((list) => {
        warehousesRef.current = list
        setWarehouses(list)
        setRows((current) => startInYours(current, list))
      })
      .catch(() => {
        /* the warehouse cells then offer only the lines' own warehouses; the server still checks */
      })
  }, [])

  const keep = useMemo(
    () => (lines ?? []).map((l) => ({ id: l.warehouseId, code: l.warehouseCode, name: l.warehouseName })),
    [lines],
  )
  /* Leaves of every branch, the document's branch first (scripts 70, 72): a warehouse with warehouses under it holds no
     stock. A line's own warehouse stays listed, marked, when it is not one any more (an order saved before). (92) Only
     the warehouses the reader may use; a line's own one they may not use stays listed, marked "- not one of your
     warehouses". */
  const warehouseData = useMemo(
    () => warehouseChoices(warehouses, null, keep, documentBranchId, true),
    [warehouses, keep, documentBranchId],
  )


  const quantityTitle = source.kind === 'order' ? 'Ordered' : 'Invoiced'

  const totals = useMemo(() => {
    let toReceive = 0
    let now = 0
    for (const line of lines ?? []) {
      toReceive += line.toReceiveBase
      now += rows[keyOf(line)]?.receiveNow ?? 0
    }
    return { toReceive, now }
  }, [lines, rows])

  function patch(key: string, change: Partial<RowState>) {
    setError(null)
    setLineErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setRows((current) => ({ ...current, [key]: { ...current[key], ...change } }))
  }

  /** What saves a round trip; the limits are the server's (63011, 63009). */
  function validate(): boolean {
    if (!lines) return false
    if (!documentDate) {
      setError('Choose the date received.')
      return false
    }
    const problems: Record<string, string> = {}
    let any = false
    lines.forEach((line, index) => {
      const row = rows[keyOf(line)]
      if (!row) return
      const label = `Line ${index + 1} (${line.itemCode})`
      if (row.receiveNow > 0 || row.closeShort) any = true
      if (row.receiveNow > 0 && !row.warehouseId) problems[keyOf(line)] = `${label}: choose the warehouse the goods are received into.`
      // (92) A warehouse the reader may not use (a line's own one, kept and marked): said before the server refuses it
      // with the same words (W8).
      const chosenWarehouse = row.warehouseId === null ? undefined : warehouses.find((w) => String(w.id) === row.warehouseId)
      if ((row.receiveNow > 0 || row.closeShort) && chosenWarehouse?.canUse === false)
        problems[keyOf(line)] = `${label}: ${noAccessSentence(chosenWarehouse.warehouseCode)}`
      if (row.closeShort && !row.reason.trim()) problems[keyOf(line)] = `${label}: give the reason nothing more will come.`
    })
    setLineErrors(problems)
    const first = Object.values(problems)[0]
    if (first) {
      setError(first)
      return false
    }
    if (!any) {
      setError('Enter the pieces received on at least one line.')
      return false
    }
    return true
  }

  async function create(post: boolean) {
    if (!lines || !validate()) return
    setBusy(true)
    setError(null)
    const chosen = lines
      .map((line) => ({ line, row: rows[keyOf(line)] }))
      .filter(({ row }) => row && (row.receiveNow > 0 || row.closeShort))
    try {
      const common = {
        documentDate,
        supplierReference: deliveryNote.trim() || null,
        post,
      }
      const created =
        source.kind === 'order'
          ? await goodsReceiptsApi.fromOrder({
              ...common,
              purchaseOrderId: source.id,
              lines: chosen
                .filter(({ line }) => line.poLineId !== null)
                .map(({ line, row }) => ({
                  poLineId: line.poLineId!,
                  quantityBase: row.receiveNow,
                  warehouseId: row.warehouseId === null ? null : Number(row.warehouseId),
                  closeShort: row.closeShort,
                  reason: row.closeShort ? row.reason.trim() || null : null,
                })),
            })
          : await goodsReceiptsApi.fromInvoice({
              ...common,
              invoiceId: source.id,
              lines: chosen
                .filter(({ line }) => line.invoiceLineId !== null)
                .map(({ line, row }) => ({
                  invoiceLineId: line.invoiceLineId!,
                  quantityBase: row.receiveNow,
                  warehouseId: row.warehouseId === null ? null : Number(row.warehouseId),
                  closeShort: row.closeShort,
                  reason: row.closeShort ? row.reason.trim() || null : null,
                })),
            })

      if (created.status === 2) {
        notify.success(`Posted: ${created.documentNumber ?? ''}`.trim())
      } else if (created.postRefusal) {
        // Posting was asked for and refused: the draft stays, and the server says why.
        notify.warning(created.message || `Draft goods receipt created; it was not posted: ${created.postRefusal.message}`)
      } else {
        notify.success('Draft goods receipt created')
      }
      void refreshGoodsReceiptsWaiting()
      onCreated?.(created)
      setBusy(false)
      onClose()
      // A reader who may create receipts but not view them stays on the host page: the notification is enough.
      if (openReceipt && hasPermission(PERMISSIONS.goodsReceiptsView)) void navigate(routes.goodsReceipt(created.id))
    } catch (err) {
      setBusy(false)
      setError(err instanceof ApiError ? err.message : 'The goods receipt could not be created.')
    }
  }

  const quantityOf = (line: ReceivableLineDto) => (source.kind === 'order' ? line.orderedBase : line.invoicedBase)

  function itemCell(line: ReceivableLineDto) {
    return (
      <>
        <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
          {line.itemCode}
        </Text>
        <Text fz="xs" c="dimmed">
          {line.itemName}
        </Text>
        {source.kind === 'invoice' && line.orderNumber ? (
          <Text fz="xs" c="dimmed">
            Order {line.orderNumber}
          </Text>
        ) : null}
      </>
    )
  }

  function receiveNowInput(line: ReceivableLineDto, row: RowState) {
    const key = keyOf(line)
    const above = row.receiveNow > line.toReceiveBase
    return (
      <NumberInput
        aria-label={`Receive now, ${line.itemCode}`}
        value={row.receiveNow}
        onChange={(next) => patch(key, { receiveNow: Math.max(0, Math.trunc(numberInputValue(next) ?? 0)) })}
        min={0}
        allowDecimal={false}
        allowNegative={false}
        thousandSeparator=","
        suffix=" pcs"
        size="xs"
        disabled={busy}
        description={above ? 'More than to receive' : undefined}
        styles={above ? { description: { color: 'var(--mantine-color-orange-7)' } } : undefined}
      />
    )
  }

  /** "Nothing more will come", and its reason once ticked (required). */
  function closeShortCell(line: ReceivableLineDto, row: RowState) {
    const key = keyOf(line)
    return (
      <Stack gap={4}>
        <Checkbox
          aria-label={`Nothing more will come, ${line.itemCode}`}
          checked={row.closeShort}
          onChange={(event) => patch(key, { closeShort: event.currentTarget.checked })}
          disabled={busy}
        />
        {row.closeShort && (
          <TextInput
            aria-label={`Why nothing more will come, ${line.itemCode}`}
            placeholder="Reason (required)"
            size="xs"
            value={row.reason}
            onChange={(event) => patch(key, { reason: event.currentTarget.value })}
            maxLength={300}
            disabled={busy}
            error={lineErrors[key] && !row.reason.trim() ? true : undefined}
          />
        )}
      </Stack>
    )
  }

  function warehouseSelect(line: ReceivableLineDto, row: RowState) {
    const key = keyOf(line)
    return (
      <Select
        aria-label={`Warehouse, ${line.itemCode}`}
        placeholder="Choose"
        data={warehouseData}
        value={row.warehouseId}
        onChange={(next) => patch(key, { warehouseId: next })}
        searchable
        size="xs"
        nothingFoundMessage="No warehouse matches"
        disabled={busy}
        error={notYoursNote(warehouseData, row.warehouseId) ?? (lineErrors[key] && !row.warehouseId ? true : undefined)}
        comboboxProps={{ withinPortal: true }}
      />
    )
  }

  if (loadError) {
    return (
      <Stack>
        <Alert color="red">{loadError}</Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    )
  }

  if (!lines) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  const nothingText = blocked ?? (lines.length === 0 ? NOTHING_LEFT[source.kind] : null)
  const nothing = nothingText !== null

  return (
    <Stack>
      {shipped && !blocked && (
        <Alert color="orange" data-shipped-alert>
          {SHIPPED_ALERT[source.kind]}
        </Alert>
      )}

      <Group align="flex-end" wrap="wrap" gap="md">
        <DateInput
          label="Date received"
          withAsterisk
          valueFormat="DD/MM/YYYY"
          value={fromIsoDate(documentDate)}
          // A DateInput hands over 'YYYY-MM-DD' (typed or picked): kept as it comes, never through new Date().
          onChange={(next) => {
            setError(null)
            setDocumentDate(next ? isoDate(next) : null)
          }}
          maxDate={new Date()}
          w={{ base: '100%', xs: 180 }}
          disabled={busy}
        />
        <TextInput
          label="Delivery note no."
          placeholder="The supplier's delivery note"
          value={deliveryNote}
          onChange={(event) => setDeliveryNote(event.currentTarget.value)}
          maxLength={100}
          w={{ base: '100%', xs: 260 }}
          disabled={busy}
        />
      </Group>

      {nothing ? (
        <Text c="dimmed" size="sm" py="md" ta="center" data-nothing-to-receive>
          {nothingText}
        </Text>
      ) : phone ? (
        /* A phone: one card per line - what is left and what is received now first, the other figures in one line. */
        <Stack gap="sm">
          {lines.map((line) => {
            const key = keyOf(line)
            const row = rows[key]
            if (!row) return null
            return (
              <Paper key={key} withBorder radius="md" p="sm" bg={lineErrors[key] ? 'var(--mantine-color-red-0)' : undefined}>
                {itemCell(line)}
                <Text fz="xs" c="dimmed" mt={4}>
                  {quantityTitle} {formatNumber(quantityOf(line))} · Received {formatNumber(line.receivedBase)} · Short {formatNumber(line.shortBase)} · In
                  containers {formatNumber(line.inContainersBase)} · In draft receipts {formatNumber(line.inDraftReceiptsBase)}
                </Text>
                <SimpleGrid cols={2} spacing="xs" mt="xs">
                  <Box>
                    <Text fz="xs" c="dimmed">
                      To receive
                    </Text>
                    <Text fz="sm" fw={600}>
                      {formatNumber(line.toReceiveBase)} pcs
                    </Text>
                  </Box>
                  <Box>
                    <Text fz="xs" c="dimmed">
                      Receive now
                    </Text>
                    {receiveNowInput(line, row)}
                  </Box>
                </SimpleGrid>
                <Box mt="xs">
                  <Text fz="xs" c="dimmed">
                    Warehouse
                  </Text>
                  {warehouseSelect(line, row)}
                </Box>
                {line.poLineId !== null && (
                  <Box mt="xs">
                    <Text fz="xs" c="dimmed">
                      Nothing more will come
                    </Text>
                    {closeShortCell(line, row)}
                  </Box>
                )}
              </Paper>
            )
          })}
          <Text fz="sm" fw={600} ta="right">
            To receive {formatNumber(totals.toReceive)} pcs · Receive now {formatNumber(totals.now)} pcs
          </Text>
        </Stack>
      ) : (
        <Table.ScrollContainer minWidth={1100}>
          <Table verticalSpacing="xs" striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Item</Table.Th>
                <Table.Th ta="right">{quantityTitle}</Table.Th>
                <Table.Th ta="right">Received</Table.Th>
                <Table.Th ta="right">Short</Table.Th>
                <Table.Th ta="right">In containers</Table.Th>
                <Table.Th ta="right">In draft receipts</Table.Th>
                <Table.Th ta="right">To receive</Table.Th>
                <Table.Th w={130}>Receive now</Table.Th>
                <Table.Th w={190}>Nothing more will come</Table.Th>
                <Table.Th w={230}>Warehouse</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line) => {
                const key = keyOf(line)
                const row = rows[key]
                if (!row) return null
                return (
                  <Table.Tr key={key} bg={lineErrors[key] ? 'var(--mantine-color-red-0)' : undefined}>
                    <Table.Td>{itemCell(line)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(quantityOf(line))}</Table.Td>
                    <Table.Td ta="right">{formatNumber(line.receivedBase)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(line.shortBase)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(line.inContainersBase)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(line.inDraftReceiptsBase)}</Table.Td>
                    <Table.Td ta="right">
                      <Text fz="sm" fw={600}>
                        {formatNumber(line.toReceiveBase)}
                      </Text>
                    </Table.Td>
                    <Table.Td>{receiveNowInput(line, row)}</Table.Td>
                    <Table.Td>
                      {line.poLineId === null ? (
                        <Text fz="sm" c="dimmed">
                          —
                        </Text>
                      ) : (
                        closeShortCell(line, row)
                      )}
                    </Table.Td>
                    <Table.Td>{warehouseSelect(line, row)}</Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr>
                <Table.Th colSpan={6}>Total</Table.Th>
                <Table.Th ta="right">{formatNumber(totals.toReceive)}</Table.Th>
                <Table.Th>{formatNumber(totals.now)} pcs</Table.Th>
                <Table.Th colSpan={2} />
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}

      <Stack gap={2}>
        <Text size="sm" c="dimmed">
          {CONTAINERS_HINT}
        </Text>
        <Text size="sm" c="dimmed">
          {orderPriceHint(invoiceType?.affectsItemCost)}
        </Text>
      </Stack>

      {error && <Alert color="red">{error}</Alert>}

      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant={canPost ? 'default' : 'filled'} onClick={() => void create(false)} loading={busy} disabled={nothing}>
          Create draft
        </Button>
        {canPost && (
          <Button onClick={() => void create(true)} loading={busy} disabled={nothing}>
            Create and post
          </Button>
        )}
      </Group>
    </Stack>
  )
}

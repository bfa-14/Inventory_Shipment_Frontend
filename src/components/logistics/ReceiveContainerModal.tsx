import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { ApiError } from '../../api/http'
import type { ContainerDto, ContainerLineDto } from '../../api/logistics/containers'
import {
  goodsReceiptsApi,
  VARIANCE_REASONS,
  type GoodsReceiptCreatedDto,
  type VarianceReasonCode,
} from '../../api/purchase/goodsReceipts'
import type { WarehouseLookupDto } from '../../api/types'
import { refreshGoodsReceiptsWaiting } from '../../hooks/useGoodsReceiptsWaiting'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { DRAFT_HINT, notDispatchedText, ORDER_PRICE_HINT } from '../purchase/goodsReceipts/goodsReceiptModel'
import { notify } from '../ui/notify'

interface ReceiveContainerModalProps {
  opened: boolean
  onClose: () => void
  container: ContainerDto
  /** The active warehouses of the container's branch at the bottom of the tree (no warehouse under them, script 72): the
      only ones its goods can be received into. */
  warehouses: WarehouseLookupDto[]
  /** purchase.goodsreceipts.post: "Create and post" is offered. */
  canPost: boolean
  /** Once the receipt exists (posted or not); the host opens it. */
  onCreated: (created: GoodsReceiptCreatedDto) => void
}

interface Received {
  quantity: number | ''
  reasonCode: VarianceReasonCode | null
  note: string
}

const REASON_OPTIONS = VARIANCE_REASONS.map((r) => ({ value: r.value, label: r.label }))

/**
 * "Receive goods - KTG-2026-0031": the container's goods received into the stock with a goods receipt (rules 6-8). It
 * replaces the offload of before goods receipts (this file was the OffloadModal).
 *
 * THE LINES ARE THE CONTAINER'S: received from 0 to the loaded pieces, and a reason (a code and a free note) where the
 * two differ - the difference is settled, nothing more is expected for those pieces. One warehouse for the whole
 * container, of its branch; the date received is not in the future nor before the Delivery reached it.
 *
 * NOTHING HERE NEEDS THE INVOICES: goods may be received before they are invoiced; pieces not invoiced yet are valued at
 * the order price and their cost is adjusted when the invoice is posted.
 *
 * "Create draft" leaves the stock as it is; "Create and post" (post permission) receives at once. The server checks
 * every rule again and its refusal is shown as it comes; a draft whose posting was refused stays, and the message says
 * why.
 */
export function ReceiveContainerModal({ opened, onClose, container, warehouses, canPost, onCreated }: ReceiveContainerModalProps) {
  const fullScreen = useMediaQuery('(max-width: 768px)')
  const phone = useMediaQuery('(max-width: 48em)')
  const [received, setReceived] = useState<Record<number, Received>>({})
  const ownWarehouse = warehouses.some((w) => w.id === container.warehouseId) ? container.warehouseId : null
  const [warehouseId, setWarehouseId] = useState<string | null>(ownWarehouse === null ? null : String(ownWarehouse))
  const [documentDate, setDocumentDate] = useState<string | null>(isoDate(new Date()))
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lines = container.lines
  const valueOf = (line: ContainerLineDto): Received => received[line.id] ?? { quantity: line.quantityBase, reasonCode: null, note: '' }
  const differs = (line: ContainerLineDto) => valueOf(line).quantity !== line.quantityBase

  /* What saves a round trip, in the server's own sentences (63000); everything else is the server's. */
  const lineProblems: Record<number, string> = {}
  for (const line of lines) {
    const value = valueOf(line)
    const label = `Line ${line.lineNumber} (${line.itemCode})`
    if (value.quantity === '') lineProblems[line.id] = `${label}: enter the received quantity.`
    else if (value.quantity > line.quantityBase)
      lineProblems[line.id] = `${label}: received ${formatNumber(value.quantity)} but only ${formatNumber(line.quantityBase)} were loaded.`
    else if (differs(line) && !value.reasonCode)
      lineProblems[line.id] = `${label}: choose a reason when the received quantity differs from the loaded quantity.`
  }
  const problems = [
    ...(!warehouseId ? ['Choose the warehouse the goods are received into.'] : []),
    ...(!documentDate ? ['Choose the date received.'] : []),
    ...Object.values(lineProblems),
  ]

  const totals = lines.reduce(
    (sum, line) => {
      const value = valueOf(line).quantity
      return { loaded: sum.loaded + line.quantityBase, received: sum.received + (value === '' ? 0 : value) }
    },
    { loaded: 0, received: 0 },
  )

  function patch(line: ContainerLineDto, change: Partial<Received>) {
    setError(null)
    setReceived((all) => ({ ...all, [line.id]: { ...valueOf(line), ...change } }))
  }

  async function create(post: boolean) {
    setTouched(true)
    if (problems.length > 0) return
    setBusy(true)
    setError(null)
    try {
      const created = await goodsReceiptsApi.fromContainer({
        containerId: container.id,
        documentDate,
        warehouseId: Number(warehouseId),
        lines: lines.map((line) => {
          const value = valueOf(line)
          const same = !differs(line)
          return {
            containerLineId: line.id,
            quantityBase: Number(value.quantity),
            varianceReasonCode: same ? null : value.reasonCode,
            varianceReason: same ? null : value.note.trim() || null,
          }
        }),
        post,
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
      setBusy(false)
      onCreated(created)
    } catch (err) {
      setBusy(false)
      setError(err instanceof ApiError ? err.message : 'The goods receipt could not be created.')
    }
  }

  function itemCell(line: ContainerLineDto) {
    return (
      <>
        <Text fz="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
          {line.itemCode}
        </Text>
        <Text fz="xs" c="dimmed">
          {line.itemName}
        </Text>
      </>
    )
  }

  function receivedInput(line: ContainerLineDto) {
    const value = valueOf(line)
    return (
      <NumberInput
        size="xs"
        min={0}
        max={line.quantityBase}
        allowDecimal={false}
        allowNegative={false}
        thousandSeparator=","
        suffix=" pcs"
        value={value.quantity}
        onChange={(next) => patch(line, { quantity: next === '' ? '' : Math.max(0, Math.trunc(numberInputValue(next) ?? 0)) })}
        error={touched && value.quantity !== '' && value.quantity > line.quantityBase ? 'Above loaded' : undefined}
        aria-label={`Received quantity of ${line.itemCode}`}
        disabled={busy}
      />
    )
  }

  function reasonCells(line: ContainerLineDto) {
    const value = valueOf(line)
    const required = differs(line)
    return (
      <Stack gap={4}>
        <Select
          size="xs"
          data={REASON_OPTIONS}
          placeholder={required ? 'Required: choose a reason' : 'Only when it differs'}
          value={value.reasonCode}
          onChange={(next) => patch(line, { reasonCode: (next as VarianceReasonCode | null) ?? null })}
          clearable
          disabled={busy || !required}
          error={touched && required && !value.reasonCode ? 'Reason required' : undefined}
          aria-label={`Reason for ${line.itemCode}`}
          comboboxProps={{ withinPortal: true }}
        />
        {required ? (
          <TextInput
            size="xs"
            maxLength={300}
            placeholder="Note (optional)"
            value={value.note}
            onChange={(event) => patch(line, { note: event.currentTarget.value })}
            aria-label={`Note on the reason for ${line.itemCode}`}
            disabled={busy}
          />
        ) : null}
      </Stack>
    )
  }

  const short = (line: ContainerLineDto) => {
    const value = valueOf(line).quantity
    return value === '' ? 0 : line.quantityBase - value
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={`Receive goods - ${container.containerRef}`}
      size="72rem"
      fullScreen={fullScreen}
      closeOnClickOutside={!busy}
    >
      <Stack>
        {container.status === 2 ? <Alert color="orange">{notDispatchedText(container.containerRef)}</Alert> : null}

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Receive into"
            withAsterisk
            placeholder="Choose the warehouse"
            data={warehouses.map((w) => ({ value: String(w.id), label: `${w.warehouseCode} - ${w.warehouseName}` }))}
            value={warehouseId}
            onChange={(next) => {
              setError(null)
              setWarehouseId(next)
            }}
            searchable
            nothingFoundMessage={`No active warehouse of ${container.branchCode} matches`}
            description={`A warehouse of ${container.branchCode} - ${container.branchName}`}
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            error={touched && !warehouseId ? 'Choose the warehouse the goods are received into.' : undefined}
            disabled={busy}
          />
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
            description={container.deliveredDate ? `Delivered ${dateLabel(container.deliveredDate)}: not before.` : undefined}
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            error={touched && !documentDate ? 'Choose the date received.' : undefined}
            disabled={busy}
          />
        </SimpleGrid>

        {phone ? (
          /* A phone: one card per line, the received pieces and the reason first. */
          <Stack gap="sm">
            {lines.map((line) => (
              <Paper key={line.id} withBorder radius="md" p="sm" bg={touched && lineProblems[line.id] ? 'var(--mantine-color-red-0)' : undefined}>
                {itemCell(line)}
                <Text fz="xs" c="dimmed" mt={4}>
                  Line {line.lineNumber} · {line.purchaseOrderNumber ?? '—'} · PI {line.invoiceNumbers ?? '—'}
                </Text>
                <SimpleGrid cols={2} spacing="xs" mt="xs">
                  <Box>
                    <Text fz="xs" c="dimmed">
                      Loaded
                    </Text>
                    <Text fz="sm" fw={600}>
                      {formatNumber(line.quantityBase)} pcs
                    </Text>
                  </Box>
                  <Box>
                    <Text fz="xs" c="dimmed">
                      Received
                    </Text>
                    {receivedInput(line)}
                  </Box>
                </SimpleGrid>
                {differs(line) ? (
                  <Box mt="xs">
                    <Text fz="xs" c={short(line) > 0 ? 'red' : 'dimmed'}>
                      Difference {formatNumber(-short(line))} pcs - reason
                    </Text>
                    {reasonCells(line)}
                  </Box>
                ) : null}
              </Paper>
            ))}
            <Text fz="sm" fw={600} ta="right">
              Loaded {formatNumber(totals.loaded)} pcs · Received {formatNumber(totals.received)} pcs
            </Text>
          </Stack>
        ) : (
          <ScrollArea type="auto">
            <Table miw={860} verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>#</Table.Th>
                  <Table.Th>Item</Table.Th>
                  <Table.Th>Order</Table.Th>
                  <Table.Th>PI No.</Table.Th>
                  <Table.Th ta="right">Loaded (pcs)</Table.Th>
                  <Table.Th w={150}>Received (pcs)</Table.Th>
                  <Table.Th ta="right">Difference</Table.Th>
                  <Table.Th w={250}>Reason</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lines.map((line) => {
                  const difference = -short(line)
                  return (
                    <Table.Tr key={line.id} bg={touched && lineProblems[line.id] ? 'var(--mantine-color-red-0)' : undefined}>
                      <Table.Td>{line.lineNumber}</Table.Td>
                      <Table.Td>{itemCell(line)}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{line.purchaseOrderNumber ?? '—'}</Table.Td>
                      <Table.Td>{line.invoiceNumbers ?? '—'}</Table.Td>
                      <Table.Td ta="right">{formatNumber(line.quantityBase)}</Table.Td>
                      <Table.Td>{receivedInput(line)}</Table.Td>
                      <Table.Td ta="right" c={difference < 0 ? 'red' : undefined} fw={difference !== 0 ? 700 : undefined}>
                        {difference === 0 ? '—' : formatNumber(difference)}
                      </Table.Td>
                      <Table.Td>{reasonCells(line)}</Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
              <Table.Tfoot>
                <Table.Tr>
                  <Table.Th colSpan={4}>Total</Table.Th>
                  <Table.Th ta="right">{formatNumber(totals.loaded)}</Table.Th>
                  <Table.Th>{formatNumber(totals.received)} pcs</Table.Th>
                  <Table.Th ta="right">{totals.received === totals.loaded ? '—' : formatNumber(totals.received - totals.loaded)}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Tfoot>
            </Table>
          </ScrollArea>
        )}

        <Stack gap={2}>
          <Text size="sm" c="dimmed">
            {DRAFT_HINT}
          </Text>
          <Text size="sm" c="dimmed">
            {ORDER_PRICE_HINT}
          </Text>
        </Stack>

        {touched && problems.length > 0 ? <Alert color="orange">{problems.join(' ')}</Alert> : null}
        {error ? <Alert color="red">{error}</Alert> : null}

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={canPost ? 'default' : 'filled'} onClick={() => void create(false)} loading={busy} disabled={lines.length === 0}>
            Create draft
          </Button>
          {canPost ? (
            <Button color="green" onClick={() => void create(true)} loading={busy} disabled={lines.length === 0}>
              Create and post
            </Button>
          ) : null}
        </Group>
      </Stack>
    </Modal>
  )
}

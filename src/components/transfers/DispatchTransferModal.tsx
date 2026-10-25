import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { ApiError } from '../../api/http'
import {
  transfersApi,
  type TransferOrderDto,
  type TransferOrderLineDto,
  type TransferPostedResult,
} from '../../api/inventory/transfers'
import { fromIsoDate, isoDate, unitLabel } from '../documents/documentKind'
import { formatNumber, numberInputValue, todayDateOnly } from '../format'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'
import { numberList, orderLabel } from './transferModel'

export type DispatchMode = 'dispatch' | 'dispatchAndReceive'

interface DispatchTransferModalProps {
  opened: boolean
  order: TransferOrderDto
  /** Dispatch… or Dispatch and receive… (one date, no ETA, the receipt posted with it). */
  mode: DispatchMode
  /** The order lines ticked in the grid: the dialog proposes those, else every line with something to dispatch. */
  preselected: number[]
  onClose(): void
  /** Posted: the order as the server holds it now. */
  onPosted(result: TransferPostedResult): void
  /** Refused because someone else changed the order: the page reads it again. */
  onStale(): void
}

interface RowState {
  ticked: boolean
  quantity: number
  /** Proposed with nothing at From: "No stock in {From}." */
  noStock: boolean
}

const NO_ROW: RowState = { ticked: false, quantity: 0, noStock: false }

/**
 * The proposal (rule T13): the lines ticked in the grid, else every line with something to dispatch, each at the
 * smaller of what it still has to dispatch and what From still holds of the item after the lines above it; a line
 * with nothing left there is unticked and says so.
 */
function propose(lines: TransferOrderLineDto[], preselected: number[]): Record<number, RowState> {
  const wanted = new Set(preselected)
  const left = new Map<number, number>()
  const rows: Record<number, RowState> = {}
  for (const line of lines) {
    if (wanted.size > 0 && !wanted.has(line.id)) {
      rows[line.id] = { ticked: false, quantity: 0, noStock: false }
      continue
    }
    const stock = left.get(line.itemId) ?? Math.max(0, line.onHandFromBase)
    const quantity = Math.min(line.toDispatchBase, stock)
    left.set(line.itemId, stock - quantity)
    rows[line.id] =
      quantity > 0 ? { ticked: true, quantity, noStock: false } : { ticked: false, quantity: 0, noStock: true }
  }
  return rows
}

/**
 * "Dispatch - {No}" (2.6.4): the pieces that leave From now, onto the way to To (a TRD, numbered by From's branch, with
 * an ETA). In its "Dispatch and receive" mode the same lines arrive at To on the same date: the dispatch and its receipt
 * are posted together, or neither (rule T20).
 *
 * POSTED DIRECTLY: there is no draft dispatch (rule FB 14). The limits are the server's - at most what a line still has
 * to dispatch (62012), at most what From holds when it is posted (62007) - and a refusal is shown here as it comes.
 */
export function DispatchTransferModal({
  opened,
  order,
  mode,
  preselected,
  onClose,
  onPosted,
  onStale,
}: DispatchTransferModalProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const both = mode === 'dispatchAndReceive'
  const from = order.from.code
  const to = order.to.code
  const label = orderLabel(order)

  const lines = useMemo(() => order.lines.filter((l) => l.toDispatchBase > 0), [order.lines])
  const [rows, setRows] = useState<Record<number, RowState>>(() => propose(lines, preselected))

  const today = todayDateOnly()
  const [date, setDate] = useState<string | null>(today)
  /* THE ETA STARTS AT THE EXPECTED ARRIVAL when it is not before the dispatch date, else at the date itself - and keeps
     following the date by that rule until the reader types one of their own. */
  const defaultEta = (forDate: string) =>
    order.expectedArrival && order.expectedArrival >= forDate ? order.expectedArrival : forDate
  const [eta, setEta] = useState<string | null>(() => defaultEta(today))
  const [etaTyped, setEtaTyped] = useState(false)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorLine, setErrorLine] = useState<number | null>(null)

  /** The other dispatches still on the way, named by "Dispatch and receive" (their goods are received with Receive…). */
  const onTheWay = useMemo(
    () => order.postings.filter((p) => p.kind === 'Dispatch' && p.status === 'Posted' && p.onTheWayBase > 0),
    [order.postings],
  )
  const onTheWayBase = onTheWay.reduce((sum, p) => sum + p.onTheWayBase, 0)

  function patch(lineId: number, change: Partial<RowState>) {
    setError(null)
    setErrorLine(null)
    setRows((current) => ({
      ...current,
      [lineId]: { ...(current[lineId] ?? NO_ROW), ...change },
    }))
  }

  /** Ticking a line proposes what From still holds of its item after the other ticked lines. */
  function tick(line: TransferOrderLineDto, checked: boolean) {
    if (!checked) {
      patch(line.id, { ticked: false })
      return
    }
    const others = lines
      .filter((l) => l.itemId === line.itemId && l.id !== line.id && rows[l.id]?.ticked)
      .reduce((sum, l) => sum + (rows[l.id]?.quantity ?? 0), 0)
    const current = rows[line.id]?.quantity ?? 0
    const quantity = current > 0 ? current : Math.max(0, Math.min(line.toDispatchBase, line.onHandFromBase - others))
    patch(line.id, { ticked: true, quantity, noStock: false })
  }

  /** Per item, what the ticked lines take from From: red when above what it holds (the server refuses it, 62007). */
  const takenByItem = useMemo(() => {
    const map = new Map<number, number>()
    for (const line of lines) {
      const row = rows[line.id]
      if (row?.ticked) map.set(line.itemId, (map.get(line.itemId) ?? 0) + row.quantity)
    }
    return map
  }, [lines, rows])

  const chosen = lines.filter((line) => rows[line.id]?.ticked && (rows[line.id]?.quantity ?? 0) > 0)
  const totalPieces = chosen.reduce((sum, line) => sum + (rows[line.id]?.quantity ?? 0), 0)
  const totalToDispatch = lines.reduce((sum, line) => sum + line.toDispatchBase, 0)

  /* WHY THE BUTTON IS DISABLED, in the server's own words (62012, 62009, the date rules): the reader sees the sentence
     the post would be refused with, before pressing it. */
  const above = lines.find((line) => rows[line.id]?.ticked && (rows[line.id]?.quantity ?? 0) > line.toDispatchBase)
  const blockedBy = above
    ? `Line ${above.lineNumber} (${above.itemCode}): ${formatNumber(rows[above.id]?.quantity ?? 0)} pcs dispatched but only ${formatNumber(above.toDispatchBase)} are left to dispatch.`
    : chosen.length === 0
      ? 'Nothing to dispatch: type the pieces that leave.'
      : !date
        ? 'The dispatch date is required.'
        : !both && !eta
          ? 'The ETA is required.'
          : !both && eta && date && eta < date
            ? 'The ETA cannot be before the dispatch date.'
            : null

  async function submit() {
    if (blockedBy || !date) return
    setBusy(true)
    setError(null)
    setErrorLine(null)
    const payload = {
      rowVersion: order.rowVersion,
      date,
      eta: both ? null : eta,
      referenceNo: reference.trim() || null,
      notes: notes.trim() || null,
      lines: chosen.map((line) => ({ transferOrderLineId: line.id, quantityBase: rows[line.id]!.quantity })),
    }
    try {
      const result = both
        ? await transfersApi.dispatchAndReceive(order.id, payload)
        : await transfersApi.dispatch(order.id, payload)
      notify.success(result.message)
      onPosted(result)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The dispatch could not be posted.'
      setError(message)
      // "Line 2 (…): …" - the dispatch line takes its order line's number.
      const match = /^Line (\d+)/.exec(message)
      setErrorLine(match ? Number(match[1]) : null)
      if (err instanceof ApiError && (err.code === 'CONCURRENCY' || /modified by another user/i.test(message)))
        onStale()
    } finally {
      setBusy(false)
    }
  }

  function quantityInput(line: TransferOrderLineDto) {
    const row = rows[line.id]
    if (!row) return null
    const over = row.ticked && row.quantity > line.toDispatchBase
    return (
      <NumberInput
        aria-label={`Dispatch now, line ${line.lineNumber}`}
        value={row.quantity}
        onChange={(next) => {
          const quantity = Math.max(0, Math.trunc(numberInputValue(next) ?? 0))
          patch(line.id, { quantity, ticked: quantity > 0 ? true : row.ticked, noStock: false })
        }}
        min={0}
        allowDecimal={false}
        allowNegative={false}
        thousandSeparator=","
        size="xs"
        disabled={busy}
        description={over ? `Max ${formatNumber(line.toDispatchBase)}` : undefined}
        styles={over ? { description: { color: 'var(--mantine-color-red-7)', fontWeight: 600 } } : undefined}
        error={over}
        w={phone ? '100%' : 120}
      />
    )
  }

  function stockText(line: TransferOrderLineDto) {
    const short = (takenByItem.get(line.itemId) ?? 0) > line.onHandFromBase
    return (
      <Text fz="sm" c={short ? 'red' : undefined} fw={short ? 700 : undefined} ta={phone ? undefined : 'right'}>
        {formatNumber(line.onHandFromBase)}
      </Text>
    )
  }

  function itemCell(line: TransferOrderLineDto) {
    return (
      <>
        <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
          {line.itemCode}
        </Text>
        <Text fz="xs" c="dimmed">
          {line.itemName}
        </Text>
        {rows[line.id]?.noStock ? (
          <Text fz="xs" c="orange.7">
            No stock in {from}.
          </Text>
        ) : null}
      </>
    )
  }

  const title = both ? `Dispatch and receive - ${label}` : `Dispatch - ${label}`

  return (
    <FormModal
      opened={opened}
      title={title}
      onSubmit={() => void submit()}
      onClose={onClose}
      saving={busy}
      saveLabel={both ? 'Dispatch and receive' : 'Dispatch'}
      size="xl"
      fullScreen={phone}
      saveDisabled={blockedBy !== null}
      saveDisabledReason={blockedBy ?? undefined}
    >
      {both && (
        <Text size="sm" data-dispatch-and-receive>
          The goods leave {from} and arrive at {to} on the same date: the dispatch and the receipt are posted together,
          or neither.
        </Text>
      )}
      {both && onTheWay.length > 0 && (
        <Alert color="orange">
          {formatNumber(onTheWayBase)} pcs of {numberList(onTheWay.map((p) => p.documentNumber))} are still on the way:
          receive them with Receive…
        </Alert>
      )}

      <Group align="flex-start" wrap="wrap" gap="md">
        <DateInput
          label={both ? 'Date' : 'Dispatch date'}
          withAsterisk
          valueFormat="DD/MM/YYYY"
          value={fromIsoDate(date)}
          onChange={(next) => {
            const value = next ? isoDate(next) : null
            setError(null)
            setDate(value)
            // The proposed ETA follows the new date; a typed one only when it would now be before it.
            if (value && !etaTyped) setEta(defaultEta(value))
            else if (value && eta && eta < value) setEta(value)
          }}
          minDate={fromIsoDate(order.documentDate) ?? undefined}
          maxDate={new Date()}
          w={{ base: '100%', xs: 170 }}
          disabled={busy}
        />
        {!both && (
          <DateInput
            label="ETA"
            withAsterisk
            valueFormat="DD/MM/YYYY"
            value={fromIsoDate(eta)}
            onChange={(next) => {
              setError(null)
              setEtaTyped(true)
              setEta(next ? isoDate(next) : null)
            }}
            minDate={fromIsoDate(date) ?? undefined}
            w={{ base: '100%', xs: 170 }}
            disabled={busy}
          />
        )}
        <TextInput
          label="Waybill / truck"
          value={reference}
          onChange={(event) => setReference(event.currentTarget.value)}
          maxLength={100}
          w={{ base: '100%', xs: 240 }}
          disabled={busy}
        />
      </Group>
      <Textarea
        label="Notes"
        autosize
        minRows={1}
        maxLength={1000}
        value={notes}
        onChange={(event) => setNotes(event.currentTarget.value)}
        disabled={busy}
      />

      {phone ? (
        <Stack gap="sm">
          {lines.map((line) => {
            const row = rows[line.id]
            if (!row) return null
            return (
              <Paper
                key={line.id}
                withBorder
                radius="md"
                p="sm"
                bg={errorLine === line.lineNumber ? 'var(--mantine-color-red-0)' : undefined}
              >
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <Checkbox
                    aria-label={`Dispatch line ${line.lineNumber}`}
                    checked={row.ticked}
                    onChange={(event) => tick(line, event.currentTarget.checked)}
                    disabled={busy}
                    mt={2}
                  />
                  <Box style={{ minWidth: 0 }}>
                    <Text fz="xs" c="dimmed">
                      Line {line.lineNumber} · {unitLabel(line.unitName, line.packingFormula)}
                    </Text>
                    {itemCell(line)}
                  </Box>
                </Group>
                <SimpleGrid cols={3} spacing="xs" mt="xs">
                  <Box>
                    <Text fz="xs" c="dimmed">
                      To dispatch (pcs)
                    </Text>
                    <Text fz="sm" fw={600}>
                      {formatNumber(line.toDispatchBase)}
                    </Text>
                  </Box>
                  <Box>
                    <Text fz="xs" c="dimmed">
                      At {from} (pcs)
                    </Text>
                    {stockText(line)}
                  </Box>
                  <Box>
                    <Text fz="xs" c="dimmed">
                      Dispatch now (pcs)
                    </Text>
                    {quantityInput(line)}
                  </Box>
                </SimpleGrid>
              </Paper>
            )
          })}
          <Text fz="sm" fw={600} ta="right">
            To dispatch {formatNumber(totalToDispatch)} pcs · Dispatch now {formatNumber(totalPieces)} pcs
          </Text>
        </Stack>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="xs" striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36} />
                <Table.Th w={44}>#</Table.Th>
                <Table.Th>Item</Table.Th>
                <Table.Th>Unit</Table.Th>
                <Table.Th ta="right">To dispatch (pcs)</Table.Th>
                <Table.Th ta="right">At {from} (pcs)</Table.Th>
                <Table.Th w={140}>Dispatch now (pcs)</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line) => {
                const row = rows[line.id]
                if (!row) return null
                return (
                  <Table.Tr key={line.id} bg={errorLine === line.lineNumber ? 'var(--mantine-color-red-0)' : undefined}>
                    <Table.Td>
                      <Checkbox
                        aria-label={`Dispatch line ${line.lineNumber}`}
                        checked={row.ticked}
                        onChange={(event) => tick(line, event.currentTarget.checked)}
                        disabled={busy}
                      />
                    </Table.Td>
                    <Table.Td>{formatNumber(line.lineNumber)}</Table.Td>
                    <Table.Td>{itemCell(line)}</Table.Td>
                    <Table.Td>{unitLabel(line.unitName, line.packingFormula)}</Table.Td>
                    <Table.Td ta="right">
                      <Text fz="sm" fw={600}>
                        {formatNumber(line.toDispatchBase)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">{stockText(line)}</Table.Td>
                    <Table.Td>{quantityInput(line)}</Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr>
                <Table.Th colSpan={4}>Total</Table.Th>
                <Table.Th ta="right">{formatNumber(totalToDispatch)}</Table.Th>
                <Table.Th />
                <Table.Th>{formatNumber(totalPieces)} pcs</Table.Th>
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}

      <Text size="sm" fw={500} data-dispatch-summary>
        {formatNumber(chosen.length)} line(s), {formatNumber(totalPieces)} pcs leave {from} for {to}.
      </Text>

      {error && <Alert color="red">{error}</Alert>}
    </FormModal>
  )
}

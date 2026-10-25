import { useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
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
  Tooltip,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { IconCheck } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  transfersApi,
  transferTrackingApi,
  type DispatchTransferLineRequest,
  type DispatchTransferRequest,
  type TransferOrderDto,
  type TransferOrderLineDto,
  type TransferPostedResult,
} from '../../api/inventory/transfers'
import { fromIsoDate, isoDate, unitLabel } from '../documents/documentKind'
import { formatNumber, numberInputValue, todayDateOnly } from '../format'
import { TrackingModal } from '../tracking/TrackingModal'
import {
  entriesComplete,
  entriesStateText,
  incompleteSentence,
  KIND_TEXT,
  normalizeTrackingNo,
  type KnownSerials,
  type TrackingEntry,
} from '../tracking/trackingNumbers'
import { confirm } from '../ui/confirm'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'
import { useCalendarEscape } from '../ui/useCalendarEscape'
import { numberList, orderLabel } from './transferModel'
import {
  checkOutcomeFor,
  clearStoredTracking,
  dispatchTrackingRows,
  dispatchTrackingTitle,
  knownSerialsOf,
  linePrefix,
  lineTrackingKind,
  lineWithExpiry,
  readStoredTracking,
  writeStoredTracking,
} from './transferTracking'

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

const DISCARD_QUESTION = 'Discard the serial numbers, batches and expiry dates typed in this dialog?'

/**
 * "Dispatch - {No}" (2.6.4): the pieces that leave From now, onto the way to To (a TRD, numbered by From's branch, with
 * an ETA). In its "Dispatch and receive" mode the same lines arrive at To on the same date: the dispatch and its receipt
 * are posted together, or neither (rule T20).
 *
 * POSTED DIRECTLY: there is no draft dispatch (rule FB 14). The limits are the server's - at most what a line still has
 * to dispatch (62012), at most what From holds when it is posted (62007) - and a refusal is shown here as it comes.
 *
 * (93) A LINE OF A TRACKED ITEM carries its serial nos., batches or expiry dates, typed in TrackingModal - opened by the
 * line's "Serial nos.…" / "Batches…" / "Expiry dates…" and rendered BESIDE this dialog (never in it), this dialog not
 * closing on Escape meanwhile. Dispatch is disabled while a leaving tracked line is incomplete (the database's own
 * sentence, mirrored); the typed rows survive a reload in sessionStorage (`trf-tracking:{orderId}:{rowVersion}`,
 * cleared after the post or Discard), and closing with rows typed asks first.
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
  /* THE CURSOR STARTS ON THE FIRST QUANTITY (the first ticked line's, else the first line's): the dialog is about the
     pieces that leave, and a date field focused first opened its calendar over the lines (and the keyboard on a phone). */
  const [focusLineId] = useState<number | null>(() => (lines.find((l) => rows[l.id]?.ticked) ?? lines[0])?.id ?? null)
  const { calendarOpen, calendar } = useCalendarEscape()

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

  /* ── (93) the tracking of the lines ── */

  const tracked = useMemo(() => lines.some((l) => lineTrackingKind(l) !== null), [lines])
  /** The rows each line carries, as the last Done of its dialog left them (or as restored). */
  const [tracking, setTracking] = useState<Record<number, TrackingEntry[]>>({})
  /** Rows typed earlier for this order as it is now, kept through a reload: offered once, when the dialog opens. */
  const [restoreOffer, setRestoreOffer] = useState<Record<number, TrackingEntry[]> | null>(() => {
    if (!tracked) return null
    const stored = readStoredTracking(order.id, order.rowVersion)
    if (!stored) return null
    const ours = Object.fromEntries(
      Object.entries(stored).filter(([lineId]) => lines.some((l) => l.id === Number(lineId) && lineTrackingKind(l))),
    )
    return Object.keys(ours).length > 0 ? ours : null
  })
  /** The line whose TrackingModal is open. */
  const [trackingFor, setTrackingFor] = useState<number | null>(null)
  /** Something was typed in the open TrackingModal (its Cancel then puts back what Done left, in the session too). */
  const changedInDialog = useRef(false)
  /** The discard question is open: Escape answers it, never this dialog. */
  const [confirmOpen, setConfirmOpen] = useState(false)
  /** The last Check's warnings, per line ("Keep these numbers" kept them): listed in orange above the footer. */
  const [warnings, setWarnings] = useState<Record<number, string[]>>({})
  /** "Known at {From}…", per serial line, read when its dialog first opens (null: nothing known). */
  const [known, setKnown] = useState<Record<number, KnownSerials | null>>({})

  const typedRows = Object.values(tracking).reduce((sum, entries) => sum + entries.length, 0)
  const offeredRows = restoreOffer ? Object.values(restoreOffer).reduce((sum, entries) => sum + entries.length, 0) : 0

  const persist = (next: Record<number, TrackingEntry[]>) => writeStoredTracking(order.id, order.rowVersion, next)

  function commitTracking(lineId: number, entries: TrackingEntry[]) {
    const next = { ...tracking, [lineId]: entries }
    setTracking(next)
    persist(next)
    setRestoreOffer(null)
    setError(null)
    setErrorLine(null)
  }

  function restore() {
    if (!restoreOffer) return
    setTracking(restoreOffer)
    persist(restoreOffer)
    setRestoreOffer(null)
  }

  function startAgain() {
    clearStoredTracking(order.id)
    setRestoreOffer(null)
  }

  /** Pieces leaving on a line now: its "Dispatch now" when ticked. */
  const leaving = (line: TransferOrderLineDto) => (rows[line.id]?.ticked ? (rows[line.id]?.quantity ?? 0) : 0)

  function openTracking(line: TransferOrderLineDto) {
    changedInDialog.current = false
    setTrackingFor(line.id)
    if (lineTrackingKind(line) !== 'Serial' || line.id in known) return
    setKnown((current) => ({ ...current, [line.id]: null }))
    transferTrackingApi
      .suggestions(order.id, line.id)
      .then((answer) =>
        setKnown((current) => ({
          ...current,
          [line.id]: answer.serials.length > 0 ? knownSerialsOf(answer.serials, from) : null,
        })),
      )
      .catch(() => {
        /* No suggestion is no loss: the serials are scanned. */
      })
  }

  /** The other lines of the same item and their serials: a serial is once in a dispatch. */
  function otherLineSerials(line: TransferOrderLineDto): Map<string, number> {
    const map = new Map<string, number>()
    for (const other of lines) {
      if (other.id === line.id || other.itemId !== line.itemId) continue
      for (const e of tracking[other.id] ?? []) {
        const serial = normalizeTrackingNo(e.serialNo)
        if (serial && !map.has(serial)) map.set(serial, other.lineNumber)
      }
    }
    return map
  }

  /** A line as the request carries it: its pieces, and its rows when its item is tracked. */
  function requestLine(line: TransferOrderLineDto, quantityBase: number, entries?: TrackingEntry[]): DispatchTransferLineRequest {
    const kind = lineTrackingKind(line)
    const own = entries ?? tracking[line.id] ?? []
    return kind && own.length > 0
      ? { transferOrderLineId: line.id, quantityBase, tracking: dispatchTrackingRows(kind, own) }
      : { transferOrderLineId: line.id, quantityBase }
  }

  /**
   * THE DIALOG'S DONE: the whole dispatch as it would be posted, with this line's rows as typed now - the database's
   * Check (no lock, nothing written); this line's errors and warnings come back to its dialog.
   */
  async function checkLine(line: TransferOrderLineDto, entries: TrackingEntry[]) {
    const payload: DispatchTransferRequest = {
      rowVersion: order.rowVersion,
      date: date ?? today,
      eta: both ? null : (eta ?? date ?? today),
      referenceNo: reference.trim() || null,
      notes: notes.trim() || null,
      lines: lines
        .filter((l) => l.id === line.id || leaving(l) > 0)
        .map((l) => requestLine(l, leaving(l), l.id === line.id ? entries : undefined)),
    }
    const result = await transferTrackingApi.checkDispatch(order.id, payload, line.id)
    const outcome = checkOutcomeFor(line.id, result)
    setWarnings((current) => ({ ...current, [line.id]: outcome.warnings.map((w) => w.message) }))
    return outcome
  }

  /** The discard question is being answered (a ref: read by the same key press that answered it). */
  const asking = useRef(false)

  async function requestClose() {
    if (busy || asking.current) return
    if (typedRows === 0) {
      onClose()
      return
    }
    asking.current = true
    setConfirmOpen(true)
    const discard = await confirm({
      title: 'Close the dialog',
      message: DISCARD_QUESTION,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      danger: true,
    })
    setConfirmOpen(false)
    /* ESCAPE ON THE QUESTION ANSWERS IT, AND ONLY IT: the same key press reaches this dialog's own Escape listener after
       the question's (Mantine closes every open modal), by then re-rendered with Escape allowed again - it would ask
       again at once, and the question could never be left with Escape. Ready again once that key press is over. */
    window.setTimeout(() => {
      asking.current = false
    }, 0)
    if (!discard) return
    clearStoredTracking(order.id)
    onClose()
  }

  /* ── 90's dialog ── */

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
  /* (93) Then the first leaving tracked line that is not complete yet - the database's Seq 12 / 24, word for word. */
  const trackingBlock =
    chosen
      .map((line) => {
        const kind = lineTrackingKind(line)
        return kind ? incompleteSentence(kind, linePrefix(line), tracking[line.id] ?? [], leaving(line)) : null
      })
      .find((sentence) => sentence !== null) ?? null
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
            : trackingBlock

  async function submit() {
    if (blockedBy || !date) return
    setBusy(true)
    setError(null)
    setErrorLine(null)
    const payload: DispatchTransferRequest = {
      rowVersion: order.rowVersion,
      date,
      eta: both ? null : eta,
      referenceNo: reference.trim() || null,
      notes: notes.trim() || null,
      lines: chosen.map((line) => requestLine(line, rows[line.id]!.quantity)),
    }
    try {
      const result = both
        ? await transfersApi.dispatchAndReceive(order.id, payload)
        : await transfersApi.dispatch(order.id, payload)
      clearStoredTracking(order.id)
      notify.success(result.message)
      onPosted(result)
    } catch (err) {
      // Nothing is lost: the rows stay in the dialog (and in the session) for another try.
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
        data-autofocus={line.id === focusLineId ? true : undefined}
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
        w={phone ? '100%' : 110}
      />
    )
  }

  /**
   * (93) "Serial nos.…" / "Batches…" / "Expiry dates…" and the line's state: "18 / 20 serial nos.", "45 / 60 pcs in 2
   * batches" - green with a check when complete, red when not (and pieces leave), "—" when none leave. The button is
   * disabled with its reason (a tooltip; on a phone the line under it) while the restore question waits - typing first
   * would silently throw the rows typed earlier away - and while nothing leaves on the line.
   */
  function trackingCell(line: TransferOrderLineDto) {
    const kind = lineTrackingKind(line)
    if (!kind)
      return (
        <Text fz="sm" c="dimmed">
          —
        </Text>
      )
    const q = leaving(line)
    const entries = tracking[line.id] ?? []
    const complete = entriesComplete(kind, entries, q)
    const blocked =
      restoreOffer && offeredRows > 0
        ? 'Answer Restore or Start again first.'
        : q === 0
          ? 'Type the pieces that leave in Dispatch now first.'
          : null
    const button = (
      <Button
        size="xs"
        variant="light"
        // Each line's button says which line it is to a screen reader (they all read "Serial nos.…").
        aria-label={`${KIND_TEXT[kind].button} line ${line.lineNumber}, ${line.itemCode}`}
        onClick={() => {
          if (!blocked) openTracking(line)
        }}
        disabled={busy}
        // data-disabled rather than disabled: a disabled button swallows the hover the tooltip needs
        data-disabled={blocked ? true : undefined}
        aria-disabled={blocked ? true : undefined}
        data-tracking-open={line.lineNumber}
      >
        {KIND_TEXT[kind].button}
      </Button>
    )
    return (
      <Stack gap={2} align="flex-start">
        {blocked && !phone ? (
          <Tooltip label={blocked} withArrow multiline w={260}>
            {button}
          </Tooltip>
        ) : (
          button
        )}
        {blocked && phone ? (
          <Text fz="xs" c="dimmed" data-tracking-blocked={line.lineNumber}>
            {blocked}
          </Text>
        ) : null}
        {q === 0 ? (
          <Text fz="xs" c="dimmed">
            —
          </Text>
        ) : (
          <Group gap={4} wrap="nowrap" data-tracking-state={complete ? 'complete' : 'incomplete'}>
            {complete ? <IconCheck size={14} color="var(--mantine-color-teal-7)" /> : null}
            <Text fz="xs" fw={600} c={complete ? 'teal.7' : 'red.7'} style={{ whiteSpace: 'nowrap' }}>
              {entriesStateText(kind, entries, q)}
            </Text>
          </Group>
        )}
      </Stack>
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
  const trackingLine = trackingFor === null ? null : (lines.find((l) => l.id === trackingFor) ?? null)
  const trackingKind = trackingLine ? lineTrackingKind(trackingLine) : null
  const shownWarnings = chosen.flatMap((line) => warnings[line.id] ?? [])

  return (
    <>
      <FormModal
        opened={opened}
        title={title}
        onSubmit={() => void submit()}
        onClose={() => void requestClose()}
        saving={busy}
        saveLabel={both ? 'Dispatch and receive' : 'Dispatch'}
        // (93) Wider than 90's xl when a line is tracked: room for the "Batch / serial" column without scrolling.
        size={tracked ? '62rem' : 'xl'}
        fullScreen={phone}
        saveDisabled={blockedBy !== null}
        saveDisabledReason={blockedBy ?? undefined}
        // Escape closes an open calendar first (90); never this dialog under its tracking dialog or question (93).
        closeOnEscape={!calendarOpen && trackingFor === null && !confirmOpen}
      >
        {restoreOffer && offeredRows > 0 ? (
          <Alert color="blue" data-tracking-restore>
            <Group justify="space-between" gap="xs" wrap="wrap">
              <Text fz="sm">Restore the {formatNumber(offeredRows)} rows typed earlier?</Text>
              <Group gap="xs">
                <Button size="xs" onClick={restore}>
                  Restore
                </Button>
                <Button size="xs" variant="default" onClick={startAgain}>
                  Start again
                </Button>
              </Group>
            </Group>
          </Alert>
        ) : null}

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
            popoverProps={calendar('date')}
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
              popoverProps={calendar('eta')}
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
                        Line {formatNumber(line.lineNumber)} · {unitLabel(line.unitName, line.packingFormula)}
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
                  {/* (93) Under "Dispatch now" on a phone. */}
                  {lineTrackingKind(line) ? <Box mt="xs">{trackingCell(line)}</Box> : null}
                </Paper>
              )
            })}
            <Text fz="sm" fw={600} ta="right">
              To dispatch {formatNumber(totalToDispatch)} pcs · Dispatch now {formatNumber(totalPieces)} pcs
            </Text>
          </Stack>
        ) : (
          /* 720: inside the xl dialog's 748 px body at 1440, so no row scrolls sideways (90); a tracked line adds the
             200 px "Batch / serial" column, 920 inside the 62rem dialog's 960 px body (93). */
          <Table.ScrollContainer minWidth={tracked ? 920 : 720}>
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
                  {tracked ? <Table.Th w={200}>Batch / serial</Table.Th> : null}
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
                      {tracked ? <Table.Td>{trackingCell(line)}</Table.Td> : null}
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
                  {tracked ? <Table.Th /> : null}
                </Table.Tr>
              </Table.Tfoot>
            </Table>
          </Table.ScrollContainer>
        )}

        <Text size="sm" fw={500} data-dispatch-summary>
          {formatNumber(chosen.length)} line(s), {formatNumber(totalPieces)} pcs leave {from} for {to}.
        </Text>

        {/* (93) The last Check's warnings, kept with "Keep these numbers": in orange, above the footer. */}
        {shownWarnings.length > 0 ? (
          <Alert color="orange" data-tracking-warnings>
            <Stack gap={2}>
              {shownWarnings.slice(0, 10).map((warning, index) => (
                <Text key={index} fz="sm">
                  {warning}
                </Text>
              ))}
              {shownWarnings.length > 10 ? (
                <Text fz="sm" c="dimmed">
                  and {formatNumber(shownWarnings.length - 10)} more
                </Text>
              ) : null}
            </Stack>
          </Alert>
        ) : null}

        {error && <Alert color="red">{error}</Alert>}
      </FormModal>

      {/* (93) BESIDE the dialog, never inside it: its form never submits this one, and Escape closes it alone. */}
      {trackingLine && trackingKind ? (
        <TrackingModal
          opened
          mode="dispatch"
          kind={trackingKind}
          withExpiry={lineWithExpiry(trackingLine)}
          serialLength={trackingLine.serialLength ?? null}
          title={dispatchTrackingTitle(trackingKind, trackingLine)}
          subtitle={
            trackingKind === 'Serial'
              ? `${formatNumber(leaving(trackingLine))} pcs leave ${from}: one serial no. per piece.`
              : `${formatNumber(leaving(trackingLine))} pcs leave ${from}.`
          }
          quantity={leaving(trackingLine)}
          value={tracking[trackingLine.id] ?? []}
          otherLineSerials={otherLineSerials(trackingLine)}
          known={trackingKind === 'Serial' ? (known[trackingLine.id] ?? null) : null}
          onCheck={(entries) => checkLine(trackingLine, entries)}
          onChange={(entries) => {
            // Kept through a reload while the dialog is open; Cancel puts back what Done left.
            changedInDialog.current = true
            persist({ ...tracking, [trackingLine.id]: entries })
            setRestoreOffer(null)
          }}
          onDone={(entries) => {
            commitTracking(trackingLine.id, entries)
            setTrackingFor(null)
          }}
          onCancel={() => {
            if (changedInDialog.current) persist(tracking)
            setTrackingFor(null)
          }}
        />
      ) : null}
    </>
  )
}

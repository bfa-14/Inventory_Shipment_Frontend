import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { IconBarcode, IconClipboardText, IconListCheck, IconPlus, IconTrash } from '@tabler/icons-react'
import type { TrackingKind } from '../../api/types'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { FormModal } from '../ui/FormModal'
import { ShownRowsFooter } from '../ui/ShownRows'
import { useCalendarEscape } from '../ui/useCalendarEscape'
import { useShownRows } from '../ui/useShownRows'
import {
  entryLost,
  entryPieces,
  normalizeTrackingNo,
  parsePastedRows,
  parsePastedSerials,
  quantityEntry,
  receiptStateText,
  receiptTotals,
  serialEntry,
  unreadSentences,
  type KnownSerials,
  type ReceiptEntry,
  type ReceiptTracking,
  type RestChoice,
  type TrackingCheckOutcome,
  type TrackingEntry,
  type TrackingProblem,
} from './trackingNumbers'

/* ── the props ──────────────────────────────────────────────────────────────────────────────── */

interface CommonProps {
  opened: boolean
  /** "Serial numbers - line 1: TEST93-S". */
  title: string
  /** Under the title: "20 pcs leave LKS-01: one serial no. per piece." */
  subtitle?: string
  kind: TrackingKind
  /** Each piece gives its expiry date (the item requires it; always for the Expiry kind). */
  withExpiry: boolean
  /** Serial items: the exact length of a serial no.; null = any length. */
  serialLength: number | null
  /** Cancel, the X or Escape: every change since the dialog opened is dropped. */
  onCancel(): void
}

/** The numbers of pieces that LEAVE: typed, scanned or pasted, then checked by the server on Done. */
export interface DispatchTrackingProps extends CommonProps {
  mode: 'dispatch'
  /** The pieces that leave on this line ("Dispatch now"): one serial per piece, or the rows' total. */
  quantity: number
  value: TrackingEntry[]
  /** The same item's serials typed on the other lines of the document, and the line each is on. */
  otherLineSerials?: ReadonlyMap<string, number>
  /** Serial numbers the system knows at the place the goods leave: "Known at {place} ({n})…". */
  known?: KnownSerials | null
  /** The server's Check of what is typed (the caller sends the whole document and keeps this line's sentences). */
  onCheck(entries: TrackingEntry[]): Promise<TrackingCheckOutcome>
  /** Every change while the dialog is open: the page keeps the rows through a reload. */
  onChange?(entries: TrackingEntry[]): void
  onDone(entries: TrackingEntry[]): void
}

/** The rows ON THE WAY of one line: what arrived, and for the rest Still coming or Lost. */
export interface ReceiveTrackingProps extends CommonProps {
  mode: 'receive'
  value: ReceiptTracking
  onDone(value: ReceiptTracking): void
}

export type TrackingModalProps = DispatchTrackingProps | ReceiveTrackingProps

/**
 * THE ONE DIALOG FOR BATCH, SERIAL AND EXPIRY NUMBERS (script 93), opened by a line's "Serial nos.…" / "Batches…" /
 * "Expiry dates…" button. GENERIC: it names no transfer - the caller gives the title, the pieces and the Check - so a
 * goods receipt or a sale can ask for the same numbers with it later.
 *
 * RENDERED AS A SIBLING of the dialog that opened it, never inside its children: its form then never submits the
 * other one, and the outer dialog passes `closeOnEscape={false}` while this one is open, so Escape closes this one only
 * (FormModal's options, script 90). Its own date fields follow 90's calendar rule (`useCalendarEscape`): Escape on an
 * open expiry calendar closes the calendar, never this dialog and what was typed in it.
 *
 * WHILE DONE CHECKS, NOTHING CAN BE TYPED (the rows sit in a disabled fieldset): what is committed is what was checked.
 * After a Check that keeps the dialog open, and after every button of a serial list, the cursor goes back to the scan
 * box: a scanner's next code (and its closing Enter) lands there, never on the button that had the focus.
 *
 * THE SCAN BOX CONSUMES ITS ENTER (a scanner ends every code with one): Enter there adds the number and never presses
 * Done, never posts. Done (or Enter in another field) checks with the server when dispatching: errors keep the dialog
 * open with the rows they name outlined; warnings turn the button into "Keep these numbers" (a second click closes).
 */
export function TrackingModal(props: TrackingModalProps) {
  if (props.mode === 'receive') {
    return props.kind === 'Serial' ? <ReceiveSerials {...props} /> : <ReceiveQuantities {...props} />
  }
  return props.kind === 'Serial' ? <DispatchSerials {...props} /> : <DispatchQuantities {...props} />
}

/* ── shared pieces ──────────────────────────────────────────────────────────────────────────── */

const PHONE = '(max-width: 48em)'

/** Splits what a scanner sent on TAB, CR and LF: one number, or a refusal when it held more than one. */
function scannedNumber(raw: string): { value: string | null; several: boolean } {
  const tokens = raw
    .split(/[\t\r\n]+/)
    .map((t) => normalizeTrackingNo(t))
    .filter((t): t is string => t !== null)
  if (tokens.length > 1) return { value: null, several: true }
  return { value: tokens[0] ?? null, several: false }
}

const SCAN_ONE = 'Scan one number at a time, or use Paste list…'

interface ScanBoxProps {
  label: string
  value: string
  onChange(value: string): void
  onScan(raw: string): void
  onRefuse(message: string): void
  counter?: ReactNode
  disabled?: boolean
  /** The dialog puts the cursor back here after its buttons (a scanner types where the focus is). */
  inputRef?: RefObject<HTMLInputElement | null>
}

/**
 * The scan box. Enter is CONSUMED (`preventDefault`): it adds the number and never submits the dialog. A paste holding
 * a tab or a line break with several numbers is refused here ("Scan one number at a time, or use Paste list…").
 */
function ScanBox({ label, value, onChange, onScan, onRefuse, counter, disabled, inputRef }: ScanBoxProps) {
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    onScan(event.currentTarget.value)
  }
  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text')
    if (/[\t\r\n]/.test(text) && scannedNumber(text).several) {
      event.preventDefault()
      onRefuse(SCAN_ONE)
    }
  }
  return (
    <Group gap="sm" align="flex-end" wrap="nowrap">
      <TextInput
        ref={inputRef}
        label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={keyDown}
        onPaste={paste}
        leftSection={<IconBarcode size={16} />}
        autoComplete="off"
        spellCheck={false}
        maxLength={200}
        disabled={disabled}
        style={{ flex: 1, minWidth: 0 }}
        data-autofocus
        data-tracking-scan
      />
      {counter}
    </Group>
  )
}

/** "18 / 20": red until the list holds exactly the pieces. */
function Counter({ count, of }: { count: number; of: number }) {
  const done = count === of && of > 0
  return (
    <Text fz="lg" fw={700} c={done ? 'teal.7' : 'red.7'} pb={4} style={{ whiteSpace: 'nowrap' }} data-tracking-counter>
      {formatNumber(count)} / {formatNumber(of)}
    </Text>
  )
}

/** The rows and every control of a dispatch list: disabled while Done checks them (a native fieldset, no frame). */
const ROWS_FIELDSET: CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0 }

/** The cursor back in the scan box once React has drawn (the box may just have been enabled again). */
function focusLater(ref: RefObject<HTMLInputElement | null>) {
  window.requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }))
}

/** The last Check: errors (and count errors) red at the top, warnings orange. */
function CheckProblems({
  outcome,
  failure,
  anchor,
}: {
  outcome: TrackingCheckOutcome | null
  failure: string | null
  /** Scrolled into view after a Check: a long list would leave the sentences above the fold. */
  anchor: RefObject<HTMLDivElement | null>
}) {
  const errors = outcome ? [...outcome.errors, ...outcome.countErrors] : []
  const warnings = outcome?.warnings ?? []
  /* Only "the rows do not add up yet" (Seq 12 / 24): a second click keeps what is typed, and says so. */
  const countOnly = outcome !== null && outcome.errors.length === 0 && outcome.countErrors.length > 0
  if (errors.length === 0 && warnings.length === 0 && !failure) return <div ref={anchor} />
  return (
    <Stack gap="xs" ref={anchor}>
      {failure ? (
        <Alert color="red" data-tracking-errors>
          {failure}
        </Alert>
      ) : null}
      {errors.length > 0 ? (
        <Alert color="red" data-tracking-errors>
          <ProblemList problems={errors} />
          {countOnly ? (
            <Text fz="xs" c="dimmed" mt={4} data-tracking-keep-hint>
              Keep these numbers closes the dialog with what is typed: nothing is posted until the line is complete.
            </Text>
          ) : null}
        </Alert>
      ) : null}
      {warnings.length > 0 ? (
        <Alert color="orange" data-tracking-warnings>
          <ProblemList problems={warnings} />
        </Alert>
      ) : null}
    </Stack>
  )
}

function ProblemList({ problems }: { problems: TrackingProblem[] }) {
  const shown = problems.slice(0, 20)
  return (
    <Stack gap={2}>
      {shown.map((p, index) => (
        <Text key={index} fz="sm">
          {p.message}
        </Text>
      ))}
      {problems.length > shown.length ? (
        <Text fz="sm" c="dimmed">
          and {formatNumber(problems.length - shown.length)} more
        </Text>
      ) : null}
    </Stack>
  )
}

/** The rows a Check named, by their key in the list as it was sent: red for an error, orange for a warning. */
function outlinedRows(outcome: TrackingCheckOutcome | null, sentKeys: string[]): Map<string, 'red' | 'orange'> {
  const map = new Map<string, 'red' | 'orange'>()
  if (!outcome) return map
  const mark = (problems: TrackingProblem[], colour: 'red' | 'orange') => {
    for (const p of problems) {
      const key = p.rowNumber ? sentKeys[p.rowNumber - 1] : undefined
      if (key && !map.has(key)) map.set(key, colour)
    }
  }
  mark(outcome.errors, 'red')
  mark(outcome.countErrors, 'red')
  mark(outcome.warnings, 'orange')
  return map
}

const outlineStyle = (colour: 'red' | 'orange' | undefined) =>
  colour ? { outline: `2px solid var(--mantine-color-${colour}-6)`, outlineOffset: -2 } : undefined

interface PastePanelProps {
  open: boolean
  description: string
  placeholder: string
  text: string
  onText(text: string): void
  onOpen(): void
  onClose(): void
  onAdd(): void
  note: string[] | null
}

/** "Paste list…" (as the container numbers' paste): a box, then "Add to the list" and what was added or not read. */
function PastePanel({ open, description, placeholder, text, onText, onOpen, onClose, onAdd, note }: PastePanelProps) {
  return (
    <Stack gap={6}>
      {note && note.length > 0 ? (
        <Stack gap={0} data-tracking-paste-note>
          {note.map((line, index) => (
            <Text key={index} fz="xs" c={index === 0 ? undefined : 'orange.8'}>
              {line}
            </Text>
          ))}
        </Stack>
      ) : null}
      {open ? (
        <>
          <Textarea
            label="Paste list"
            description={description}
            placeholder={placeholder}
            autosize
            minRows={4}
            maxRows={12}
            value={text}
            onChange={(event) => onText(event.currentTarget.value)}
            data-tracking-paste
          />
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="default" onClick={onClose}>
              Close
            </Button>
            <Button size="xs" onClick={onAdd} disabled={!text.trim()}>
              Add to the list
            </Button>
          </Group>
        </>
      ) : (
        <Group>
          <Button size="xs" variant="light" leftSection={<IconClipboardText size={14} />} onClick={onOpen}>
            Paste list…
          </Button>
        </Group>
      )}
    </Stack>
  )
}

function ExpiryInput({
  value,
  onChange,
  label,
  required,
  disabled,
  popoverProps,
}: {
  value: string | null
  onChange(value: string | null): void
  label: string
  required?: boolean
  disabled?: boolean
  /** `calendar(name)` of the dialog's `useCalendarEscape`: Escape closes this calendar, not the dialog. */
  popoverProps?: { onOpen(): void; onClose(): void }
}) {
  return (
    <DateInput
      popoverProps={popoverProps}
      aria-label={label}
      placeholder="DD/MM/YYYY"
      valueFormat="DD/MM/YYYY"
      value={fromIsoDate(value)}
      onChange={(next) => onChange(next ? isoDate(next) : null)}
      clearable={!required}
      size="xs"
      w={150}
      disabled={disabled}
    />
  )
}

/** The choice for what did not arrive: Still coming (the default) or Lost. */
function RestControl({
  value,
  onChange,
  label,
  fullWidth,
}: {
  value: RestChoice
  onChange(value: RestChoice): void
  label: string
  fullWidth?: boolean
}) {
  return (
    <SegmentedControl
      size="xs"
      aria-label={label}
      value={value}
      onChange={(next) => onChange(next as RestChoice)}
      data={[
        { value: 'coming', label: 'Still coming' },
        { value: 'lost', label: 'Lost' },
      ]}
      fullWidth={fullWidth}
    />
  )
}

/* ── Dispatch: serial numbers ───────────────────────────────────────────────────────────────── */

function DispatchSerials({
  opened,
  title,
  subtitle,
  withExpiry,
  serialLength,
  quantity,
  value,
  otherLineSerials,
  known,
  onCheck,
  onChange,
  onDone,
  onCancel,
}: DispatchTrackingProps) {
  const phone = useMediaQuery(PHONE)
  const [entries, setEntries] = useState<TrackingEntry[]>(value)
  const [scan, setScan] = useState('')
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [pasteNote, setPasteNote] = useState<string[] | null>(null)
  const [knownOpen, setKnownOpen] = useState(false)
  const [knownFilter, setKnownFilter] = useState('')
  const [knownTicked, setKnownTicked] = useState<Set<string>>(() => new Set())
  const [sameExpiry, setSameExpiry] = useState<string | null>(null)
  /** The date "Apply" gave every serial: the serials scanned after it take it too. */
  const [appliedExpiry, setAppliedExpiry] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<TrackingCheckOutcome | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [sentKeys, setSentKeys] = useState<string[]>([])
  /** The last Check left only warnings (or count errors): the next click keeps the numbers. */
  const [keep, setKeep] = useState(false)
  const [checking, setChecking] = useState(false)
  const problemsRef = useRef<HTMLDivElement>(null)
  const showProblems = () =>
    window.requestAnimationFrame(() => problemsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  const scanRef = useRef<HTMLInputElement>(null)
  const backToScan = () => focusLater(scanRef)
  const { calendarOpen, calendar } = useCalendarEscape()
  /* AFTER A CHECK THAT KEEPS THE DIALOG OPEN, the cursor goes back to the scan box once the rows are enabled again: the
     box sits in the fieldset disabled while the Check runs, and a disabled box cannot take the focus (a frame-timed
     focus raced the re-render and was sometimes lost - the scanner's next code, and its Enter, then went nowhere). */
  const refocusAfterCheck = useRef(false)
  useEffect(() => {
    if (checking || !refocusAfterCheck.current) return
    refocusAfterCheck.current = false
    scanRef.current?.focus({ preventScroll: true })
  }, [checking])

  const others = otherLineSerials ?? EMPTY_MAP
  const inList = useMemo(() => new Set(entries.map((e) => normalizeTrackingNo(e.serialNo))), [entries])

  function update(next: TrackingEntry[]) {
    setEntries(next)
    setKeep(false)
    // A refusal of the last scan says nothing about the list as it is now ("20 serial numbers are already typed" after
    // one was removed): it goes with the change.
    setScanNote(null)
    onChange?.(next)
  }

  /** The local refusals, before the server's: a space inside, twice, on another line, too many, the wrong length. */
  function refusalOf(serial: string, list: Set<string | null>, count: number): string | null {
    if (/\s/.test(serial)) return 'A serial no. has no spaces.'
    if (list.has(serial)) return `${serial} is already in the list.`
    const line = others.get(serial)
    if (line !== undefined) return `${serial} is already on line ${line}.`
    if (count >= quantity)
      return `${formatNumber(quantity)} serial numbers are already typed: remove one, or raise Dispatch now.`
    if (serialLength && serial.length !== serialLength)
      return `${serial} has ${formatNumber(serial.length)} characters; this item's have ${formatNumber(serialLength)}.`
    return null
  }

  function scanned(raw: string) {
    setScan('')
    const { value: serial, several } = scannedNumber(raw)
    if (several) return setScanNote(SCAN_ONE)
    if (!serial) return setScanNote(null)
    const refusal = refusalOf(serial, inList, entries.length)
    if (refusal) return setScanNote(refusal)
    setScanNote(null)
    update([...entries, serialEntry(serial, withExpiry ? appliedExpiry : null)])
  }

  function addPasted() {
    const parsed = parsePastedSerials(pasted, withExpiry)
    const next = [...entries]
    const have = new Set(inList)
    let added = 0
    let twice = 0
    let over = 0
    let elsewhere = 0
    let undated = 0
    for (const row of parsed.rows) {
      if (have.has(row.serialNo)) twice++
      else if (others.has(row.serialNo)) elsewhere++
      else if (next.length >= quantity) over++
      else {
        const expiry = withExpiry ? (row.expiryDate ?? appliedExpiry) : null
        if (withExpiry && !expiry) undated++
        next.push(serialEntry(row.serialNo, expiry))
        have.add(row.serialNo)
        added++
      }
    }
    const note = [
      `${formatNumber(added)} added, ${formatNumber(twice)} already in the list, ${formatNumber(over)} over the ${formatNumber(quantity)} pcs leaving (not added).` +
        (elsewhere > 0 ? ` ${formatNumber(elsewhere)} already on another line (not added).` : '') +
        (undated > 0 ? ` ${formatNumber(undated)} of them have no expiry date yet.` : ''),
      ...unreadSentences(parsed.unread),
    ]
    setPasteNote(note)
    if (added > 0) update(next)
    setPasted('')
    if (parsed.unread.length === 0) {
      setPasteOpen(false)
      backToScan()
    }
  }

  /* "Known at {place} ({n})…": the suggestions not on another line; those already in this list are shown ticked. */
  const knownSerials = useMemo(
    () => (known?.serials ?? []).filter((s) => !others.has(normalizeTrackingNo(s.serialNo) ?? '')),
    [known, others],
  )
  const knownShown = useMemo(() => {
    const wanted = normalizeTrackingNo(knownFilter)
    return (wanted ? knownSerials.filter((s) => s.serialNo.includes(wanted)) : knownSerials).slice(0, 200)
  }, [knownSerials, knownFilter])

  function addKnown() {
    const next = [...entries]
    const have = new Set(inList)
    for (const s of knownSerials) {
      const serial = normalizeTrackingNo(s.serialNo)
      if (!serial || !knownTicked.has(serial) || have.has(serial) || next.length >= quantity) continue
      next.push(serialEntry(serial, withExpiry ? (s.expiryDate ?? appliedExpiry) : null))
      have.add(serial)
    }
    setKnownTicked(new Set())
    setKnownOpen(false)
    update(next)
    backToScan()
  }

  function applySameExpiry() {
    if (!sameExpiry) return
    setAppliedExpiry(sameExpiry)
    update(entries.map((e) => ({ ...e, expiryDate: sameExpiry })))
    backToScan()
  }

  async function done() {
    if (keep || entries.length === 0) {
      onDone(entries)
      return
    }
    setChecking(true)
    setFailure(null)
    try {
      // Nothing can change while it runs (the rows' fieldset is disabled): what is kept is what was checked.
      const result = await onCheck(entries)
      setSentKeys(entries.map((e) => e.key))
      setOutcome(result)
      showProblems()
      if (result.errors.length > 0) {
        refocusAfterCheck.current = true
        return
      }
      if (result.countErrors.length > 0 || result.warnings.length > 0) {
        setKeep(true)
        refocusAfterCheck.current = true
        return
      }
      onDone(entries)
    } catch (err) {
      setOutcome(null)
      setFailure(err instanceof Error && err.message ? err.message : 'The numbers could not be checked.')
      showProblems()
      // The posting checks them again: the next click keeps them.
      setKeep(true)
      refocusAfterCheck.current = true
    } finally {
      setChecking(false)
    }
  }

  const outlined = outlinedRows(outcome, sentKeys)
  // Newest first, so the serial just scanned is always on screen; a row a Check named always shows.
  const newestFirst = useMemo(() => entries.map((e, index) => ({ e, number: index + 1 })).reverse(), [entries])
  const shownRows = useShownRows(newestFirst.length)
  const drawn = newestFirst.filter((row, index) => index < shownRows.limit || outlined.has(row.e.key))

  function patch(key: string, change: Partial<TrackingEntry>) {
    update(entries.map((e) => (e.key === key ? { ...e, ...change } : e)))
  }

  function serialCell(e: TrackingEntry, number: number) {
    return (
      <TextInput
        aria-label={`Serial no., row ${number}`}
        size="xs"
        value={e.serialNo}
        onChange={(event) => patch(e.key, { serialNo: event.currentTarget.value })}
        onBlur={() => {
          // Tidied only when that changes it: a blur alone never undoes "Keep these numbers".
          const tidy = normalizeTrackingNo(e.serialNo) ?? ''
          if (tidy !== e.serialNo) patch(e.key, { serialNo: tidy })
        }}
        maxLength={100}
        spellCheck={false}
        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
      />
    )
  }

  const removeButton = (e: TrackingEntry, number: number) => (
    <ActionIcon
      variant="subtle"
      color="red"
      aria-label={`Remove row ${number}`}
      onClick={() => {
        update(entries.filter((x) => x.key !== e.key))
        backToScan()
      }}
    >
      <IconTrash size={16} />
    </ActionIcon>
  )

  return (
    <FormModal
      opened={opened}
      title={title}
      onSubmit={() => void done()}
      onClose={onCancel}
      saving={checking}
      saveLabel={keep ? 'Keep these numbers' : 'Done'}
      size="xl"
      fullScreen={phone}
      // Escape closes an open expiry calendar, not this dialog (90's rule)
      closeOnEscape={!calendarOpen}
    >
      {subtitle ? <Text fz="sm">{subtitle}</Text> : null}
      <CheckProblems outcome={outcome} failure={failure} anchor={problemsRef} />

      <fieldset disabled={checking} style={ROWS_FIELDSET}>
        <Stack gap="md">
          <Stack gap={4}>
            <ScanBox
              label="Scan or type a serial no. and press Enter"
              value={scan}
              onChange={(next) => {
                setScan(next)
                if (scanNote) setScanNote(null)
              }}
              onScan={scanned}
              onRefuse={setScanNote}
              counter={<Counter count={entries.length} of={quantity} />}
              inputRef={scanRef}
            />
            {/* Said to a screen reader too: the scanner's user is not looking at the screen. */}
            <Box aria-live="assertive" aria-atomic="true">
              {scanNote ? (
                <Text fz="sm" c="red.7" data-tracking-scan-note>
                  {scanNote}
                </Text>
              ) : null}
            </Box>
          </Stack>

          <Group gap="sm" align="flex-start" wrap="wrap">
            <Box style={{ flex: '1 1 260px', minWidth: 0 }}>
              <PastePanel
                open={pasteOpen}
                description={`One serial no. per line, or separated by commas, semicolons or spaces${withExpiry ? ', followed by its expiry date (DD/MM/YYYY)' : ''}.`}
                placeholder={withExpiry ? 'MD626AE1XR1T00001 31/03/2027\nMD626AE1XR1T00002 31/03/2027' : 'MD626AE1XR1T00001\nMD626AE1XR1T00002'}
                text={pasted}
                onText={setPasted}
                onOpen={() => setPasteOpen(true)}
                onClose={() => {
                  setPasteOpen(false)
                  backToScan()
                }}
                onAdd={addPasted}
                note={pasteNote}
              />
            </Box>
            {known && knownSerials.length > 0 && !knownOpen ? (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconListCheck size={14} />}
                onClick={() => setKnownOpen(true)}
                data-tracking-known
              >
                {known.title} ({formatNumber(knownSerials.length)})…
              </Button>
            ) : null}
          </Group>

          {known && knownOpen ? (
            <Paper withBorder radius="md" p="sm" data-tracking-known-panel>
              <Stack gap="xs">
                <Group justify="space-between" wrap="wrap" gap="xs">
                  <Text fz="sm" fw={600}>
                    {known.title} ({formatNumber(knownSerials.length)})
                  </Text>
                  <TextInput
                    size="xs"
                    placeholder="Find a number"
                    aria-label="Find a number"
                    value={knownFilter}
                    onChange={(event) => setKnownFilter(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.preventDefault()
                    }}
                    w={phone ? '100%' : 220}
                  />
                </Group>
                <ScrollArea.Autosize mah={240}>
                  <Stack gap={6}>
                    {knownShown.map((s) => {
                      const serial = normalizeTrackingNo(s.serialNo) ?? s.serialNo
                      const already = inList.has(serial)
                      return (
                        <Checkbox
                          key={serial}
                          label={serial}
                          description={already ? 'In the list' : s.text}
                          checked={already || knownTicked.has(serial)}
                          disabled={already}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked
                            setKnownTicked((current) => {
                              const next = new Set(current)
                              if (checked) next.add(serial)
                              else next.delete(serial)
                              return next
                            })
                          }}
                        />
                      )
                    })}
                    {knownShown.length === 0 ? (
                      <Text fz="xs" c="dimmed">
                        No number matches.
                      </Text>
                    ) : null}
                  </Stack>
                </ScrollArea.Autosize>
                <Group justify="flex-end" gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => {
                      setKnownOpen(false)
                      backToScan()
                    }}
                  >
                    Close
                  </Button>
                  <Button size="xs" onClick={addKnown} disabled={knownTicked.size === 0}>
                    Add the ticked
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ) : null}

          {withExpiry ? (
            <Group gap="xs" align="center" wrap="wrap">
              <Text fz="sm">Same expiry for every serial:</Text>
              <ExpiryInput
                value={sameExpiry}
                onChange={setSameExpiry}
                label="Same expiry for every serial"
                popoverProps={calendar('same')}
              />
              <Button
                size="xs"
                variant="light"
                onClick={applySameExpiry}
                disabled={!sameExpiry || entries.length === 0}
              >
                Apply
              </Button>
            </Group>
          ) : null}

          {entries.length === 0 ? (
            <Text fz="sm" c="dimmed" ta="center" py="md">
              No serial no. yet: scan the first one.
            </Text>
          ) : phone ? (
            <Stack gap="xs">
              {drawn.map(({ e, number }) => (
                <Paper key={e.key} withBorder radius="md" p="xs" style={outlineStyle(outlined.get(e.key))}>
                  <Group gap="xs" wrap="nowrap" align="flex-start">
                    <Text fz="xs" c="dimmed" w={32} pt={6}>
                      {formatNumber(number)}
                    </Text>
                    <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                      {serialCell(e, number)}
                      {withExpiry ? (
                        <ExpiryInput
                          value={e.expiryDate}
                          onChange={(next) => patch(e.key, { expiryDate: next })}
                          label={`Expiry, row ${number}`}
                          required
                          popoverProps={calendar(e.key)}
                        />
                      ) : null}
                    </Stack>
                    {removeButton(e, number)}
                  </Group>
                </Paper>
              ))}
            </Stack>
          ) : (
            <ScrollArea.Autosize mah={400}>
              <Table verticalSpacing={4} striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={56}>#</Table.Th>
                    <Table.Th>Serial no.</Table.Th>
                    {withExpiry ? <Table.Th w={170}>Expiry</Table.Th> : null}
                    <Table.Th w={44} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {drawn.map(({ e, number }) => (
                    <Table.Tr key={e.key} style={outlineStyle(outlined.get(e.key))} data-tracking-row={number}>
                      <Table.Td>{formatNumber(number)}</Table.Td>
                      <Table.Td>{serialCell(e, number)}</Table.Td>
                      {withExpiry ? (
                        <Table.Td>
                          <ExpiryInput
                            value={e.expiryDate}
                            onChange={(next) => patch(e.key, { expiryDate: next })}
                            label={`Expiry, row ${number}`}
                            required
                            popoverProps={calendar(e.key)}
                          />
                        </Table.Td>
                      ) : null}
                      <Table.Td>{removeButton(e, number)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
          <ShownRowsFooter
            limit={shownRows.limit}
            total={newestFirst.length}
            noun="serial numbers"
            more={shownRows.more}
            all={shownRows.all}
          />
        </Stack>
      </fieldset>
    </FormModal>
  )
}

const EMPTY_MAP: ReadonlyMap<string, number> = new Map()

/* ── Dispatch: batches and expiry dates ─────────────────────────────────────────────────────── */

function DispatchQuantities({
  opened,
  title,
  subtitle,
  kind,
  withExpiry,
  quantity,
  value,
  onCheck,
  onChange,
  onDone,
  onCancel,
}: DispatchTrackingProps) {
  const phone = useMediaQuery(PHONE)
  const batch = kind === 'Batch'
  // An expiry row always has its date; a batch row when the item requires it.
  const dateRequired = !batch || withExpiry
  /* FIRST OPENED: one row holding every piece that leaves - the usual case is one batch. */
  const [entries, setEntries] = useState<TrackingEntry[]>(() =>
    value.length > 0 ? value : [quantityEntry('', null, Math.max(1, quantity))],
  )
  /** The row made on opening is still untouched: a pasted list replaces it rather than adding to it. */
  const [pristine, setPristine] = useState(value.length === 0)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [pasteNote, setPasteNote] = useState<string[] | null>(null)
  const [outcome, setOutcome] = useState<TrackingCheckOutcome | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [sentKeys, setSentKeys] = useState<string[]>([])
  const [keep, setKeep] = useState(false)
  const [checking, setChecking] = useState(false)
  const problemsRef = useRef<HTMLDivElement>(null)
  const showProblems = () =>
    window.requestAnimationFrame(() => problemsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  const { calendarOpen, calendar } = useCalendarEscape()

  function update(next: TrackingEntry[]) {
    setEntries(next)
    setPristine(false)
    setKeep(false)
    onChange?.(next)
  }

  function patch(key: string, change: Partial<TrackingEntry>) {
    update(entries.map((e) => (e.key === key ? { ...e, ...change } : e)))
  }

  const sum = entryPieces(kind, entries)
  const missing = quantity - sum

  function addRow() {
    update([...entries, quantityEntry('', null, Math.max(1, missing))])
  }

  /** "Put the rest here": the last row takes what is missing (never below 1). */
  function restHere() {
    const last = entries[entries.length - 1]
    if (!last) return
    const current = typeof last.quantity === 'number' ? last.quantity : 0
    patch(last.key, { quantity: Math.max(1, current + missing) })
  }

  /* A pasted batch already listed gets its pcs added (an expiry date already listed, the same). */
  function addPasted() {
    const parsed = parsePastedRows(pasted, batch ? 'Batch' : 'Expiry', withExpiry)
    const next = pristine ? [] : entries.map((e) => ({ ...e }))
    let added = 0
    let merged = 0
    for (const row of parsed.rows) {
      const same = next.find((e) =>
        batch ? normalizeTrackingNo(e.batchNo) === row.batchNo : e.expiryDate !== null && e.expiryDate === row.expiryDate,
      )
      if (same) {
        same.quantity = (typeof same.quantity === 'number' ? same.quantity : 0) + row.quantity
        if (!same.expiryDate && row.expiryDate) same.expiryDate = row.expiryDate
        merged++
      } else {
        next.push(quantityEntry(row.batchNo ?? '', row.expiryDate, row.quantity))
        added++
      }
    }
    setPasteNote([
      `${formatNumber(added)} added, ${formatNumber(merged)} added to a row already in the list.` +
        (parsed.missingExpiry > 0 ? ` ${formatNumber(parsed.missingExpiry)} of them have no expiry date yet.` : ''),
      ...unreadSentences(parsed.unread),
    ])
    if (added + merged > 0) update(next)
    setPasted('')
    if (parsed.unread.length === 0) setPasteOpen(false)
  }

  async function done() {
    const sent = entries
    if (keep || sent.length === 0) {
      onDone(sent)
      return
    }
    setChecking(true)
    setFailure(null)
    try {
      // Nothing can change while it runs (the rows' fieldset is disabled): what is kept is what was checked.
      const result = await onCheck(sent)
      setSentKeys(sent.map((e) => e.key))
      setOutcome(result)
      showProblems()
      if (result.errors.length > 0) return
      if (result.countErrors.length > 0 || result.warnings.length > 0) {
        setKeep(true)
        return
      }
      onDone(sent)
    } catch (err) {
      setOutcome(null)
      setFailure(err instanceof Error && err.message ? err.message : 'The rows could not be checked.')
      showProblems()
      setKeep(true)
    } finally {
      setChecking(false)
    }
  }

  const outlined = outlinedRows(outcome, sentKeys)
  const expiryLabel = dateRequired ? 'Expiry' : 'Expiry (optional)'
  const complete = sum === quantity && quantity > 0

  function batchCell(e: TrackingEntry, number: number) {
    return (
      <TextInput
        aria-label={`Batch no., row ${number}`}
        size="xs"
        value={e.batchNo}
        onChange={(event) => patch(e.key, { batchNo: event.currentTarget.value })}
        onBlur={() => {
          // Tidied only when that changes it: a blur alone never undoes "Keep these numbers".
          const tidy = normalizeTrackingNo(e.batchNo) ?? ''
          if (tidy !== e.batchNo) patch(e.key, { batchNo: tidy })
        }}
        maxLength={100}
        spellCheck={false}
      />
    )
  }

  function piecesCell(e: TrackingEntry, number: number, last: boolean) {
    return (
      <Group gap={6} wrap="nowrap">
        <NumberInput
          aria-label={`Pcs, row ${number}`}
          size="xs"
          value={e.quantity}
          onChange={(next) => {
            const n = numberInputValue(next)
            patch(e.key, { quantity: n === null ? '' : Math.trunc(n) })
          }}
          min={1}
          allowDecimal={false}
          allowNegative={false}
          thousandSeparator=","
          w={100}
        />
        {last && missing !== 0 ? (
          <Anchor component="button" type="button" fz="xs" onClick={restHere} style={{ whiteSpace: 'nowrap' }}>
            Put the rest here
          </Anchor>
        ) : null}
      </Group>
    )
  }

  const removeButton = (e: TrackingEntry, number: number) => (
    <ActionIcon
      variant="subtle"
      color="red"
      aria-label={`Remove row ${number}`}
      onClick={() => update(entries.filter((x) => x.key !== e.key))}
    >
      <IconTrash size={16} />
    </ActionIcon>
  )

  return (
    <FormModal
      opened={opened}
      title={title}
      onSubmit={() => void done()}
      onClose={onCancel}
      saving={checking}
      saveLabel={keep ? 'Keep these numbers' : 'Done'}
      size="xl"
      fullScreen={phone}
      // Escape closes an open expiry calendar, not this dialog (90's rule)
      closeOnEscape={!calendarOpen}
    >
      {subtitle ? <Text fz="sm">{subtitle}</Text> : null}
      <CheckProblems outcome={outcome} failure={failure} anchor={problemsRef} />

      <fieldset disabled={checking} style={ROWS_FIELDSET}>
        <Stack gap="md">
          {phone ? (
            <Stack gap="xs">
              {entries.map((e, index) => (
                <Paper key={e.key} withBorder radius="md" p="xs" style={outlineStyle(outlined.get(e.key))}>
                  <Group justify="space-between" wrap="nowrap" mb={4}>
                    <Text fz="xs" c="dimmed">
                      Row {formatNumber(index + 1)}
                    </Text>
                    {removeButton(e, index + 1)}
                  </Group>
                  <Stack gap={6}>
                    {batch ? (
                      <Box>
                        <Text fz="xs" c="dimmed">
                          Batch no.
                        </Text>
                        {batchCell(e, index + 1)}
                      </Box>
                    ) : null}
                    <Box>
                      <Text fz="xs" c="dimmed">
                        {expiryLabel}
                      </Text>
                      <ExpiryInput
                        value={e.expiryDate}
                        onChange={(next) => patch(e.key, { expiryDate: next })}
                        label={`${expiryLabel}, row ${index + 1}`}
                        required={dateRequired}
                        popoverProps={calendar(e.key)}
                      />
                    </Box>
                    <Box>
                      <Text fz="xs" c="dimmed">
                        Pcs
                      </Text>
                      {piecesCell(e, index + 1, index === entries.length - 1)}
                    </Box>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          ) : (
            <ScrollArea.Autosize mah={400}>
              <Table verticalSpacing={4} striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={48}>#</Table.Th>
                    {batch ? <Table.Th>Batch no.</Table.Th> : null}
                    <Table.Th w={170}>{expiryLabel}</Table.Th>
                    <Table.Th w={batch ? 220 : undefined}>Pcs</Table.Th>
                    <Table.Th w={44} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {entries.map((e, index) => (
                    <Table.Tr key={e.key} style={outlineStyle(outlined.get(e.key))} data-tracking-row={index + 1}>
                      <Table.Td>{formatNumber(index + 1)}</Table.Td>
                      {batch ? <Table.Td>{batchCell(e, index + 1)}</Table.Td> : null}
                      <Table.Td>
                        <ExpiryInput
                          value={e.expiryDate}
                          onChange={(next) => patch(e.key, { expiryDate: next })}
                          label={`${expiryLabel}, row ${index + 1}`}
                          required={dateRequired}
                          popoverProps={calendar(e.key)}
                        />
                      </Table.Td>
                      <Table.Td>{piecesCell(e, index + 1, index === entries.length - 1)}</Table.Td>
                      <Table.Td>{removeButton(e, index + 1)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}

          <Group justify="space-between" wrap="wrap" gap="xs">
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addRow}>
              Add a row
            </Button>
            <Text fz="sm" fw={700} c={complete ? 'teal.7' : 'red.7'} data-tracking-total>
              {formatNumber(sum)} / {formatNumber(quantity)} pcs
            </Text>
          </Group>

          <PastePanel
            open={pasteOpen}
            description={
              batch
                ? 'One row per line: batch no., expiry date (DD/MM/YYYY) and pcs, separated by tabs (copied from Excel), semicolons or commas.'
                : 'One row per line: expiry date and pcs, separated by tabs (copied from Excel), semicolons or commas.'
            }
            placeholder={batch ? 'B2410-07\t31/03/2027\t40\nB2411-02\t30/06/2027\t20' : '31/01/2027\t20\n28/02/2027\t10'}
            text={pasted}
            onText={setPasted}
            onOpen={() => setPasteOpen(true)}
            onClose={() => setPasteOpen(false)}
            onAdd={addPasted}
            note={pasteNote}
          />
        </Stack>
      </fieldset>
    </FormModal>
  )
}

/* ── Receive: serial numbers ────────────────────────────────────────────────────────────────── */

function ReceiveSerials({ opened, title, subtitle, value, onDone, onCancel }: ReceiveTrackingProps) {
  const phone = useMediaQuery(PHONE)
  const [entries, setEntries] = useState<ReceiptEntry[]>(value.entries)
  /** A scan session ticks only what is scanned: started by the first scan, kept when the dialog is opened again. */
  const [scanning, setScanning] = useState(value.scanning)
  const [scan, setScan] = useState('')
  const [scanNote, setScanNote] = useState<{ text: string; error: boolean } | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  const backToScan = () => focusLater(scanRef)

  const withExpiry = entries.some((e) => e.expiryDate !== null)
  const totals = receiptTotals(entries)
  const notTicked = entries.filter((e) => e.received === 0)
  const notTickedComing = notTicked.filter((e) => e.rest === 'coming').length

  function scanned(raw: string) {
    setScan('')
    const { value: serial, several } = scannedNumber(raw)
    if (several) return setScanNote({ text: SCAN_ONE, error: true })
    if (!serial) return setScanNote(null)
    const hit = entries.find((e) => normalizeTrackingNo(e.serialNo) === serial)
    if (!hit) return setScanNote({ text: `${serial} is not on the way on this line.`, error: true })
    if (!scanning) {
      // THE FIRST SCAN STARTS THE SESSION: whatever was not scanned is unticked, then each scan ticks one.
      setScanning(true)
      setEntries(entries.map((e) => ({ ...e, received: e.id === hit.id ? 1 : 0 })))
      setScanNote(null)
      return
    }
    if (hit.received === 1) return setScanNote({ text: `${serial} is already ticked.`, error: false })
    setEntries(entries.map((e) => (e.id === hit.id ? { ...e, received: 1 } : e)))
    setScanNote(null)
  }

  const setAll = (received: number) => {
    setEntries(entries.map((e) => ({ ...e, received })))
    backToScan()
  }
  const patch = (id: number, change: Partial<ReceiptEntry>) =>
    setEntries(entries.map((e) => (e.id === id ? { ...e, ...change } : e)))

  const shownRows = useShownRows(entries.length)
  const drawn = entries.slice(0, shownRows.limit)

  const tick = (e: ReceiptEntry) => (
    <Checkbox
      aria-label={`Arrived: ${e.serialNo ?? ''}`}
      checked={e.received === 1}
      onChange={(event) => patch(e.id, { received: event.currentTarget.checked ? 1 : 0 })}
    />
  )
  const rest = (e: ReceiptEntry, fullWidth?: boolean) =>
    e.received === 0 ? (
      <RestControl
        value={e.rest}
        onChange={(next) => patch(e.id, { rest: next })}
        label={`What became of ${e.serialNo ?? ''}`}
        fullWidth={fullWidth}
      />
    ) : null

  return (
    <FormModal
      opened={opened}
      title={title}
      onSubmit={() => onDone({ entries, scanning })}
      onClose={onCancel}
      saveLabel="Done"
      size="xl"
      fullScreen={phone}
    >
      {subtitle ? <Text fz="sm">{subtitle}</Text> : null}

      <Stack gap={4}>
        <ScanBox
          label="Scan or type a serial no. and press Enter"
          value={scan}
          onChange={(next) => {
            setScan(next)
            if (scanNote) setScanNote(null)
          }}
          onScan={scanned}
          onRefuse={(text) => setScanNote({ text, error: true })}
          counter={<Counter count={totals.arrived} of={entries.length} />}
          inputRef={scanRef}
        />
        {/* Said to a screen reader too: the scanner's user is not looking at the screen. */}
        <Box aria-live="polite" aria-atomic="true">
          {scanning ? (
            <Text fz="xs" c="dimmed" data-tracking-scanning>
              Scanning: only the serial numbers you scan are ticked.
            </Text>
          ) : null}
        </Box>
        <Box aria-live="assertive" aria-atomic="true">
          {scanNote ? (
            <Text fz="sm" c={scanNote.error ? 'red.7' : 'dimmed'} data-tracking-scan-note>
              {scanNote.text}
            </Text>
          ) : null}
        </Box>
      </Stack>

      <Group gap="xs" wrap="wrap">
        <Button size="xs" variant="default" onClick={() => setAll(1)}>
          Tick all
        </Button>
        <Button size="xs" variant="default" onClick={() => setAll(0)}>
          Untick all
        </Button>
        {notTickedComing > 0 ? (
          <Button
            size="xs"
            variant="light"
            color="red"
            onClick={() => {
              setEntries(entries.map((e) => (e.received === 0 ? { ...e, rest: 'lost' } : e)))
              backToScan()
            }}
          >
            Mark the {formatNumber(notTickedComing)} not ticked as lost
          </Button>
        ) : null}
      </Group>

      {phone ? (
        <Stack gap="xs">
          {drawn.map((e) => (
            <Paper key={e.id} withBorder radius="md" p="xs">
              <Group gap="xs" wrap="nowrap">
                {tick(e)}
                <Box style={{ minWidth: 0 }}>
                  <Text fz="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
                    {e.serialNo}
                  </Text>
                  {e.expiryDate ? (
                    <Text fz="xs" c="dimmed">
                      Expiry {dateLabel(e.expiryDate)}
                    </Text>
                  ) : null}
                </Box>
              </Group>
              {e.received === 0 ? <Box mt={6}>{rest(e, true)}</Box> : null}
            </Paper>
          ))}
        </Stack>
      ) : (
        <ScrollArea.Autosize mah={400}>
          <Table verticalSpacing={4} striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36} />
                <Table.Th w={56}>#</Table.Th>
                <Table.Th>Serial no.</Table.Th>
                {withExpiry ? <Table.Th w={120}>Expiry</Table.Th> : null}
                <Table.Th w={220}>Did not arrive</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {drawn.map((e) => (
                <Table.Tr key={e.id} data-tracking-row={e.rowNumber}>
                  <Table.Td>{tick(e)}</Table.Td>
                  <Table.Td>{formatNumber(e.rowNumber)}</Table.Td>
                  <Table.Td>
                    <Text fz="sm" ff="monospace">
                      {e.serialNo}
                    </Text>
                  </Table.Td>
                  {withExpiry ? <Table.Td>{dateLabel(e.expiryDate)}</Table.Td> : null}
                  <Table.Td>{rest(e)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
      <ShownRowsFooter
        limit={shownRows.limit}
        total={entries.length}
        noun="serial numbers"
        more={shownRows.more}
        all={shownRows.all}
      />

      <Text fz="sm" fw={600} data-tracking-receipt-summary>
        {receiptStateText(totals)}
      </Text>
    </FormModal>
  )
}

/* ── Receive: batches and expiry dates ──────────────────────────────────────────────────────── */

function ReceiveQuantities({ opened, title, subtitle, kind, value, onDone, onCancel }: ReceiveTrackingProps) {
  const phone = useMediaQuery(PHONE)
  const batch = kind === 'Batch'
  const [entries, setEntries] = useState<ReceiptEntry[]>(value.entries)
  const totals = receiptTotals(entries)

  const patch = (id: number, change: Partial<ReceiptEntry>) =>
    setEntries(entries.map((e) => (e.id === id ? { ...e, ...change } : e)))

  const name = (e: ReceiptEntry) =>
    batch ? `Batch ${e.batchNo ?? ''}` : `Expiry ${dateLabel(e.expiryDate)}`
  const above = entries.find((e) => e.received > e.onTheWay)
  const blockedBy = above
    ? `${name(above)}: ${formatNumber(above.received)} pcs received but only ${formatNumber(above.onTheWay)} are on the way.`
    : null

  function receivedInput(e: ReceiptEntry) {
    const over = e.received > e.onTheWay
    return (
      <NumberInput
        aria-label={`Received now, ${name(e)}`}
        size="xs"
        value={e.received}
        onChange={(next) => patch(e.id, { received: Math.max(0, Math.trunc(numberInputValue(next) ?? 0)) })}
        min={0}
        allowDecimal={false}
        allowNegative={false}
        thousandSeparator=","
        description={over ? `Max ${formatNumber(e.onTheWay)}` : undefined}
        styles={over ? { description: { color: 'var(--mantine-color-red-7)', fontWeight: 600 } } : undefined}
        error={over}
        inputWrapperOrder={['label', 'description', 'input', 'error']}
        w={phone ? '100%' : 110}
      />
    )
  }

  const rest = (e: ReceiptEntry, fullWidth?: boolean) =>
    e.received < e.onTheWay ? (
      <Group gap={6} wrap="nowrap">
        <Text fz="xs" c="dimmed">
          Rest:
        </Text>
        <RestControl
          value={e.rest}
          onChange={(next) => patch(e.id, { rest: next })}
          label={`What became of the rest of ${name(e)}`}
          fullWidth={fullWidth}
        />
        {e.rest === 'lost' ? (
          <Badge size="sm" color="red" variant="light" style={{ textTransform: 'none' }}>
            {formatNumber(entryLost(e))} lost
          </Badge>
        ) : null}
      </Group>
    ) : null

  return (
    <FormModal
      opened={opened}
      title={title}
      onSubmit={() => onDone({ entries, scanning: false })}
      onClose={onCancel}
      saveLabel="Done"
      size="xl"
      fullScreen={phone}
      saveDisabled={blockedBy !== null}
      saveDisabledReason={blockedBy ?? undefined}
    >
      {subtitle ? <Text fz="sm">{subtitle}</Text> : null}
      {phone ? (
        <Stack gap="xs">
          {entries.map((e) => (
            <Paper key={e.id} withBorder radius="md" p="xs">
              <Text fz="sm" fw={600}>
                {batch ? `${e.batchNo ?? ''}${e.expiryDate ? ` · exp. ${dateLabel(e.expiryDate)}` : ''}` : `Expiry ${dateLabel(e.expiryDate)}`}
              </Text>
              <Text fz="xs" c="dimmed">
                On the way {formatNumber(e.onTheWay)} pcs
              </Text>
              <Box mt={6}>
                <Text fz="xs" c="dimmed">
                  Received now
                </Text>
                {receivedInput(e)}
              </Box>
              {e.received < e.onTheWay ? <Box mt={6}>{rest(e, true)}</Box> : null}
            </Paper>
          ))}
        </Stack>
      ) : (
        <ScrollArea.Autosize mah={400}>
          <Table verticalSpacing={4} striped>
            <Table.Thead>
              <Table.Tr>
                {batch ? <Table.Th>Batch</Table.Th> : null}
                <Table.Th w={120}>Expiry</Table.Th>
                <Table.Th w={100} ta="right">
                  On the way
                </Table.Th>
                <Table.Th w={130}>Received now</Table.Th>
                <Table.Th w={300} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((e) => (
                <Table.Tr key={e.id} data-tracking-row={e.rowNumber}>
                  {batch ? (
                    <Table.Td>
                      <Text fz="sm" fw={500}>
                        {e.batchNo}
                      </Text>
                    </Table.Td>
                  ) : null}
                  <Table.Td>{dateLabel(e.expiryDate)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(e.onTheWay)}</Table.Td>
                  <Table.Td>{receivedInput(e)}</Table.Td>
                  <Table.Td>{rest(e)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
      <Text fz="sm" fw={600} data-tracking-receipt-summary>
        {receiptStateText(totals)}
      </Text>
    </FormModal>
  )
}

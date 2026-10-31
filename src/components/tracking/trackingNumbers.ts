import type { TrackingKind, TrackingMode } from '../../api/types'
/* The two helpers are imported WITH their extension so that `node --test` (scripts/tests/) can load this file as it
   is; Vite and tsc read it the same way (allowImportingTsExtensions). Neither imports anything itself. */
import { formatNumber } from '../format.ts'
import { parseTypedDate } from '../typedDate.ts'

/*
 * BATCH, SERIAL AND EXPIRY NUMBERS (script 93): the words, the shapes and the small rules every tracking screen shares.
 *
 * GENERIC ON PURPOSE. Nothing here names a transfer: a goods receipt, a sale or an Inventory In that one day asks for
 * the same numbers reuses this file, TrackingModal, TrackingView and TrackingBadge as they are. The RULES (format,
 * length, duplicates, sums, "already on the way") are the database's - one function, read by the dialog's Check and by
 * the posting; the client only mirrors what it must say before the click (a counter, a full list, a duplicate).
 */

/* ── the kinds and their words ──────────────────────────────────────────────────────────────── */

/** K(i), as the database writes it inline: Serial numbers → Serial, Batch numbers → Batch, else Expiry when required. */
export function trackingKindOf(
  trackingMode: TrackingMode | null | undefined,
  requiresExpiry: boolean | null | undefined,
): TrackingKind | null {
  if (trackingMode === 'Serial') return 'Serial'
  if (trackingMode === 'Batch') return 'Batch'
  return requiresExpiry ? 'Expiry' : null
}

export interface TrackingKindText {
  /** The button that opens the dialog: "Serial nos.…". Never "Details…" (that word is the header's). */
  button: string
  /** One and many: "1 serial no." / "20 serial nos.". */
  one: string
  many: string
  /** What a dialog asks for, in a sentence: "Dispatch… asks for the serial numbers of these pieces." */
  ask: string
  /** The dialog's title word: "Serial numbers - line 1: TEST93-S". */
  title: string
  /** The badge, and the badge of an item that also requires an expiry date. */
  badge: string
  badgeWithExpiry: string
  /** Mantine colour of the badge. */
  colour: string
}

export const KIND_TEXT: Record<TrackingKind, TrackingKindText> = {
  Serial: {
    button: 'Serial nos.…',
    one: 'serial no.',
    many: 'serial nos.',
    ask: 'serial numbers',
    title: 'Serial numbers',
    badge: 'Serial nos.',
    badgeWithExpiry: 'Serial nos. + expiry',
    colour: 'grape',
  },
  Batch: {
    button: 'Batches…',
    one: 'batch',
    many: 'batches',
    ask: 'batches',
    title: 'Batches',
    badge: 'Batches',
    badgeWithExpiry: 'Batches + expiry',
    colour: 'cyan',
  },
  Expiry: {
    button: 'Expiry dates…',
    one: 'expiry date',
    many: 'expiry dates',
    ask: 'expiry dates',
    title: 'Expiry dates',
    badge: 'Expiry dates',
    // An expiry-only item has nothing else: its badge already says it.
    badgeWithExpiry: 'Expiry dates',
    colour: 'yellow',
  },
}

/** "1 serial no." / "20 serial nos." / "2 batches" / "1 expiry date". */
export function kindCount(kind: TrackingKind, count: number): string {
  const text = KIND_TEXT[kind]
  return `${formatNumber(count)} ${count === 1 ? text.one : text.many}`
}

/** The badge's words: "Serial nos.", "Batches + expiry", "Expiry dates". */
export function kindBadgeText(kind: TrackingKind, withExpiry: boolean): string {
  const text = KIND_TEXT[kind]
  return withExpiry ? text.badgeWithExpiry : text.badge
}

/** "Tracking: Serial numbers (17 characters) · expiry date required" - Item Definition in view mode. */
export function trackingSummary(
  trackingMode: TrackingMode | null | undefined,
  requiresExpiry: boolean | null | undefined,
  serialLength: number | null | undefined,
): string {
  const mode = trackingMode ?? 'None'
  const name = mode === 'Serial' ? 'Serial numbers' : mode === 'Batch' ? 'Batch numbers' : 'None'
  const length = mode === 'Serial' && serialLength ? ` (${formatNumber(serialLength)} characters)` : ''
  return `Tracking: ${name}${length}${requiresExpiry ? ' · expiry date required' : ''}`
}

/* ── a number as the server keeps it ────────────────────────────────────────────────────────── */

/** What the database trims from BOTH ENDS of a number, and only there: tab, LF, CR, no-break space, BOM, space. */
const EDGE = new Set(['\t', '\n', '\r', ' ', '﻿', ' '])

/**
 * THE SERVER'S RULE (inventory.fn_TrackingNo_Normalize): those characters cut from both ends only, then capitals; an
 * empty result is null. One left INSIDE stays, so the server can refuse it with its own sentence (a pasted "serial TAB
 * expiry" must never glue into one serial).
 */
export function normalizeTrackingNo(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null
  let start = 0
  let end = text.length
  while (start < end && EDGE.has(text[start] as string)) start++
  while (end > start && EDGE.has(text[end - 1] as string)) end--
  const value = text.slice(start, end).toUpperCase()
  return value === '' ? null : value
}

/* ── the rows a dispatch line carries ───────────────────────────────────────────────────────── */

/**
 * One row of a dialog, whatever the kind: a serial (quantity 1), a batch (batch no., expiry, pcs) or an expiry date
 * (expiry, pcs). The numbers are kept as TYPED until they leave (the server normalises): the cells normalise on blur.
 */
export interface TrackingEntry {
  /** Stable across renders; never sent. */
  key: string
  serialNo: string
  batchNo: string
  /** yyyy-MM-dd. */
  expiryDate: string | null
  /** Pieces: 1 for a serial; '' while a Pcs box is emptied. */
  quantity: number | ''
}

let keySeed = 0
export const nextEntryKey = () => `tracking-row-${++keySeed}`

export function serialEntry(serialNo: string, expiryDate: string | null = null): TrackingEntry {
  return { key: nextEntryKey(), serialNo, batchNo: '', expiryDate, quantity: 1 }
}

export function quantityEntry(batchNo: string, expiryDate: string | null, quantity: number | ''): TrackingEntry {
  return { key: nextEntryKey(), serialNo: '', batchNo, expiryDate, quantity }
}

/** The pieces a list holds: the serials counted one each, the other kinds summed. */
export function entryPieces(kind: TrackingKind, entries: readonly TrackingEntry[]): number {
  if (kind === 'Serial') return entries.length
  return entries.reduce((sum, e) => sum + (typeof e.quantity === 'number' ? e.quantity : 0), 0)
}

/** The list matches the pieces that leave: one serial per piece, or the rows adding up exactly. */
export function entriesComplete(kind: TrackingKind, entries: readonly TrackingEntry[], quantity: number): boolean {
  return quantity > 0 && entries.length > 0 && entryPieces(kind, entries) === quantity
}

/** "18 / 20 serial nos.", "45 / 60 pcs in 2 batches", "30 / 30 pcs in 2 dates". */
export function entriesStateText(kind: TrackingKind, entries: readonly TrackingEntry[], quantity: number): string {
  const q = formatNumber(quantity)
  if (kind === 'Serial') return `${formatNumber(entries.length)} / ${q} serial nos.`
  const s = formatNumber(entryPieces(kind, entries))
  const n = entries.length
  if (kind === 'Batch') return `${s} / ${q} pcs in ${formatNumber(n)} ${n === 1 ? 'batch' : 'batches'}`
  return `${s} / ${q} pcs in ${formatNumber(n)} ${n === 1 ? 'date' : 'dates'}`
}

/**
 * THE CLIENT'S MIRROR OF THE DATABASE'S SEQ 12 AND 24, word for word (plain numbers, as the database writes them): why
 * a line that leaves is not complete yet, or null when it is. `prefix` is the server's "Line {n} ({item})".
 */
export function incompleteSentence(
  kind: TrackingKind,
  prefix: string,
  entries: readonly TrackingEntry[],
  quantity: number,
): string | null {
  if (quantity <= 0) return null
  if (entries.length === 0) {
    if (kind === 'Serial') return `${prefix}: type the serial numbers of the ${quantity} pcs that leave (Serial nos.…).`
    if (kind === 'Batch') return `${prefix}: say which batches the ${quantity} pcs come from (Batches…).`
    return `${prefix}: give the expiry dates of the ${quantity} pcs (Expiry dates…).`
  }
  if (kind === 'Serial') {
    return entries.length === quantity
      ? null
      : `${prefix}: ${quantity} pcs leave but ${entries.length} serial numbers are typed.`
  }
  const sum = entryPieces(kind, entries)
  if (sum === quantity) return null
  return kind === 'Batch'
    ? `${prefix}: the batches add up to ${sum} pcs but ${quantity} pcs leave.`
    : `${prefix}: the expiry dates add up to ${sum} pcs but ${quantity} pcs leave.`
}

/* ── what the dialog's Done hears back ──────────────────────────────────────────────────────── */

/** One sentence of the check, and the row it names (its place in the list as sent, 1-based), if any. */
export interface TrackingProblem {
  message: string
  rowNumber: number | null
}

/**
 * The Check's answer for the line the dialog is about (the caller keeps that line's and the whole list's sentences, the
 * database's words). ERRORS keep the dialog open, the rows they name outlined. COUNT ERRORS (the rows do not add up to
 * the pieces yet) are said in red too but let a second click keep what is typed: the page's own state goes on saying it
 * and its button stays disabled, so nothing half done can be posted, and nothing scanned is lost. WARNINGS (orange)
 * need the second click: "Keep these numbers".
 */
export interface TrackingCheckOutcome {
  errors: TrackingProblem[]
  countErrors: TrackingProblem[]
  warnings: TrackingProblem[]
}

/** A number the system already knows at the place the goods leave (a suggestion), with where it was seen. */
export interface KnownSerial {
  serialNo: string
  expiryDate: string | null
  /** "Received into LKS-01 by TRR-BR-003-000002 on 12/10/2026". */
  text: string
}

export interface KnownSerials {
  /** "Known at LKS-01". */
  title: string
  serials: KnownSerial[]
}

/* ── the rows a receipt line settles ────────────────────────────────────────────────────────── */

/** What the rest of a row is when fewer arrive: still coming (the default), or written off as lost. */
export type RestChoice = 'coming' | 'lost'

/** One row on the way: a serial (on the way 1, received 0 or 1) or a batch / expiry row (received 0 to on the way). */
export interface ReceiptEntry {
  /** The dispatch's tracking row. */
  id: number
  rowNumber: number
  serialNo: string | null
  batchNo: string | null
  expiryDate: string | null
  onTheWay: number
  received: number
  rest: RestChoice
}

/** A receipt line's rows, and whether a scan session ticks only what is scanned (it survives Done and reopening). */
export interface ReceiptTracking {
  entries: ReceiptEntry[]
  scanning: boolean
}

/**
 * THE ROWS ON THE WAY READ AGAIN while the Receive dialog is open (someone else changed the order: a refused receipt
 * reloads it). What the reader said of each row still on the way is kept - received (never above its new on the way)
 * and the rest - and the scan session too; the rows no longer on the way drop out, new ones come with the default.
 * `changed`: the rows on the way are not those the reader saw (a row gone or new, another on the way).
 */
export function mergeReceiptTracking(
  previous: ReceiptTracking | undefined,
  fresh: readonly ReceiptEntry[],
): { tracking: ReceiptTracking; changed: boolean } {
  if (!previous) return { tracking: { entries: [...fresh], scanning: false }, changed: false }
  const before = new Map(previous.entries.map((e) => [e.id, e]))
  let changed = previous.entries.length !== fresh.length
  const entries = fresh.map((e) => {
    const old = before.get(e.id)
    if (!old) {
      // back on the way (a receipt reversed meanwhile): the default, unticked in a scan session (only scans tick)
      changed = true
      return previous.scanning ? { ...e, received: 0 } : e
    }
    if (old.onTheWay !== e.onTheWay) changed = true
    return { ...e, received: Math.min(old.received, e.onTheWay), rest: old.rest }
  })
  return { tracking: { entries, scanning: previous.scanning }, changed }
}

export interface ReceiptTotals {
  arrived: number
  lost: number
  coming: number
}

/** A row's lost pieces: the rest of what is on the way, when it is marked Lost. */
export const entryLost = (e: ReceiptEntry) => (e.rest === 'lost' ? Math.max(0, e.onTheWay - e.received) : 0)

export function receiptTotals(entries: readonly ReceiptEntry[]): ReceiptTotals {
  let arrived = 0
  let lost = 0
  let coming = 0
  for (const e of entries) {
    const received = Math.min(e.received, e.onTheWay)
    const rest = Math.max(0, e.onTheWay - received)
    arrived += received
    if (e.rest === 'lost') lost += rest
    else coming += rest
  }
  return { arrived, lost, coming }
}

/** "18 arrived · 1 lost · 1 still coming", the zero parts left out. */
export function receiptStateText(totals: ReceiptTotals): string {
  const parts = [
    totals.arrived > 0 ? `${formatNumber(totals.arrived)} arrived` : null,
    totals.lost > 0 ? `${formatNumber(totals.lost)} lost` : null,
    totals.coming > 0 ? `${formatNumber(totals.coming)} still coming` : null,
  ].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : 'Nothing on the way'
}

/* ── a pasted list ──────────────────────────────────────────────────────────────────────────── */

/** A line of a pasted list that was not taken: its number in the text (1-based) and what it said. */
export interface PasteUnread {
  lineNumber: number
  text: string
}

export interface PastedSerial {
  serialNo: string
  expiryDate: string | null
}

export interface PastedRow {
  batchNo: string | null
  expiryDate: string | null
  quantity: number
}

export interface PasteResult<T> {
  rows: T[]
  unread: PasteUnread[]
  /** Rows read without the expiry date the item requires (the list then says it; the Check names each row). */
  missingExpiry: number
}

/** A token shaped like a date ("31/03/2027", "2027-03-31", "31.3.27"): a date, never a number. */
const DATE_SHAPE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/

/** Lines of a pasted text: CR LF, LF, or a scanner's lone CR. */
function linesOf(text: string): string[] {
  return text.split(/\r\n|\n|\r/)
}

/**
 * A pasted list of serial numbers: one per line, or several on a line separated by tabs, commas, semicolons or spaces
 * (a scanner's output joined by commas gives one serial per token). With expiry, a date token belongs to the serial
 * before it ("MD626AE1XR1T00001 31/03/2027"), read with parseTypedDate. A token shaped like a date is never taken for a
 * serial: without expiry, or with nothing before it, or not a real date, its whole line is unread.
 */
export function parsePastedSerials(text: string, withExpiry: boolean): PasteResult<PastedSerial> {
  const rows: PastedSerial[] = []
  const unread: PasteUnread[] = []
  let missingExpiry = 0
  linesOf(text).forEach((line, index) => {
    const tokens = line.split(/[\s,;]+/).filter((t) => t.length > 0)
    if (tokens.length === 0) return
    const found: PastedSerial[] = []
    let bad = false
    for (const token of tokens) {
      if (DATE_SHAPE.test(token)) {
        const date = withExpiry ? parseTypedDate(token) : null
        const last = found[found.length - 1]
        if (!date || !last || last.expiryDate !== null) {
          bad = true
          break
        }
        last.expiryDate = date
        continue
      }
      const serial = normalizeTrackingNo(token)
      if (serial) found.push({ serialNo: serial, expiryDate: null })
    }
    if (bad || found.length === 0) {
      unread.push({ lineNumber: index + 1, text: line.trim() })
      return
    }
    if (withExpiry) missingExpiry += found.filter((f) => f.expiryDate === null).length
    rows.push(...found)
  })
  return { rows, unread, missingExpiry }
}

/**
 * A pasted list of batch or expiry rows, one per line, the cells separated by tabs (copied from Excel), semicolons or
 * commas - never by spaces, which a batch no. may hold. Batch: `batch | expiry | pcs` or `batch | pcs`; Expiry:
 * `expiry | pcs`. A row without a readable whole number of pcs above 0, or with a date that is not a real one, is unread.
 */
export function parsePastedRows(text: string, kind: 'Batch' | 'Expiry', withExpiry: boolean): PasteResult<PastedRow> {
  const rows: PastedRow[] = []
  const unread: PasteUnread[] = []
  let missingExpiry = 0
  const pieces = (token: string | undefined) => (token && /^\d+$/.test(token) && Number(token) > 0 ? Number(token) : null)
  linesOf(text).forEach((line, index) => {
    const tokens = line
      .split(/[\t;,]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    if (tokens.length === 0) return
    const fail = () => unread.push({ lineNumber: index + 1, text: line.trim() })

    if (kind === 'Expiry') {
      const date = tokens.length === 2 ? parseTypedDate(tokens[0] as string) : null
      const quantity = pieces(tokens[1])
      if (!date || quantity === null) return void fail()
      rows.push({ batchNo: null, expiryDate: date, quantity })
      return
    }

    if (tokens.length !== 2 && tokens.length !== 3) return void fail()
    const batchNo = normalizeTrackingNo(tokens[0])
    const quantity = pieces(tokens[tokens.length - 1])
    const date = tokens.length === 3 ? parseTypedDate(tokens[1] as string) : null
    if (!batchNo || quantity === null || (tokens.length === 3 && !date)) return void fail()
    if (withExpiry && !date) missingExpiry++
    rows.push({ batchNo, expiryDate: date, quantity })
  })
  return { rows, unread, missingExpiry }
}

/** "Line 4 could not be read: 'B2410-07; 40'." - the first five, then "and {n} more lines could not be read." */
export function unreadSentences(unread: readonly PasteUnread[]): string[] {
  const shown = unread.slice(0, 5).map((u) => `Line ${u.lineNumber} could not be read: '${u.text}'.`)
  if (unread.length > 5) shown.push(`${formatNumber(unread.length - 5)} more lines could not be read.`)
  return shown
}

/* ── the rows of a posting, as a viewer shows them ──────────────────────────────────────────── */

/** One stored row with what became of it (a dispatch's or a receipt's). */
export interface TrackingViewRow {
  key: number
  rowNumber: number
  serialNo: string | null
  batchNo: string | null
  expiryDate: string | null
  /** Pcs sent (dispatch) or received (receipt). */
  quantity: number
  /** Pcs written off (receipt rows). */
  lost: number
  state: string
  stateText: string
}

/** The state's badge: On the way blue, Received green, Written off red, Partly received orange, Reversed gray. */
export function trackingStateBadge(state: string): { label: string; colour: string } {
  switch (state) {
    case 'OnTheWay':
      return { label: 'On the way', colour: 'blue' }
    case 'Received':
      return { label: 'Received', colour: 'green' }
    case 'Lost':
      return { label: 'Written off', colour: 'red' }
    case 'Reversed':
      return { label: 'Reversed', colour: 'gray' }
    // Part arrived and the rest was written off or is still coming.
    case 'PartlyReceived':
    case 'Settled':
    case 'PartlyLost':
      return { label: 'Partly received', colour: 'orange' }
    default:
      return { label: state, colour: 'gray' }
  }
}

/** dd/mm/yyyy, the shape the lists read and the paste takes back. */
function dayFirst(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/**
 * "Copy list": one line per row, tab-separated, in the shapes Paste list… reads back - `serial` (+ expiry), `batch |
 * expiry | pcs`, `expiry | pcs`.
 */
export function copyText(kind: TrackingKind, rows: readonly TrackingViewRow[]): string {
  return rows
    .map((r) => {
      if (kind === 'Serial') return [r.serialNo ?? '', dayFirst(r.expiryDate)].filter((p) => p !== '').join('\t')
      if (kind === 'Batch') return [r.batchNo ?? '', dayFirst(r.expiryDate), String(r.quantity)].join('\t')
      return [dayFirst(r.expiryDate), String(r.quantity)].join('\t')
    })
    .join('\n')
}

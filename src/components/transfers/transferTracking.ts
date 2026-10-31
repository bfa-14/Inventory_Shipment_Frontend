import type {
  CheckDispatchTrackingResult,
  TransferDispatchTrackingRow,
  TransferOrderLineDto,
  TransferPostingDto,
  TransferPostingLineDto,
  TransferReceiptTrackingRow,
  TransferSerialSuggestionDto,
  TransferTrackingProblemDto,
  TransferTrackingRowDto,
} from '../../api/inventory/transfers'
import type { TrackingKind } from '../../api/types'
import { dateLabel } from '../documents/documentKind'
import {
  entryLost,
  kindCount,
  normalizeTrackingNo,
  type KnownSerials,
  type ReceiptEntry,
  type TrackingCheckOutcome,
  type TrackingEntry,
  type TrackingProblem,
  type TrackingViewRow,
} from '../tracking/trackingNumbers'

/*
 * (93) BATCH, SERIAL AND EXPIRY ON A TRANSFER ORDER: what the generic tracking pieces (components/tracking/) need from a
 * transfer - the line's kind, the rows as the API takes them and gives them back, the Check's sentences sorted for the
 * dialog, and the rows kept through a reload. Kept out of the components so they stay components (fast refresh).
 */

/** What a line asks for now (the item's tracking, from the order's Get): Serial | Batch | Expiry | null. */
export const lineTrackingKind = (line: Pick<TransferOrderLineDto, 'trackingKind'>): TrackingKind | null =>
  line.trackingKind ?? null

/** Serial and batch items that require an expiry ask it on their rows; an Expiry item always does. */
export const lineWithExpiry = (line: Pick<TransferOrderLineDto, 'trackingKind' | 'requiresExpiry'>): boolean =>
  line.trackingKind === 'Expiry' || line.requiresExpiry === true

/** The database's "Line {n} ({item})" - the start of every sentence about a line. */
export const linePrefix = (line: Pick<TransferOrderLineDto, 'lineNumber' | 'itemCode'>) =>
  `Line ${line.lineNumber} (${line.itemCode})`

/** "Serial numbers - line 1: TEST93-S", "Batches - line 2: TEST93-B", "Expiry dates - line 3: TEST93-E". */
export function dispatchTrackingTitle(kind: TrackingKind, line: Pick<TransferOrderLineDto, 'lineNumber' | 'itemCode'>) {
  const word = kind === 'Serial' ? 'Serial numbers' : kind === 'Batch' ? 'Batches' : 'Expiry dates'
  return `${word} - line ${line.lineNumber}: ${line.itemCode}`
}

/** "Serial numbers that arrived - TRD-BR-003-000021 line 1: TEST93-S" (and "Batches that arrived …"). */
export function receiveTrackingTitle(kind: TrackingKind, dispatchNumber: string, line: TransferPostingLineDto) {
  const word = kind === 'Serial' ? 'Serial numbers' : kind === 'Batch' ? 'Batches' : 'Expiry dates'
  return `${word} that arrived - ${dispatchNumber} line ${line.lineNumber}: ${line.itemCode}`
}

/** The dialog's rows as the API takes them; the numbers go as typed (the database trims them and puts capitals). */
export function dispatchTrackingRows(kind: TrackingKind, entries: readonly TrackingEntry[]): TransferDispatchTrackingRow[] {
  return entries.map((e) => {
    if (kind === 'Serial')
      return { serialNo: e.serialNo || null, batchNo: null, expiryDate: e.expiryDate, quantityBase: 1 }
    return {
      serialNo: null,
      batchNo: kind === 'Batch' ? e.batchNo || null : null,
      expiryDate: e.expiryDate,
      quantityBase: typeof e.quantity === 'number' ? e.quantity : 0,
    }
  })
}

/** Seq 12 and 24: the rows do not add up to the pieces yet (the page's own state goes on saying it). */
const COUNT_SEQS = new Set([12, 24])
const COUNT_SENTENCE =
  /(: type the serial numbers of the \d+ pcs that leave|: say which batches the \d+ pcs come from|: give the expiry dates of the \d+ pcs|pcs leave but \d+ serial numbers are typed|: the (batches|expiry dates) add up to \d+ pcs but)/

const isCountProblem = (p: TransferTrackingProblemDto) =>
  p.seq !== undefined ? COUNT_SEQS.has(p.seq) : COUNT_SENTENCE.test(p.message)

/**
 * THE CHECK'S ANSWER FOR ONE LINE'S DIALOG: its errors, and those of the dispatch as a whole (no line: the 10,000 rows
 * ceiling); the duplicates across two lines name each line's row, so each line's dialog shows them. The other lines'
 * errors are theirs (another line may simply not be typed yet). Warnings: the server already gave this line's only.
 */
export function checkOutcomeFor(lineId: number, result: CheckDispatchTrackingResult): TrackingCheckOutcome {
  const mine = (p: TransferTrackingProblemDto) => p.transferOrderLineId === lineId || p.transferOrderLineId === null
  const toProblem = (p: TransferTrackingProblemDto): TrackingProblem => ({
    message: p.message,
    rowNumber: p.transferOrderLineId === lineId ? p.rowNumber : null,
  })
  const errors = result.problems.filter((p) => p.severity === 'Error' && mine(p))
  return {
    errors: errors.filter((p) => !isCountProblem(p)).map(toProblem),
    countErrors: errors.filter(isCountProblem).map(toProblem),
    warnings: result.problems.filter((p) => p.severity === 'Warning' && p.transferOrderLineId === lineId).map(toProblem),
  }
}

/** "Known at LKS-01": the serials received into the order's From by transfers and not sent since. */
export function knownSerialsOf(serials: TransferSerialSuggestionDto[], fromCode: string): KnownSerials {
  return {
    title: `Known at ${fromCode}`,
    serials: serials.map((s) => ({
      serialNo: normalizeTrackingNo(s.serialNo) ?? s.serialNo,
      expiryDate: s.expiryDate,
      text: `Received into ${fromCode} by ${s.receivedByNumber ?? '—'} on ${dateLabel(s.receivedOn)}`,
    })),
  }
}

/* ── the receipt ────────────────────────────────────────────────────────────────────────────── */

/** The dispatch rows still on the way of one dispatch line, everything arrived (the default without the dialog). */
export function receiptEntriesOf(rows: readonly TransferTrackingRowDto[], postingLineId: number): ReceiptEntry[] {
  return rows
    .filter((r) => r.postingLineId === postingLineId && r.onTheWayBase > 0)
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .map((r) => ({
      id: r.id,
      rowNumber: r.rowNumber,
      serialNo: r.serialNo,
      batchNo: r.batchNo,
      expiryDate: r.expiryDate,
      onTheWay: r.onTheWayBase,
      received: r.onTheWayBase,
      rest: 'coming' as const,
    }))
}

/** One entry per row that arrived or was lost; the rows still coming are left out. */
export function receiptTrackingRows(entries: readonly ReceiptEntry[]): TransferReceiptTrackingRow[] {
  return entries
    .map((e) => ({ dispatchTrackingId: e.id, receivedBase: Math.min(e.received, e.onTheWay), lostBase: entryLost(e) }))
    .filter((r) => r.receivedBase + r.lostBase > 0)
}

/* ── the postings ───────────────────────────────────────────────────────────────────────────── */

/** A posting line's rows, for the viewer. */
export function trackingViewRowsOf(rows: readonly TransferTrackingRowDto[], postingLineId: number): TrackingViewRow[] {
  return rows
    .filter((r) => r.postingLineId === postingLineId)
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .map((r) => ({
      key: r.id,
      rowNumber: r.rowNumber,
      serialNo: r.serialNo,
      batchNo: r.batchNo,
      expiryDate: r.expiryDate,
      quantity: r.quantityBase,
      lost: r.lostBase,
      state: r.state,
      stateText: r.stateText,
    }))
}

/** A posting line with tracking rows: its kind and count, or null. */
export function postingLineTracking(line: TransferPostingLineDto): { kind: TrackingKind; count: number } | null {
  const count = line.trackingCount ?? 0
  return line.trackingKind && count > 0 ? { kind: line.trackingKind, count } : null
}

/** " · 20 serial nos. · 2 batches": what a posting's summary adds, by kind over its lines. */
export function postingTrackingSummary(posting: TransferPostingDto): string {
  const totals = new Map<TrackingKind, number>()
  for (const line of posting.lines) {
    const t = postingLineTracking(line)
    if (t) totals.set(t.kind, (totals.get(t.kind) ?? 0) + t.count)
  }
  return (['Serial', 'Batch', 'Expiry'] as const)
    .filter((k) => totals.has(k))
    .map((k) => ` · ${kindCount(k, totals.get(k) ?? 0)}`)
    .join('')
}

/** "TRD-BR-003-000021 line 1 - TEST93-S: 20 serial nos." - the viewer's title. */
export function trackingViewTitle(posting: TransferPostingDto, line: TransferPostingLineDto): string {
  const t = postingLineTracking(line)
  return `${posting.documentNumber} line ${line.lineNumber} - ${line.itemCode}${t ? `: ${kindCount(t.kind, t.count)}` : ''}`
}

/* ── kept through a reload (M13): the Dispatch dialog's typed rows - transferTrackingStore.ts (unit-tested) ───── */

export { clearStoredTracking, readStoredTracking, trackingStoreKey, writeStoredTracking } from './transferTrackingStore'

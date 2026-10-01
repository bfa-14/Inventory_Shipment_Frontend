/**
 * The grid's arithmetic: what a filter means, how rows are ordered, how a column is totalled.
 *
 * PURE ON PURPOSE - no React, no imports. Every rule a reader can see go wrong in a grid (a row that
 * should have been hidden, a total that disagrees with the rows, a blank sorted into the middle) is
 * decided here, in functions that can be run with plain values and checked without a browser.
 *
 * A COLUMN HAS TWO FACES. Its RAW value is what it sorts, compares and adds up (a number, an ISO
 * date, a boolean); its DISPLAY text is what the reader sees and what the value list offers. Keeping
 * them apart is what lets a date column sort chronologically while a "contains" filter still matches
 * the "01/10/2026" in the cell, and lets a money column add up numbers whose cells read "$ 4.00 USD".
 */

export type ColumnKind = 'text' | 'number' | 'date' | 'boolean' | 'list'

/** What a column's accessor resolves to for one row. Dates are ISO strings ('2026-10-01' or a full timestamp). */
export type Cell = string | number | boolean | null | undefined

export type FilterOp =
  // text
  | 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith'
  // number
  | 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'between'
  // date
  | 'on' | 'before' | 'after' | 'range'
  // any
  | 'blank' | 'notBlank'

/** Which operators each kind of column offers, in the order the popover lists them. */
export const OPERATORS: Record<ColumnKind, { op: FilterOp; label: string; needs: 0 | 1 | 2 }[]> = {
  text: [
    { op: 'contains', label: 'Contains', needs: 1 },
    { op: 'notContains', label: 'Does not contain', needs: 1 },
    { op: 'equals', label: 'Equals', needs: 1 },
    { op: 'notEquals', label: 'Does not equal', needs: 1 },
    { op: 'startsWith', label: 'Starts with', needs: 1 },
    { op: 'endsWith', label: 'Ends with', needs: 1 },
    { op: 'blank', label: 'Is blank', needs: 0 },
    { op: 'notBlank', label: 'Is not blank', needs: 0 },
  ],
  number: [
    { op: 'eq', label: 'Equals', needs: 1 },
    { op: 'ne', label: 'Does not equal', needs: 1 },
    { op: 'gt', label: 'Greater than', needs: 1 },
    { op: 'ge', label: 'Greater than or equal', needs: 1 },
    { op: 'lt', label: 'Less than', needs: 1 },
    { op: 'le', label: 'Less than or equal', needs: 1 },
    { op: 'between', label: 'Between', needs: 2 },
    { op: 'blank', label: 'Is blank', needs: 0 },
    { op: 'notBlank', label: 'Is not blank', needs: 0 },
  ],
  date: [
    { op: 'on', label: 'On', needs: 1 },
    { op: 'before', label: 'Before', needs: 1 },
    { op: 'after', label: 'After', needs: 1 },
    { op: 'range', label: 'Between', needs: 2 },
    { op: 'blank', label: 'Is blank', needs: 0 },
    { op: 'notBlank', label: 'Is not blank', needs: 0 },
  ],
  boolean: [],
  list: [],
}

/** The operator a fresh filter on a column of this kind starts with. */
export function defaultOperator(kind: ColumnKind): FilterOp {
  return OPERATORS[kind][0]?.op ?? 'contains'
}

/** What an empty cell is called in the value list, so a blank is pickable like any other value. */
export const BLANKS = '(Blanks)'

/**
 * One column's filter. The two halves are ANDed: a condition (operator + operands, typed by the
 * reader) and a value list (ticks from the funnel). Either may be absent.
 */
export interface FilterValue {
  op?: FilterOp
  /** First operand as typed: text, a number, or an ISO date. */
  a?: string
  /** Second operand, for the "between" operators. */
  b?: string
  /** Display values ticked in the list. Absent means every value. */
  values?: string[]
}

export type Filters = Record<string, FilterValue | undefined>

/** True when the value narrows nothing, so it can be dropped rather than kept lit over nothing. */
export function isEmptyFilter(filter: FilterValue | undefined): boolean {
  if (!filter) return true
  const hasValues = !!filter.values && filter.values.length > 0
  return !hasValues && !conditionIsComplete(filter)
}

/** Does the condition half have what its operator needs? An incomplete one filters nothing. */
export function conditionIsComplete(filter: FilterValue): boolean {
  if (!filter.op) return false
  if (filter.op === 'blank' || filter.op === 'notBlank') return true
  const needsTwo = filter.op === 'between' || filter.op === 'range'
  const has = (v: string | undefined) => v !== undefined && v.trim() !== ''
  return needsTwo ? has(filter.a) && has(filter.b) : has(filter.a)
}

/* ── reading cells ───────────────────────────────────────────────────────────────────────────── */

export function isBlank(value: Cell): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/** A number out of whatever was typed or stored: "1,250.50" and 1250.5 are the same figure. NaN when there is none. */
export function toNumber(value: Cell | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean' || isBlank(value)) return Number.NaN
  return Number.parseFloat(String(value).replace(/,/g, ''))
}

/** The calendar day of an ISO date or timestamp, 'yyyy-MM-dd', or '' when it is not one. */
export function toDay(value: Cell | undefined): string {
  if (typeof value !== 'string') return ''
  const day = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ''
}

/* ── filtering ───────────────────────────────────────────────────────────────────────────────── */

function conditionMatches(kind: ColumnKind, raw: Cell, display: string, filter: FilterValue): boolean {
  const op = filter.op as FilterOp
  if (op === 'blank') return isBlank(raw) && display.trim() === ''
  if (op === 'notBlank') return !(isBlank(raw) && display.trim() === '')

  if (kind === 'number') {
    const value = toNumber(raw)
    if (Number.isNaN(value)) return false
    const a = toNumber(filter.a)
    const b = toNumber(filter.b)
    switch (op) {
      case 'eq': return Math.abs(value - a) < 0.0000001
      case 'ne': return Math.abs(value - a) >= 0.0000001
      case 'gt': return value > a
      case 'ge': return value >= a
      case 'lt': return value < a
      case 'le': return value <= a
      case 'between': return value >= Math.min(a, b) && value <= Math.max(a, b)
      default: return true
    }
  }

  if (kind === 'date') {
    const day = toDay(raw)
    if (day === '') return false
    const a = filter.a ?? ''
    const b = filter.b ?? ''
    switch (op) {
      case 'on': return day === a
      case 'before': return day < a
      case 'after': return day > a
      case 'range': return day >= (a < b ? a : b) && day <= (a < b ? b : a)
      default: return true
    }
  }

  // text (and a list or boolean column used with a typed condition): judged on what is displayed.
  const haystack = display.toLowerCase()
  const needle = (filter.a ?? '').trim().toLowerCase()
  switch (op) {
    case 'contains': return haystack.includes(needle)
    case 'notContains': return !haystack.includes(needle)
    case 'equals': return haystack === needle
    case 'notEquals': return haystack !== needle
    case 'startsWith': return haystack.startsWith(needle)
    case 'endsWith': return haystack.endsWith(needle)
    default: return true
  }
}

/** Does one row survive one column's filter? The condition and the ticked values must both pass. */
export function cellMatches(kind: ColumnKind, raw: Cell, display: string, filter: FilterValue): boolean {
  const shown = display.trim() === '' ? BLANKS : display
  if (filter.values && filter.values.length > 0 && !filter.values.includes(shown)) return false
  if (conditionIsComplete(filter) && !conditionMatches(kind, raw, display, filter)) return false
  return true
}

/* ── sorting ─────────────────────────────────────────────────────────────────────────────────── */

export interface SortSpec {
  accessor: string
  direction: 'asc' | 'desc'
}

/**
 * Orders two raw values of one column. Blanks lead ascending and trail descending - a blank is the
 * smallest thing a column can hold, and a reader sorting "newest first" does not want the empty
 * rows on top.
 */
export function compareCells(kind: ColumnKind, a: Cell, b: Cell): number {
  const aBlank = isBlank(a)
  const bBlank = isBlank(b)
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? -1 : 1

  if (kind === 'number') {
    const x = toNumber(a)
    const y = toNumber(b)
    if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) === Number.isNaN(y) ? 0 : Number.isNaN(x) ? -1 : 1
    return x - y
  }
  if (kind === 'date') {
    const x = String(a)
    const y = String(b)
    return x < y ? -1 : x > y ? 1 : 0
  }
  if (kind === 'boolean') return Number(Boolean(a)) - Number(Boolean(b))
  // "Step 2" before "Step 10".
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** A stable multi-column sort: the first spec decides, the next breaks its ties, and so on. */
export function sortRows<T>(
  rows: T[],
  specs: SortSpec[],
  read: (row: T, accessor: string) => { kind: ColumnKind; raw: Cell } | undefined,
): T[] {
  if (specs.length === 0) return rows
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      for (const spec of specs) {
        const l = read(left.row, spec.accessor)
        const r = read(right.row, spec.accessor)
        if (!l || !r) continue
        const result = compareCells(l.kind, l.raw, r.raw)
        if (result !== 0) return spec.direction === 'desc' ? -result : result
      }
      return left.index - right.index
    })
    .map((entry) => entry.row)
}

/**
 * The sort after the reader clicked a header. A plain click REPLACES the sort with that column; with
 * Shift it ADDS the column as a further key (or flips its direction if it is already one).
 */
export function nextSort(current: SortSpec[], clicked: SortSpec, additive: boolean): SortSpec[] {
  if (!additive) return [clicked]
  const exists = current.some((spec) => spec.accessor === clicked.accessor)
  return exists
    ? current.map((spec) => (spec.accessor === clicked.accessor ? clicked : spec))
    : [...current, clicked]
}

/* ── totals ──────────────────────────────────────────────────────────────────────────────────── */

export type SummaryKind = 'none' | 'count' | 'sum' | 'avg' | 'min' | 'max'

/** The figure a column reports over `values`, or null when there is nothing to report. */
export function summarize(values: Cell[], kind: SummaryKind): number | null {
  if (kind === 'none') return null
  if (kind === 'count') return values.filter((v) => !isBlank(v)).length
  const numbers = values.map(toNumber).filter((n) => !Number.isNaN(n))
  if (numbers.length === 0) return null
  switch (kind) {
    case 'sum': return numbers.reduce((total, n) => total + n, 0)
    case 'avg': return numbers.reduce((total, n) => total + n, 0) / numbers.length
    case 'min': return Math.min(...numbers)
    default: return Math.max(...numbers)
  }
}

/* ── paging ──────────────────────────────────────────────────────────────────────────────────── */

/** The rows of one page. A page past the end is clamped, so a shrinking result never shows an empty grid. */
export function pageOf<T>(rows: T[], page: number, size: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(Math.max(1, page), pages)
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages }
}

/* ── export ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * CSV the way Excel reads it: comma separated, quotes doubled, CRLF line ends, and a leading BOM so
 * accented names and CDF amounts open as UTF-8 instead of mojibake.
 */
export function toCsv(headers: string[], rows: string[][]): string {
  const quote = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  const lines = [headers, ...rows].map((line) => line.map(quote).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

/* ── the filter row's shorthand ──────────────────────────────────────────────────────────────── */

const NUMBER = String.raw`-?\d[\d,]*(?:\.\d+)?|-?\.\d+`

/**
 * What a reader types into a NUMBER column's filter-row cell: "100" (equals), ">100", ">=100",
 * "<5", "<=5", "<>5" or "!=5", and "1..5" for between. Anything else is not a filter yet, which
 * leaves the grid alone while somebody is half-way through typing ">".
 */
export function parseNumberExpression(text: string): FilterValue | undefined {
  const t = text.trim()
  if (t === '') return undefined
  const range = new RegExp(String.raw`^(${NUMBER})\s*\.\.\s*(${NUMBER})$`).exec(t)
  if (range) return { op: 'between', a: range[1], b: range[2] }
  const compare = new RegExp(String.raw`^(>=|<=|<>|!=|>|<|=)?\s*(${NUMBER})$`).exec(t)
  if (!compare) return undefined
  const ops: Record<string, FilterOp> = { '>=': 'ge', '<=': 'le', '<>': 'ne', '!=': 'ne', '>': 'gt', '<': 'lt', '=': 'eq' }
  return { op: ops[compare[1] ?? '='], a: compare[2] }
}

/** The filter-row text for a number filter - the inverse of {@link parseNumberExpression}. */
export function numberExpressionOf(filter: FilterValue | undefined): string {
  if (!filter?.op || !conditionIsComplete(filter)) return ''
  const symbols: Partial<Record<FilterOp, string>> = { eq: '', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' }
  if (filter.op === 'between') return `${filter.a}..${filter.b}`
  return filter.op in symbols ? `${symbols[filter.op]}${filter.a}` : ''
}

/** A one-line description of what a column's filter does, for tooltips and the "custom filter" hint. */
export function describeFilter(filter: FilterValue | undefined): string {
  if (!filter) return ''
  const parts: string[] = []
  if (conditionIsComplete(filter)) {
    const label = Object.values(OPERATORS).flat().find((o) => o.op === filter.op)?.label ?? String(filter.op)
    const operands = filter.op === 'blank' || filter.op === 'notBlank' ? '' : filter.b !== undefined && filter.b !== '' && (filter.op === 'between' || filter.op === 'range') ? ` ${filter.a} and ${filter.b}` : ` "${filter.a}"`
    parts.push(`${label}${operands}`)
  }
  if (filter.values && filter.values.length > 0) {
    parts.push(filter.values.length === 1 ? `is ${filter.values[0]}` : `one of ${filter.values.length} values`)
  }
  return parts.join(' and ')
}

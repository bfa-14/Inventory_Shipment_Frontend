/**
 * The first sheet of an .xlsx or .csv file as text, and a one-sheet .xlsx built from rows - in the browser, with no
 * library. The Excel imports of the documents send their file to the API instead; this is for the small lists a page
 * reads itself (container numbers), where a round trip would only parse a column.
 *
 * An .xlsx is a zip of XML parts: the zip is read here, its parts inflated by the browser's DecompressionStream and
 * parsed by DOMParser. The old binary .xls is refused with a sentence saying how to save the file instead.
 */

export interface SheetRow {
  /** The row number in the sheet (1 = the first row), so a reader can find it in Excel. */
  rowNumber: number
  /** Every cell as text, by column (A = 0); an empty cell is ''. */
  cells: string[]
}

/** A refusal written for the person holding the file. */
export class SpreadsheetError extends Error {}

const NOT_READABLE = 'The file could not be read. Save it as an Excel workbook (.xlsx) or as CSV and try again.'
const OLD_EXCEL =
  'This is an Excel 97-2003 file (.xls). Open it in Excel and save it as an Excel workbook (.xlsx) or as CSV, then try again.'

/** Reads the first sheet of an .xlsx, or a .csv (comma, semicolon or tab separated). */
export async function readSpreadsheet(file: File): Promise<SheetRow[]> {
  const buffer = await file.arrayBuffer()
  const head = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength))
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0)
    throw new SpreadsheetError(OLD_EXCEL)
  if (head[0] === 0x50 && head[1] === 0x4b) return readXlsx(buffer)
  if (file.name.toLowerCase().endsWith('.xlsx')) throw new SpreadsheetError(NOT_READABLE)
  return readCsv(decodeText(buffer))
}

/* ── .xlsx ────────────────────────────────────────────────────────────────────────────────────── */

interface ZipEntry {
  method: number
  compressedSize: number
  offset: number
}

/** The central directory of a zip: part name (lower case) to where its bytes are. */
function zipDirectory(buffer: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buffer)
  let end = -1
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new SpreadsheetError(NOT_READABLE)

  const entries = new Map<string, ZipEntry>()
  const names = new TextDecoder()
  let at = view.getUint32(end + 16, true)
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new SpreadsheetError(NOT_READABLE)
    const nameLength = view.getUint16(at + 28, true)
    const name = names.decode(new Uint8Array(buffer, at + 46, nameLength))
    entries.set(name.toLowerCase(), {
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      offset: view.getUint32(at + 42, true),
    })
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return entries
}

async function zipPart(buffer: ArrayBuffer, entries: Map<string, ZipEntry>, name: string): Promise<Document | null> {
  const entry = entries.get(name.toLowerCase())
  if (!entry) return null
  const view = new DataView(buffer)
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new SpreadsheetError(NOT_READABLE)
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true)
  const data = new Uint8Array(buffer, start, entry.compressedSize)

  let bytes: ArrayBuffer
  if (entry.method === 0) bytes = data.slice().buffer
  else if (entry.method === 8)
    bytes = await new Response(
      new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
    ).arrayBuffer()
  else throw new SpreadsheetError(NOT_READABLE)

  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new SpreadsheetError(NOT_READABLE)
  return doc
}

/** By local name, whatever prefix the writer chose (x:row, row). */
function all(node: Document | Element, localName: string): Element[] {
  return Array.from(node.getElementsByTagNameNS('*', localName))
}

/** The text of a shared or inline string: its runs, without the phonetic guide (rPh) Excel keeps for Japanese. */
function stringText(node: Element): string {
  return all(node, 't')
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('')
}

/** "AB12" -> 27 (A = 0); -1 without a column. */
function columnIndex(reference: string | null): number {
  const letters = /^[A-Z]+/i.exec(reference ?? '')?.[0].toUpperCase()
  if (!letters) return -1
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

async function readXlsx(buffer: ArrayBuffer): Promise<SheetRow[]> {
  const entries = zipDirectory(buffer)
  const workbook = await zipPart(buffer, entries, 'xl/workbook.xml')
  const rels = await zipPart(buffer, entries, 'xl/_rels/workbook.xml.rels')
  const firstSheet = workbook ? all(workbook, 'sheet')[0] : undefined
  if (!workbook || !rels || !firstSheet) throw new SpreadsheetError(NOT_READABLE)

  // The sheet's r:id, whichever relationships namespace (transitional or strict) the writer used.
  const relId = Array.from(firstSheet.attributes).find((a) => a.localName === 'id' && a.prefix !== null)?.value
  const target = all(rels, 'Relationship')
    .find((r) => r.getAttribute('Id') === relId)
    ?.getAttribute('Target')
  if (!target) throw new SpreadsheetError(NOT_READABLE)
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`

  const sharedDoc = await zipPart(buffer, entries, 'xl/sharedStrings.xml')
  const shared = sharedDoc ? all(sharedDoc, 'si').map(stringText) : []
  const sheet = await zipPart(buffer, entries, path)
  if (!sheet) throw new SpreadsheetError(NOT_READABLE)

  const rows: SheetRow[] = []
  let rowNumber = 0
  for (const row of all(sheet, 'row')) {
    rowNumber = Number(row.getAttribute('r')) || rowNumber + 1
    const cells: string[] = []
    let column = -1
    for (const cell of Array.from(row.children).filter((c) => c.localName === 'c')) {
      column = Math.max(columnIndex(cell.getAttribute('r')), column + 1)
      const type = cell.getAttribute('t')
      const value = Array.from(cell.children).find((c) => c.localName === 'v')?.textContent ?? ''
      const inline = Array.from(cell.children).find((c) => c.localName === 'is')
      cells[column] =
        type === 's'
          ? (shared[Number(value)] ?? '')
          : type === 'inlineStr'
            ? inline
              ? stringText(inline)
              : ''
            : type === 'b'
              ? value === '1'
                ? 'TRUE'
                : 'FALSE'
              : value
    }
    rows.push({ rowNumber, cells: Array.from(cells, (c) => c ?? '') })
  }
  return rows
}

/* ── .csv ─────────────────────────────────────────────────────────────────────────────────────── */

/** UTF-8 (a BOM dropped), else the Windows code page Excel writes CSV in. */
function decodeText(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '')
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : utf8
}

/** RFC 4180 with the separator of the first line: the commonest of ';', ',' and tab outside quotes. */
function readCsv(text: string): SheetRow[] {
  const firstLine = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '')
  const separator = [';', '\t', ','].reduce(
    (best, s) => (firstLine.split(s).length > firstLine.split(best).length ? s : best),
    ',',
  )

  const rows: SheetRow[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  const endRow = () => {
    cells.push(cell)
    rows.push({ rowNumber: rows.length + 1, cells })
    cells = []
    cell = ''
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === separator) {
      cells.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else cell += ch
  }
  if (cell !== '' || cells.length > 0) endRow()
  return rows
}

/* ── writing ──────────────────────────────────────────────────────────────────────────────────── */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** A zip of stored (uncompressed) parts - what an .xlsx of a few cells needs. */
function zip(files: [string, string][]): Blob {
  const encoder = new TextEncoder()
  const parts: Uint8Array<ArrayBuffer>[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(content)
    const crc = crc32(data)
    // version 20, UTF-8 names, stored, 1980-01-01 00:00
    const fields = (header: DataView, at: number) => {
      header.setUint16(at, 20, true)
      header.setUint16(at + 2, 0x0800, true)
      header.setUint16(at + 4, 0, true)
      header.setUint16(at + 6, 0, true)
      header.setUint16(at + 8, 0x21, true)
      header.setUint32(at + 10, crc, true)
      header.setUint32(at + 14, data.length, true)
      header.setUint32(at + 18, data.length, true)
      header.setUint16(at + 22, nameBytes.length, true)
    }
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    fields(lv, 4)
    local.set(nameBytes, 30)
    const entry = new Uint8Array(46 + nameBytes.length)
    const ev = new DataView(entry.buffer)
    ev.setUint32(0, 0x02014b50, true)
    ev.setUint16(4, 20, true)
    fields(ev, 6)
    ev.setUint32(42, offset, true)
    entry.set(nameBytes, 46)
    parts.push(local, data)
    central.push(entry)
    offset += local.length + data.length
  }
  const centralSize = central.reduce((sum, c) => sum + c.length, 0)
  const end = new Uint8Array(22)
  const dv = new DataView(end.buffer)
  dv.setUint32(0, 0x06054b50, true)
  dv.setUint16(8, files.length, true)
  dv.setUint16(10, files.length, true)
  dv.setUint32(12, centralSize, true)
  dv.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
const TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

/** One sheet of a workbook: its rows (the first one is the header, bold) and its column widths. */
export interface WorkbookSheet {
  name: string
  rows: string[][]
  widths?: number[]
}

/** "A".."Z", "AA".. - the column part of a cell reference. */
const cellColumn = (index: number): string =>
  index < 26 ? String.fromCharCode(65 + index) : cellColumn(Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26))

/**
 * A one-sheet workbook: the first row bold, every column typed as Text (so "0012345" keeps its zeros) and as wide as
 * `widths` says.
 */
export function buildXlsx(sheetName: string, rows: string[][], widths: number[] = []): Blob {
  return buildWorkbook([{ name: sheetName, rows, widths }])
}

/** A workbook of several sheets, each laid out as {@link buildXlsx} lays out its one. */
export function buildWorkbook(sheets: WorkbookSheet[]): Blob {
  const sheetXml = (sheet: WorkbookSheet) => {
    const cols = (sheet.widths ?? [])
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1" style="2"/>`)
      .join('')
    const sheetRows = sheet.rows
      .map((cells, r) => {
        const row = cells
          .map(
            (value, c) =>
              `<c r="${cellColumn(c)}${r + 1}" t="inlineStr" s="${r === 0 ? 1 : 2}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`,
          )
          .join('')
        return `<row r="${r + 1}">${row}</row>`
      })
      .join('')
    return `${XML}<worksheet xmlns="${MAIN}">${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${sheetRows}</sheetData></worksheet>`
  }
  const numbered = sheets.map((sheet, i) => ({ sheet, n: i + 1 }))
  return zip([
    [
      '[Content_Types].xml',
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${TYPE}.sheet.main+xml"/>${numbered.map(({ n }) => `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${TYPE}.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="${TYPE}.styles+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${numbered.map(({ sheet, n }) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${n}" r:id="rId${n}"/>`).join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${XML}<Relationships xmlns="${PKG}">${numbered.map(({ n }) => `<Relationship Id="rId${n}" Type="${REL}/worksheet" Target="worksheets/sheet${n}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      `${XML}<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ],
    ...numbered.map(({ sheet, n }): [string, string] => [`xl/worksheets/sheet${n}.xml`, sheetXml(sheet)]),
  ])
}

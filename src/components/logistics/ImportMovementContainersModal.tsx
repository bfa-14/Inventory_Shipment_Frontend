import { useMemo, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconArrowLeft, IconChecks, IconClipboardCopy, IconDownload, IconFileSpreadsheet, IconListCheck } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containerStatusColour, saveBlob } from '../../api/logistics/containers'
import { movementsApi, type MovementContainerMatchDto, type MovementPlaceQuery } from '../../api/logistics/movements'
import { formatDateTime, formatNumber, todayDateOnly } from '../format'
import { buildWorkbook, readSpreadsheet, SpreadsheetError, type SheetRow } from '../spreadsheet'
import { notify } from '../ui/notify'
import { fromMatch, placeKey, placeText, WHOLE_BADGE, type CardContainer } from './movementContainers'

/** The template Bilal keeps in public/templates: a "Containers" sheet (header "Container no."), the instructions, an example. */
const TEMPLATE_URL = '/templates/Movement_Containers_Import_Template.xlsx'

const MAX_FILE_BYTES = 10 * 1024 * 1024

/** A header naming the column of container numbers, in English or French. */
const NUMBER_HEADER = /container|cntr|conteneur/i

type Outcome = 'add' | 'already' | 'notFound' | 'blocked' | 'twice' | 'duplicate'

const OUTCOMES: Record<Outcome, { label: string; colour: string }> = {
  add: { label: 'Will be added', colour: 'green' },
  already: { label: 'Already on this movement', colour: 'gray' },
  notFound: { label: 'Not found', colour: 'red' },
  blocked: { label: 'Cannot be added', colour: 'orange' },
  twice: { label: 'Found twice', colour: 'orange' },
  duplicate: { label: 'Duplicate', colour: 'gray' },
}

/** A number to check and where it came from: the row of the sheet, or its place in the pasted text. */
interface Entry {
  row: number
  value: string
}

interface Checked extends Entry {
  match: MovementContainerMatchDto
  outcome: Outcome
}

interface ImportMovementContainersModalProps {
  /** The movement (null = not saved yet) and its From, To and type on the page: what the numbers are checked against. */
  query: MovementPlaceQuery
  /** For the result file: its name and its Summary sheet. Null = not saved yet. */
  movementNo: string | null
  fromName: string
  /** Ticked in the card now, saved or not: shown as already on this movement. */
  tickedIds: ReadonlySet<number>
  /** On the saved movement: one unticked in the card can be ticked again by its number. */
  savedIds: ReadonlySet<number>
  /** Only the valid ones ("Will be added"): they are ticked in the card. */
  onTick: (containers: CardContainer[]) => void
  onClose: () => void
}

const columnLetter = (index: number) =>
  index < 26
    ? String.fromCharCode(65 + index)
    : String.fromCharCode(64 + Math.floor(index / 26)) + String.fromCharCode(65 + (index % 26))

/**
 * The first row is a header when it holds words: a cell naming the container column, or cells without a digit. A
 * container number or ref always has digits, so a list that starts on its first number keeps it.
 */
function readLayout(rows: SheetRow[]) {
  const first = rows.find((r) => r.cells.some((c) => c.trim() !== ''))
  const named = first ? first.cells.findIndex((c) => NUMBER_HEADER.test(c)) : -1
  const header =
    first !== undefined && (named >= 0 || first.cells.filter((c) => c.trim() !== '').every((c) => !/\d/.test(c)))
      ? first
      : null
  const data = header ? rows.filter((r) => r.rowNumber > header.rowNumber) : rows
  const width = Math.max(0, ...rows.map((r) => r.cells.length))
  const columns = Array.from({ length: width }, (_, i) => i)
    .filter((i) => data.some((r) => (r.cells[i] ?? '').trim() !== ''))
    .map((i) => {
      const title = header?.cells[i]?.trim()
      return { value: String(i), label: title ? `${title} (column ${columnLetter(i)})` : `Column ${columnLetter(i)}` }
    })
  return { data, columns, named: named >= 0 ? String(named) : null }
}

/**
 * One number per line, or several separated by commas, semicolons or tabs. Spaces separate numbers too, but only when
 * every piece is a whole number or ref (letters and digits): "MSCU 123 456 7" is one container written with spaces.
 */
function splitPasted(text: string): Entry[] {
  const values: string[] = []
  for (const line of text.split(/\r?\n/)) {
    for (const part of line.split(/[,;\t]/)) {
      const pieces = part.trim().split(/\s+/).filter(Boolean)
      const several = pieces.length > 1 && pieces.every((p) => p.length >= 6 && /[a-z]/i.test(p) && /\d/.test(p))
      values.push(...(several ? pieces : [part.trim()]))
    }
  }
  return values.filter((v) => v !== '').map((value, i) => ({ row: i + 1, value }))
}

function outcomeOf(m: MovementContainerMatchDto, tickedIds: ReadonlySet<number>, savedIds: ReadonlySet<number>): Outcome {
  switch (m.result) {
    case 'Ready':
      return m.containerId !== null && tickedIds.has(m.containerId) ? 'already' : 'add'
    case 'AlreadyOnMovement':
      // Saved on the movement but unticked in the card: the number ticks it again, if it may stay.
      return m.containerId !== null && savedIds.has(m.containerId) && !tickedIds.has(m.containerId)
        ? m.reason
          ? 'blocked'
          : 'add'
        : 'already'
    case 'NotFound':
      return 'notFound'
    case 'Blocked':
      return 'blocked'
    case 'Ambiguous':
      return 'twice'
    default:
      return 'duplicate'
  }
}

/**
 * "Import from Excel…": container numbers (or refs) from the first sheet of a file, or pasted, checked against the
 * movement's From, To and type (match-containers, the rules of script 49). Nothing is saved: only the rows that will be
 * added can be ticked in the card; every other row stays out with its reason, and the result can be downloaded. The
 * file is read in the browser (`readSpreadsheet`); the matching - normalised numbers, then refs - is the server's.
 */
export function ImportMovementContainersModal({
  query,
  movementNo,
  fromName,
  tickedIds,
  savedIds,
  onTick,
  onClose,
}: ImportMovementContainersModalProps) {
  const fullScreen = useMediaQuery('(max-width: 48em)')
  const inputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<string | null>('file')
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetRow[] | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [column, setColumn] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [results, setResults] = useState<Checked[] | null>(null)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [show, setShow] = useState<string | null>(null)

  const layout = useMemo(() => (sheet ? readLayout(sheet) : null), [sheet])

  const entries: Entry[] = useMemo(() => {
    if (tab === 'paste') return splitPasted(pasted)
    if (!layout || column === null) return []
    return layout.data
      .map((r) => ({ row: r.rowNumber, value: (r.cells[Number(column)] ?? '').trim() }))
      .filter((e) => e.value !== '')
  }, [tab, pasted, layout, column])

  async function chooseFile(file: File | null) {
    setSheet(null)
    setFileError(null)
    setFileName(file?.name ?? null)
    if (!file) return
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setFileError('Choose an Excel (.xlsx) or CSV file.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`The file is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.`)
      return
    }
    try {
      const rows = await readSpreadsheet(file)
      const read = readLayout(rows)
      if (read.columns.length === 0) {
        setFileError('The first sheet of this file is empty.')
        return
      }
      setSheet(rows)
      setColumn(read.named ?? read.columns[0].value)
    } catch (err) {
      setFileError(err instanceof SpreadsheetError ? err.message : 'The file could not be read.')
    }
  }

  async function check() {
    setChecking(true)
    setCheckError(null)
    try {
      const rows = await movementsApi.matchContainers(
        query,
        entries.map((e) => e.value),
      )
      setResults(
        rows.map((match) => {
          const entry = entries[match.rowNo - 1]
          return { ...entry, match, outcome: outcomeOf(match, tickedIds, savedIds) }
        }),
      )
      setCheckedAt(new Date())
      setShow(null)
    } catch (err) {
      // The server's sentence - "At most 500 container numbers at a time." - as it comes.
      setCheckError(err instanceof ApiError ? err.message : 'The numbers could not be checked.')
    } finally {
      setChecking(false)
    }
  }

  /** Sheet "Result" (one row per number, in the order of the file) and sheet "Summary" (the movement, the check, the counts). */
  function downloadResult() {
    if (!results) return
    const source = tab === 'paste' ? 'list' : 'file'
    const result = [
      ['Row', `Number from the ${source}`, 'Result', 'Reason', 'Container ref.', 'Container no.', 'Order(s)', 'Supplier(s)', 'Place', 'Status'],
      ...results.map((r) => {
        const m = r.match
        const reason = r.outcome === 'already' ? '' : (m.reason ?? (r.outcome === 'add' ? (m.note ?? '') : ''))
        return [
          String(r.row),
          r.value,
          OUTCOMES[r.outcome].label,
          reason,
          m.containerRef ?? '',
          m.containerNo ?? '',
          m.orderNumbers ?? '',
          m.supplierNames ?? '',
          m.containerId !== null && m.result !== 'Duplicate' ? placeText(m) : '',
          m.statusName ?? '',
        ]
      }),
    ]
    const summary = [
      ['Item', 'Value'],
      ['Movement', movementNo ?? 'New movement (not saved yet)'],
      ['From', fromName],
      ['Checked on', formatDateTime((checkedAt ?? new Date()).toISOString(), '')],
      [`Numbers in the ${source}`, String(results.length)],
      ...(Object.keys(OUTCOMES) as Outcome[]).map((o) => [OUTCOMES[o].label, String(n(o))]),
    ]
    saveBlob(
      buildWorkbook([
        { name: 'Result', rows: result, widths: [6, 22, 22, 60, 16, 16, 22, 26, 34, 14] },
        { name: 'Summary', rows: summary, widths: [26, 40] },
      ]),
      `Containers_check_${movementNo ?? 'new'}_${todayDateOnly()}.xlsx`,
    )
  }

  const counts = useMemo(() => {
    const map = new Map<Outcome, number>()
    for (const r of results ?? []) map.set(r.outcome, (map.get(r.outcome) ?? 0) + 1)
    return map
  }, [results])
  const n = (o: Outcome) => counts.get(o) ?? 0
  const toAdd = (results ?? []).filter((r) => r.outcome === 'add')
  const notFound = (results ?? []).filter((r) => r.outcome === 'notFound')
  const visible = (results ?? []).filter((r) => show === null || r.outcome === show)

  const summary = results
    ? [
        `${formatNumber(results.length)} ${results.length === 1 ? 'number' : 'numbers'}: ${formatNumber(n('add'))} will be added`,
        `${formatNumber(n('already'))} already on this movement`,
        `${formatNumber(n('notFound'))} not found`,
        `${formatNumber(n('blocked'))} cannot be added`,
        ...(n('twice') > 0 ? [`${formatNumber(n('twice'))} found twice`] : []),
        ...(n('duplicate') > 0
          ? [`${formatNumber(n('duplicate'))} ${n('duplicate') === 1 ? 'duplicate' : 'duplicates'}`]
          : []),
      ].join(', ')
    : ''

  async function copyNotFound() {
    try {
      await navigator.clipboard.writeText(notFound.map((r) => r.value).join('\n'))
      notify.success(`${formatNumber(notFound.length)} ${notFound.length === 1 ? 'number' : 'numbers'} copied.`)
    } catch {
      notify.error('The numbers could not be copied to the clipboard.')
    }
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title={`Import from Excel - containers at ${fromName}`}
      size="90rem"
      fullScreen={fullScreen}
      centered={!fullScreen}
    >
      {results === null ? (
        <Stack>
          <Tabs value={tab} onChange={setTab}>
            <Tabs.List mb="md">
              <Tabs.Tab value="file" leftSection={<IconFileSpreadsheet size={16} />}>
                File
              </Tabs.Tab>
              <Tabs.Tab value="paste" leftSection={<IconListCheck size={16} />}>
                Paste
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="file">
              <Stack>
                <Group justify="space-between" wrap="wrap" gap="xs">
                  <Text fz="sm" c="dimmed">
                    The first sheet is read; the column whose header says "container" is taken, else choose it.
                  </Text>
                  <Button
                    component="a"
                    href={TEMPLATE_URL}
                    download="Movement_Containers_Import_Template.xlsx"
                    variant="light"
                    size="xs"
                    leftSection={<IconDownload size={14} />}
                  >
                    Download a template
                  </Button>
                </Group>
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDragging(false)
                    void chooseFile(event.dataTransfer.files[0] ?? null)
                  }}
                  style={{
                    border: `2px dashed var(--mantine-color-${dragging ? 'blue' : 'gray'}-4)`,
                    borderRadius: 'var(--mantine-radius-md)',
                    padding: 'var(--mantine-spacing-xl)',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: dragging ? 'var(--mantine-color-blue-0)' : undefined,
                  }}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    hidden
                    onChange={(event) => {
                      void chooseFile(event.currentTarget.files?.[0] ?? null)
                      event.currentTarget.value = ''
                    }}
                  />
                  {fileName ? (
                    <Text fw={500}>{fileName}</Text>
                  ) : (
                    <Stack gap={4}>
                      <Text fw={500}>Drag and drop your file here</Text>
                      <Text size="sm" c="dimmed">
                        or click to browse. .xlsx, .xls or .csv, up to 10 MB.
                      </Text>
                    </Stack>
                  )}
                </Box>
                {fileError ? (
                  <Alert color="red" title="That file cannot be read">
                    {fileError}
                  </Alert>
                ) : null}
                {layout ? (
                  <Select
                    label="Column with the container numbers"
                    description={layout.named !== null && column === layout.named ? 'Found by its header.' : undefined}
                    data={layout.columns}
                    value={column}
                    onChange={setColumn}
                    allowDeselect={false}
                    maw={420}
                  />
                ) : null}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="paste">
              <Textarea
                label="Container numbers"
                description="One number per line, or separated by commas, semicolons, spaces or tabs. Refs work too."
                placeholder={'MSCU1234567\nTGHU 765432 1'}
                autosize
                minRows={6}
                maxRows={14}
                value={pasted}
                onChange={(event) => setPasted(event.currentTarget.value)}
              />
            </Tabs.Panel>
          </Tabs>

          {checkError ? <Alert color="red">{checkError}</Alert> : null}

          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text fz="sm" c="dimmed">
              {entries.length > 0
                ? `${formatNumber(entries.length)} ${entries.length === 1 ? 'number' : 'numbers'} to check.`
                : ''}
            </Text>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void check()} loading={checking} disabled={entries.length === 0}>
                Check
              </Button>
            </Group>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Text fw={500}>{summary}</Text>
          <Group justify="space-between" wrap="wrap" gap="xs" align="flex-end">
            <Select
              label="Result"
              placeholder="All"
              data={(Object.keys(OUTCOMES) as Outcome[])
                .filter((o) => n(o) > 0)
                .map((o) => ({ value: o, label: `${OUTCOMES[o].label} (${formatNumber(n(o))})` }))}
              value={show}
              onChange={setShow}
              clearable
              w={280}
            />
            <Group gap="xs">
              <Button
                variant="light"
                leftSection={<IconClipboardCopy size={16} />}
                disabled={notFound.length === 0}
                onClick={() => void copyNotFound()}
              >
                Copy the numbers not found
              </Button>
              <Button variant="light" leftSection={<IconDownload size={16} />} onClick={downloadResult}>
                Download the result
              </Button>
            </Group>
          </Group>

          <ScrollArea.Autosize mah={fullScreen ? 'calc(100dvh - 20rem)' : '55vh'} type="auto">
            <Table miw={1100} verticalSpacing={4} stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th ta="right">Row</Table.Th>
                  <Table.Th>Number from the {tab === 'paste' ? 'list' : 'file'}</Table.Th>
                  <Table.Th>Container</Table.Th>
                  <Table.Th>Order</Table.Th>
                  <Table.Th>Supplier</Table.Th>
                  <Table.Th>Place</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Result</Table.Th>
                  <Table.Th>Reason</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.map((r) => {
                  const m = r.match
                  const reason = r.outcome === 'already' ? null : m.reason
                  return (
                    <Table.Tr key={m.rowNo}>
                      <Table.Td ta="right">{formatNumber(r.row)}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{r.value}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        {m.containerRef ? (
                          <>
                            <Text fz="sm" fw={600}>
                              {m.containerRef}
                            </Text>
                            <Text fz="xs" c="dimmed">
                              {m.containerNo ?? '—'}
                            </Text>
                          </>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{m.orderNumbers ?? '—'}</Table.Td>
                      <Table.Td>{m.supplierNames ?? '—'}</Table.Td>
                      <Table.Td>{m.containerId !== null && m.result !== 'Duplicate' ? placeText(m) : '—'}</Table.Td>
                      <Table.Td>
                        {m.statusName && m.status !== null ? (
                          <Badge color={containerStatusColour(m.status)} variant="light" styles={WHOLE_BADGE}>
                            {m.statusName}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          color={OUTCOMES[r.outcome].colour}
                          variant={r.outcome === 'add' ? 'filled' : 'light'}
                          styles={WHOLE_BADGE}
                        >
                          {OUTCOMES[r.outcome].label}
                        </Badge>
                      </Table.Td>
                      <Table.Td maw={340}>
                        <Text
                          fz="xs"
                          c={
                            r.outcome === 'blocked' || r.outcome === 'notFound' || r.outcome === 'twice'
                              ? 'red.7'
                              : 'dimmed'
                          }
                        >
                          {reason ?? (r.outcome === 'add' ? (m.note ?? '') : '')}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>

          <Group justify="space-between" wrap="wrap" gap="xs">
            <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => setResults(null)}>
              Change the list
            </Button>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button
                leftSection={<IconChecks size={16} />}
                disabled={toAdd.length === 0}
                onClick={() => {
                  onTick(
                    toAdd
                      .map((r) => r.match)
                      .filter((m): m is MovementContainerMatchDto & { containerId: number } => m.containerId !== null)
                      .map((m) => fromMatch(m, placeKey(query))),
                  )
                  onClose()
                }}
              >
                Tick the {formatNumber(toAdd.length)} valid {toAdd.length === 1 ? 'container' : 'containers'}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

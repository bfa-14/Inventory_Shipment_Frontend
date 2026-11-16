import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Group, Modal, ScrollArea, Stack, Table, Tabs, Text, Textarea } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconDownload, IconFileSpreadsheet, IconListCheck } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { saveBlob } from '../../api/logistics/containers'
import {
  shipmentStagesApi,
  type ApplyShipmentStageItem,
  type ApplyShipmentStageResultDto,
  type ShipmentStageDto,
} from '../../api/logistics/shipmentStages'
import { formatNumber, todayDateOnly } from '../format'
import { buildWorkbook, readSpreadsheet, SpreadsheetError, type SheetRow } from '../spreadsheet'
import { notify } from '../ui/notify'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_ROWS = 5000
const HEADERS = ['Container no.', 'New stage', 'Date', 'Truck / vessel no.', 'ETA']

type Outcome = 'move' | 'there' | 'cannot' | 'notFound' | 'twice' | 'badStage' | 'badDate' | 'duplicate'

const OUTCOMES: Record<Outcome, { label: string; colour: string }> = {
  move: { label: 'Will move', colour: 'green' },
  there: { label: 'Already there', colour: 'gray' },
  cannot: { label: 'Cannot move', colour: 'red' },
  notFound: { label: 'Not found', colour: 'red' },
  twice: { label: 'Found twice', colour: 'orange' },
  badStage: { label: 'Unknown stage', colour: 'orange' },
  badDate: { label: 'Wrong date', colour: 'orange' },
  duplicate: { label: 'Duplicate', colour: 'gray' },
}

/** One row of the forwarder's list, as typed. */
interface Entry {
  row: number
  number: string
  stage: string
  date: string
  vehicle: string
  eta: string
}

interface Checked extends Entry {
  outcome: Outcome
  reason: string | null
  containerId: number | null
  containerRef: string | null
  currentStage: string | null
  item: ApplyShipmentStageItem | null
}

/**
 * "05/11/2026", "5-11-2026", "2026-11-05" or an Excel date (a day number such as 46331) to 'YYYY-MM-DD'; empty: null;
 * anything else: undefined (a wrong date).
 */
function parseSheetDate(text: string): string | null | undefined {
  const value = text.trim()
  if (!value) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const valid = (y: number, m: number, d: number) => {
    const date = new Date(y, m - 1, d)
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : undefined
  }
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
  if (match) return valid(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value)
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
    return valid(year, Number(match[2]), Number(match[1]))
  }
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    // Excel counts days from 30/12/1899.
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(value)) * 86_400_000)
    return valid(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }
  return undefined
}

/** The pasted text: one container a line, its cells separated by tabs (from Excel), semicolons or commas. */
function pastedRows(text: string): SheetRow[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ rowNumber: index + 1, cells: line.split(line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',') }))
    .filter((row) => row.cells.some((cell) => cell.trim() !== ''))
}

/** The rows after the header (a first row that names "Container" or has no digit). */
function toEntries(rows: SheetRow[]): Entry[] {
  const first = rows[0]
  const header = first && (first.cells.some((c) => /container|conteneur|stage/i.test(c)) || !first.cells.some((c) => /\d/.test(c)))
  return (header ? rows.slice(1) : rows)
    .map((r) => ({
      row: r.rowNumber,
      number: (r.cells[0] ?? '').trim(),
      stage: (r.cells[1] ?? '').trim(),
      date: (r.cells[2] ?? '').trim(),
      vehicle: (r.cells[3] ?? '').trim(),
      eta: (r.cells[4] ?? '').trim(),
    }))
    .filter((e) => e.number !== '')
}

/** A stage by its name as typed: case, spaces and the arrow written "->" or ">" do not matter. */
const stageKey = (text: string) => text.toLowerCase().replace(/->|=>|>/g, '→').replace(/\s+/g, ' ').trim()

interface ImportStagesModalProps {
  onClose(): void
  onDone(): void
}

/**
 * (111) The forwarder's list: "Container no. | New stage | Date | Truck / vessel no. | ETA", from an Excel file or pasted.
 * Each row is checked first - the container found by its number or ref, the stage by its name, the date, and what the
 * stage does to it (the server's preview) - then only the rows that will move are applied, each with its own result.
 */
export function ImportStagesModal({ onClose, onDone }: ImportStagesModalProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const fileInput = useRef<HTMLInputElement>(null)
  const [stages, setStages] = useState<ShipmentStageDto[]>([])
  const [pasted, setPasted] = useState('')
  const [checked, setChecked] = useState<Checked[] | null>(null)
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ApplyShipmentStageResultDto | null>(null)

  useEffect(() => {
    shipmentStagesApi
      .list(true)
      .then(setStages)
      .catch(() => setError('The stages could not be loaded.'))
  }, [])

  function downloadTemplate() {
    const example = stages.length > 0 ? stages : [{ stageName: 'At port Dar es Salaam' } as ShipmentStageDto]
    saveBlob(
      buildWorkbook([
        { name: 'Stages', rows: [HEADERS, ['MSKU1234565', example[0].stageName, todayDateOnly().split('-').reverse().join('/'), '', '']], widths: [18, 32, 14, 20, 14] },
        { name: 'Stage names', rows: [['New stage (type one of these)'], ...stages.map((s) => [s.stageName])], widths: [40] },
      ]),
      'Container_Stages_Import.xlsx',
    )
  }

  async function check(rows: SheetRow[]) {
    const entries = toEntries(rows)
    if (entries.length === 0) {
      setError('No container numbers found: the first column must hold them.')
      return
    }
    if (entries.length > MAX_ROWS) {
      setError(`At most ${formatNumber(MAX_ROWS)} rows at a time.`)
      return
    }
    setBusy('check')
    setError(null)
    try {
      const byName = new Map(stages.map((s) => [stageKey(s.stageName), s]))
      const matches = await shipmentStagesApi.match(entries.map((e) => e.number))
      const seen = new Set<number>()
      const out: Checked[] = entries.map((entry, i) => {
        const match = matches[i]
        const base: Checked = { ...entry, outcome: 'move', reason: null, containerId: match?.containerId ?? null, containerRef: match?.containerRef ?? null, currentStage: null, item: null }
        if (!match || match.matches === 0) return { ...base, outcome: 'notFound', reason: 'No container has this number or ref.' }
        if (match.containerId === null) return { ...base, outcome: 'twice', reason: `${match.matches} open containers have this number: use the ref (KTG-…).` }
        if (seen.has(match.containerId)) return { ...base, outcome: 'duplicate', reason: 'This container is on an earlier row.' }
        seen.add(match.containerId)
        const stage = byName.get(stageKey(entry.stage))
        if (!stage) return { ...base, outcome: 'badStage', reason: entry.stage ? `"${entry.stage}" is not a stage: see the sheet "Stage names" of the template.` : 'The stage is empty.' }
        const date = entry.date ? parseSheetDate(entry.date) : todayDateOnly()
        const eta = parseSheetDate(entry.eta)
        if (!date || eta === undefined) return { ...base, outcome: 'badDate', reason: 'Write the dates as 05/11/2026.' }
        if (date > todayDateOnly()) return { ...base, outcome: 'badDate', reason: 'The date is in the future.' }
        return { ...base, item: { containerId: match.containerId, stageId: stage.id, date, vehicleOrVessel: entry.vehicle || null, eta } }
      })

      // What each stage does to its containers: the server's preview, one call per stage.
      const byStage = new Map<number, Checked[]>()
      for (const row of out) if (row.item) byStage.set(row.item.stageId, [...(byStage.get(row.item.stageId) ?? []), row])
      for (const [stageId, list] of byStage) {
        const preview = await shipmentStagesApi.preview(stageId, list.map((r) => r.item!.containerId))
        const byId = new Map(preview.map((p) => [p.containerId, p]))
        for (const row of list) {
          const p = byId.get(row.item!.containerId)
          row.currentStage = p?.currentStageName ?? null
          if (!p || p.alreadyThere) {
            row.outcome = 'there'
            row.item = null
          } else if (!p.canMove) {
            row.outcome = 'cannot'
            row.reason = p.reason
            row.item = null
          } else {
            row.reason = p.receiveWarning
          }
        }
      }
      setChecked(out)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The list could not be checked.')
    } finally {
      setBusy(null)
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError('The file is larger than 10 MB.')
      return
    }
    try {
      await check(await readSpreadsheet(file))
    } catch (e) {
      setError(e instanceof SpreadsheetError ? e.message : 'The file could not be read.')
    }
  }

  async function apply() {
    const items = (checked ?? []).filter((r) => r.outcome === 'move' && r.item).map((r) => r.item!)
    if (items.length === 0) return
    setBusy('apply')
    setError(null)
    try {
      const answer = await shipmentStagesApi.apply(items)
      setResult(answer)
      if (answer.moved > 0) {
        notify.success(answer.message)
        onDone()
      } else notify.error(answer.message)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The containers could not be moved.')
    } finally {
      setBusy(null)
    }
  }

  const counts = new Map<Outcome, number>()
  for (const row of checked ?? []) counts.set(row.outcome, (counts.get(row.outcome) ?? 0) + 1)
  const toMove = counts.get('move') ?? 0

  return (
    <Modal opened onClose={onClose} title="Update stages from the forwarder's list" size="xl" fullScreen={phone} closeOnClickOutside={busy === null}>
      <Stack gap="sm">
        {error ? <Alert color="red">{error}</Alert> : null}

        {result ? (
          <>
            <Alert color={result.refused > 0 ? 'orange' : 'green'} py={6}>
              {result.message}
            </Alert>
            <ScrollArea.Autosize mah={420}>
              <Stack gap={6}>
                {result.items.map((item) => (
                  <Stack key={item.containerId} gap={0}>
                    <Group gap="xs" wrap="nowrap" align="flex-start">
                      <Badge size="sm" variant="light" color={item.ok ? 'green' : item.skipped ? 'gray' : 'red'} style={{ flexShrink: 0 }}>
                        {item.ok ? 'Moved' : item.skipped ? 'Already there' : 'Refused'}
                      </Badge>
                      <Text fz="sm">{item.message}</Text>
                    </Group>
                    {item.warning ? (
                      <Text fz="xs" c="orange.8" pl={90}>
                        {item.warning}
                      </Text>
                    ) : null}
                  </Stack>
                ))}
              </Stack>
            </ScrollArea.Autosize>
            <Group justify="flex-end">
              <Button onClick={onClose}>Close</Button>
            </Group>
          </>
        ) : checked ? (
          <>
            <Group gap="xs">
              {(Object.keys(OUTCOMES) as Outcome[])
                .filter((key) => counts.has(key))
                .map((key) => (
                  <Badge key={key} variant="light" color={OUTCOMES[key].colour}>
                    {OUTCOMES[key].label}: {formatNumber(counts.get(key) ?? 0)}
                  </Badge>
                ))}
            </Group>
            <ScrollArea.Autosize mah={420}>
              <Table striped withTableBorder fz="sm" verticalSpacing={4} miw={640}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Row</Table.Th>
                    <Table.Th>Container</Table.Th>
                    <Table.Th>Now</Table.Th>
                    <Table.Th>New stage</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {checked.map((row) => (
                    <Table.Tr key={row.row}>
                      <Table.Td>{row.row}</Table.Td>
                      <Table.Td>
                        <Text fz="sm" fw={500}>
                          {row.containerRef ?? row.number}
                        </Text>
                        {row.containerRef ? (
                          <Text fz="xs" c="dimmed">
                            {row.number}
                          </Text>
                        ) : null}
                      </Table.Td>
                      <Table.Td>{row.currentStage ?? '-'}</Table.Td>
                      <Table.Td>{row.stage || '-'}</Table.Td>
                      <Table.Td>{row.date || 'today'}</Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={OUTCOMES[row.outcome].colour}>
                          {OUTCOMES[row.outcome].label}
                        </Badge>
                        {row.reason ? (
                          <Text fz="xs" c={row.outcome === 'move' ? 'orange.8' : 'dimmed'} maw={300}>
                            {row.reason}
                          </Text>
                        ) : null}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
            <Group justify="space-between">
              <Button variant="subtle" onClick={() => setChecked(null)} disabled={busy !== null}>
                Back
              </Button>
              <Group gap="xs">
                <Button variant="default" onClick={onClose} disabled={busy !== null}>
                  Cancel
                </Button>
                <Button onClick={() => void apply()} loading={busy === 'apply'} disabled={toMove === 0}>
                  {toMove === 1 ? 'Move 1 container' : `Move ${formatNumber(toMove)} containers`}
                </Button>
              </Group>
            </Group>
          </>
        ) : (
          <>
            <Text fz="sm">
              One row per container: <b>Container no.</b> (or the ref), <b>New stage</b> (its name as in the list of stages),{' '}
              <b>Date</b> (empty: today), and for a leg its <b>Truck / vessel no.</b> and <b>ETA</b>. Each row is checked before
              anything moves.
            </Text>
            <Group>
              <Button variant="default" leftSection={<IconDownload size={16} />} onClick={downloadTemplate} disabled={stages.length === 0}>
                Download the template
              </Button>
            </Group>
            <Tabs defaultValue="file">
              <Tabs.List>
                <Tabs.Tab value="file" leftSection={<IconFileSpreadsheet size={14} />}>
                  Excel file
                </Tabs.Tab>
                <Tabs.Tab value="paste" leftSection={<IconListCheck size={14} />}>
                  Paste
                </Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="file" pt="sm">
                <input ref={fileInput} type="file" accept=".xlsx,.csv" hidden onChange={(e) => void onFile(e.currentTarget.files?.[0])} />
                <Button leftSection={<IconFileSpreadsheet size={16} />} onClick={() => fileInput.current?.click()} loading={busy === 'check'} disabled={stages.length === 0}>
                  Choose the file…
                </Button>
              </Tabs.Panel>
              <Tabs.Panel value="paste" pt="sm">
                <Stack gap="xs">
                  <Textarea
                    autosize
                    minRows={6}
                    maxRows={14}
                    placeholder={'MSKU1234565\tAt port Dar es Salaam\t05/11/2026\nMRSU8190808\tDar es Salaam → Mokambo\t06/11/2026\tT 123 ABC'}
                    value={pasted}
                    onChange={(e) => setPasted(e.currentTarget.value)}
                  />
                  <Group justify="flex-end">
                    <Button onClick={() => void check(pastedRows(pasted))} loading={busy === 'check'} disabled={!pasted.trim() || stages.length === 0}>
                      Check
                    </Button>
                  </Group>
                </Stack>
              </Tabs.Panel>
            </Tabs>
          </>
        )}
      </Stack>
    </Modal>
  )
}

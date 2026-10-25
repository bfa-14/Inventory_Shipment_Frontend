import { useMemo, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Stepper,
  Table,
  Text,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconDownload, IconFileSpreadsheet } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  STOCK_LEVELS_MAX_FILE_BYTES,
  stockLevelsApi,
  type StockLevelImportOutcome,
  type StockLevelImportResult,
  type StockLevelImportRow,
  type StockLevelImportStatus,
  type StockLevelImportValidation,
} from '../../api/inventory/stockLevels'
import { formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { levelText } from './stockLevelStatus'

export interface ImportStockLevelsWizardProps {
  opened: boolean
  onClose(): void
  /** After an import that changed something: the host reloads its list. */
  onImported(): void
}

const STATUS_COLOURS: Record<StockLevelImportStatus, string> = {
  Valid: 'green',
  Warning: 'orange',
  Error: 'red',
  Unchanged: 'gray',
}

const OUTCOME_COLOURS: Record<StockLevelImportOutcome, string> = {
  Added: 'green',
  Changed: 'blue',
  Removed: 'red',
  Unchanged: 'gray',
  Skipped: 'orange',
}

const ACTION_LABELS: Record<string, string> = { Set: 'Set', Remove: 'Remove', None: 'No change' }

/** Long files are drawn this many rows at a time ("Show more"), like every list of any length. */
const PAGE = 200

const MB = STOCK_LEVELS_MAX_FILE_BYTES / (1024 * 1024)

/** The rows that change something: Valid and Warning rows that set or remove a level. */
function isChange(row: StockLevelImportRow): boolean {
  return (row.status === 'Valid' || row.status === 'Warning') && (row.action === 'Set' || row.action === 'Remove')
}

/**
 * "IMPORT FROM EXCEL…" ON INVENTORY › STOCK LEVELS (script 91, rules S11-S13): stock levels from a file, in three steps -
 * choose the file, check what the server made of every row, then import - the steps and rules of the container charges'
 * import (ImportContainerChargesWizard).
 *
 * ONE ROW = ONE ITEM IN ONE WAREHOUSE: Item Code / Barcode, Warehouse (code, or a name no other warehouse has), Min
 * (pcs), Max (pcs), Remove (Yes). Other columns are ignored, so an export of the page can be edited and imported back:
 * every row it did not change comes back "No change".
 *
 * ALL TOGETHER, OR NOT AT ALL. Unlike the charges (each row on its own), every Valid and Warning row is saved in ONE
 * transaction, judged again by the same rule (inventory.fn_ItemWarehouseLevel_ImportJudge); Error and Unchanged rows are
 * skipped and said so. The server's sentences are shown as they come.
 */
export function ImportStockLevelsWizard(props: ImportStockLevelsWizardProps) {
  // Keyed on opened: every run starts from an empty step 1, never the last file's rows.
  return <WizardBody key={props.opened ? 'open' : 'closed'} {...props} />
}

function WizardBody({ opened, onClose, onImported }: ImportStockLevelsWizardProps) {
  const fullScreen = useMediaQuery('(max-width: 768px)')

  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState<StockLevelImportValidation | null>(null)
  const [filter, setFilter] = useState<'all' | StockLevelImportStatus>('all')
  const [shown, setShown] = useState(PAGE)

  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [result, setResult] = useState<StockLevelImportResult | null>(null)
  const [resultShown, setResultShown] = useState(PAGE)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const rows = useMemo(() => validation?.rows ?? [], [validation])
  const changes = useMemo(() => rows.filter(isChange), [rows])
  const visible = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)), [rows, filter])

  const counts = validation?.counts ?? { set: 0, remove: 0, unchanged: 0, warnings: 0, errors: 0 }
  /** Step 3's sentence: the set rows split into new levels and levels replaced. */
  const plan = useMemo(() => {
    const sets = changes.filter((r) => r.action === 'Set')
    const changed = sets.filter((r) => r.hasLevel === true || r.currentMinBase !== null).length
    return {
      added: sets.length - changed,
      changed,
      removed: changes.filter((r) => r.action === 'Remove').length,
    }
  }, [changes])

  /* ── step 1 ─────────────────────────────────────────────────────────────────────────────────── */

  /** Checked here for WHEN, not whether: a 12 MB file refused before it is uploaded saves a wait. The server checks again. */
  function chooseFile(next: File | null) {
    setFileError(null)
    if (!next) {
      setFile(null)
      return
    }
    if (!next.name.toLowerCase().endsWith('.xlsx')) {
      setFile(null)
      setFileError('The file must be an Excel workbook (.xlsx).')
      return
    }
    if (next.size > STOCK_LEVELS_MAX_FILE_BYTES) {
      setFile(null)
      setFileError(`The file is larger than ${MB} MB.`)
      return
    }
    setFile(next)
  }

  async function downloadTemplate() {
    try {
      await stockLevelsApi.downloadTemplate()
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The template could not be downloaded.')
    }
  }

  async function check() {
    if (!file) return
    setValidating(true)
    setFileError(null)
    try {
      const answer = await stockLevelsApi.validate(file)
      setValidation({ ...answer, rows: answer.rows ?? [] })
      setFilter('all')
      setShown(PAGE)
      setStep(1)
    } catch (error) {
      // INVALID_FILE ("The file does not have the template's columns: …") is written for the person holding the file.
      setFileError(error instanceof ApiError ? error.messages.join(' ') : 'The file could not be checked.')
    } finally {
      setValidating(false)
    }
  }

  /* ── step 2 ─────────────────────────────────────────────────────────────────────────────────── */

  async function downloadErrorReport() {
    try {
      await stockLevelsApi.downloadErrorReport(rows.filter((r) => r.status === 'Warning' || r.status === 'Error'))
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The error report could not be downloaded.')
    }
  }

  function chooseAnotherFile() {
    setValidation(null)
    setFile(null)
    setFileError(null)
    setStep(0)
  }

  /* ── step 3 ─────────────────────────────────────────────────────────────────────────────────── */

  async function runImport() {
    if (changes.length === 0 || !validation) return
    setImporting(true)
    setImportError(null)
    try {
      // Every row goes back as it was checked: the server judges them all again and counts the skipped ones too.
      const answer = await stockLevelsApi.importRows({ fileName: validation.fileName || file?.name || null, rows })
      setResult(answer)
      setResultShown(PAGE)
      if (answer.added + answer.changed + answer.removed > 0) {
        notify.success(answer.message)
        onImported()
      } else {
        notify.info(answer.message)
      }
    } catch (error) {
      // The whole call refused (a level changed meanwhile, a warehouse deactivated…): nothing was saved.
      setImportError(error instanceof ApiError ? error.messages.join(' ') : 'The stock levels could not be imported.')
    } finally {
      setImporting(false)
    }
  }

  async function requestClose() {
    if (importing) return
    if (validation !== null && result === null && changes.length > 0) {
      const go = await confirm({
        title: 'Discard this import?',
        message: `${formatNumber(changes.length)} change${changes.length === 1 ? ' has' : 's have'} been checked but not imported. Closing now discards them.`,
        confirmLabel: 'Discard',
        danger: true,
      })
      if (!go) return
    }
    onClose()
  }

  const rowByNumber = useMemo(() => new Map(rows.map((r) => [r.rowNumber, r])), [rows])

  return (
    <Modal
      opened={opened}
      onClose={() => void requestClose()}
      title="Import stock levels from Excel"
      size={1280}
      fullScreen={fullScreen}
      centered={!fullScreen}
      closeOnClickOutside={!importing}
      closeOnEscape={!importing}
      withCloseButton={!importing}
    >
      <Stepper active={result ? 3 : step} size="sm" mb="lg" allowNextStepsSelect={false}>
        <Stepper.Step label="Choose a file" description={fullScreen ? undefined : 'An .xlsx'} />
        <Stepper.Step label="Check" description={fullScreen ? undefined : 'Every row judged'} />
        <Stepper.Step label="Import" description={fullScreen ? undefined : 'All changes together'} />
      </Stepper>

      {step === 0 && (
        <Stack>
          <Alert color="blue" title="Use the template">
            <Stack gap="xs" align="flex-start">
              <Text size="sm">
                One row is one item in one warehouse: Item Code / Barcode, Warehouse (its code), Min (pcs), Max (pcs) and
                Remove (Yes removes the level). Other columns are ignored, so an export of this page can be edited and
                imported back.
              </Text>
              <Button
                variant="light"
                size="xs"
                leftSection={<IconDownload size={14} />}
                onClick={() => void downloadTemplate()}
              >
                Download the template
              </Button>
            </Stack>
          </Alert>

          {/* A plain drop target, as in the other imports: drag and drop, a click in it, or its button from the keyboard. */}
          <Box
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              chooseFile(event.dataTransfer.files?.[0] ?? null)
            }}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed var(--mantine-color-${dragging ? 'blue' : 'gray'}-4)`,
              borderRadius: 'var(--mantine-radius-md)',
              padding: 'var(--mantine-spacing-xl)',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragging ? 'var(--mantine-color-blue-0)' : undefined,
            }}
            data-stock-levels-drop
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(event) => {
                const picked = event.currentTarget.files?.[0] ?? null
                event.currentTarget.value = ''
                chooseFile(picked)
              }}
            />
            {file ? (
              <Group justify="center" gap="xs">
                <IconFileSpreadsheet size={18} />
                <Text fw={500} style={{ wordBreak: 'break-all' }}>
                  {file.name}
                </Text>
                <Text c="dimmed" size="sm">
                  ({formatNumber(file.size / 1024)} KB)
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  aria-label="Remove the file"
                  onClick={(event) => {
                    event.stopPropagation()
                    chooseFile(null)
                  }}
                >
                  ✕
                </Button>
              </Group>
            ) : (
              <Stack gap={6} align="center">
                <Text fw={500}>Drag and drop your file here, or</Text>
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconFileSpreadsheet size={14} />}
                  onClick={(event) => {
                    event.stopPropagation()
                    inputRef.current?.click()
                  }}
                >
                  Choose a file…
                </Button>
                <Text size="sm" c="dimmed">
                  .xlsx only, up to {MB} MB and 20,000 rows.
                </Text>
              </Stack>
            )}
          </Box>

          {fileError && (
            <Alert color="red" title="That file cannot be imported" data-stock-levels-file-error>
              {fileError}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => void requestClose()}>
              Cancel
            </Button>
            <Button disabled={!file} loading={validating} onClick={() => void check()}>
              Check the file
            </Button>
          </Group>
        </Stack>
      )}

      {step === 1 && validation && (
        <Stack>
          <SimpleGrid cols={{ base: 2, sm: 5 }}>
            <SummaryCard label="To set" value={counts.set} colour="green" />
            <SummaryCard label="To remove" value={counts.remove} colour="red" />
            <SummaryCard label="Without a change" value={counts.unchanged} />
            <SummaryCard label="Warnings" value={counts.warnings} colour="orange" />
            <SummaryCard label="Errors" value={counts.errors} colour="red" />
          </SimpleGrid>
          <Text fz="sm" data-stock-levels-counts>
            {formatNumber(counts.set)} to set, {formatNumber(counts.remove)} to remove, {formatNumber(counts.unchanged)}{' '}
            without a change, {formatNumber(counts.warnings)} warning{counts.warnings === 1 ? '' : 's'},{' '}
            {formatNumber(counts.errors)} error{counts.errors === 1 ? '' : 's'}.
          </Text>

          <Chip.Group
            multiple={false}
            value={filter}
            onChange={(v) => {
              setFilter(v as typeof filter)
              setShown(PAGE)
            }}
          >
            <Group gap="xs">
              <Chip value="all">All ({formatNumber(rows.length)})</Chip>
              <Chip value="Valid" color="green">
                Valid ({formatNumber(rows.filter((r) => r.status === 'Valid').length)})
              </Chip>
              <Chip value="Warning" color="orange">
                Warnings ({formatNumber(counts.warnings)})
              </Chip>
              <Chip value="Error" color="red">
                Errors ({formatNumber(counts.errors)})
              </Chip>
              <Chip value="Unchanged" color="gray">
                Unchanged ({formatNumber(counts.unchanged)})
              </Chip>
            </Group>
          </Chip.Group>

          <ScrollArea.Autosize mah={fullScreen ? undefined : 360} type="auto">
            <Table striped highlightOnHover stickyHeader miw={1100} verticalSpacing={6} data-stock-levels-check>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={60}>Row</Table.Th>
                  <Table.Th miw={170}>Item</Table.Th>
                  <Table.Th miw={150}>Warehouse</Table.Th>
                  <Table.Th ta="right">Min</Table.Th>
                  <Table.Th ta="right">Max</Table.Th>
                  <Table.Th miw={130}>Now</Table.Th>
                  <Table.Th>Action</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th miw={240}>Message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.slice(0, shown).map((row) => (
                  <Table.Tr key={row.rowNumber}>
                    <Table.Td>{row.rowNumber}</Table.Td>
                    <Table.Td>
                      {row.itemCode ? (
                        <>
                          <Text fz="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
                            {row.itemCode}
                          </Text>
                          {row.itemName ? (
                            <Text fz="xs" c="dimmed">
                              {row.itemName}
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text fz="sm" c={row.itemInput ? 'red' : 'dimmed'}>
                          {row.itemInput ?? '—'}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {row.warehouseCode ? (
                        <>
                          <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
                            {row.warehouseCode}
                          </Text>
                          {row.branchCode ? (
                            <Text fz="xs" c="dimmed">
                              {row.branchCode}
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text fz="sm" c={row.warehouseInput ? 'red' : 'dimmed'}>
                          {row.warehouseInput ?? '—'}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">{cellNumber(row.minQuantityBase, row.rawMin)}</Table.Td>
                    <Table.Td ta="right">{cellNumber(row.maxQuantityBase, row.rawMax)}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <Text fz="sm" c={row.currentMinBase === null ? 'dimmed' : undefined}>
                        {levelText(row.currentMinBase, row.currentMaxBase)}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{ACTION_LABELS[row.action] ?? row.action}</Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COLOURS[row.status] ?? 'gray'} variant="light">
                        {row.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c={row.status === 'Error' ? 'red' : row.status === 'Warning' ? 'orange.8' : 'dimmed'}>
                        {row.message ?? ''}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {visible.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={9}>
                      <Text ta="center" c="dimmed" py="md">
                        No rows with that status.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          {visible.length > shown ? (
            <Group justify="center">
              <Button variant="subtle" size="xs" onClick={() => setShown((n) => n + PAGE)}>
                Show more ({formatNumber(visible.length - shown)} more rows)
              </Button>
            </Group>
          ) : null}

          <Group justify="space-between" gap="sm">
            <Button variant="subtle" onClick={chooseAnotherFile}>
              Choose another file
            </Button>
            <Group gap="sm" justify="flex-end">
              <Button variant="default" onClick={() => void requestClose()}>
                Cancel
              </Button>
              {counts.errors + counts.warnings > 0 && (
                <Button variant="light" leftSection={<IconDownload size={16} />} onClick={() => void downloadErrorReport()}>
                  Download the error report
                </Button>
              )}
              <ContinueButton count={changes.length} onClick={() => setStep(2)} />
            </Group>
          </Group>
        </Stack>
      )}

      {step === 2 && validation && result === null && (
        <Stack>
          <Alert color="blue" title={`${formatNumber(changes.length)} change${changes.length === 1 ? '' : 's'} to import`}>
            <Text size="sm" data-stock-levels-plan>
              {formatNumber(plan.added)} level{plan.added === 1 ? '' : 's'} added, {formatNumber(plan.changed)} changed,{' '}
              {formatNumber(plan.removed)} removed; {formatNumber(counts.unchanged)} row
              {counts.unchanged === 1 ? '' : 's'} without a change and {formatNumber(counts.errors)} row
              {counts.errors === 1 ? '' : 's'} with errors are skipped. All changes are saved together.
            </Text>
          </Alert>

          {importError ? (
            <Alert color="red" title="Nothing was imported" data-stock-levels-import-error>
              {importError}
            </Alert>
          ) : null}

          {importing && (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm">Importing {formatNumber(changes.length)} changes…</Text>
            </Group>
          )}

          <Group justify="space-between" gap="sm">
            <Button variant="subtle" onClick={() => setStep(1)} disabled={importing}>
              Back
            </Button>
            <Group gap="sm" justify="flex-end">
              <Button variant="default" onClick={() => void requestClose()} disabled={importing}>
                Cancel
              </Button>
              <Button loading={importing} onClick={() => void runImport()}>
                Import {formatNumber(changes.length)} change{changes.length === 1 ? '' : 's'}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}

      {result && (
        <Stack>
          <Alert
            color={result.added + result.changed + result.removed > 0 ? 'green' : 'gray'}
            data-stock-levels-result
          >
            {result.message}
          </Alert>

          <ScrollArea.Autosize mah={fullScreen ? undefined : 380} type="auto">
            <Table withTableBorder withColumnBorders miw={760} verticalSpacing={6} data-stock-levels-outcomes>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={60}>Row</Table.Th>
                  <Table.Th miw={160}>Item</Table.Th>
                  <Table.Th miw={120}>Warehouse</Table.Th>
                  <Table.Th miw={110}>Outcome</Table.Th>
                  <Table.Th miw={260}>Message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.rows.slice(0, resultShown).map((outcome) => {
                  const row = rowByNumber.get(outcome.rowNumber)
                  return (
                    <Table.Tr key={outcome.rowNumber}>
                      <Table.Td>{outcome.rowNumber}</Table.Td>
                      <Table.Td>{row?.itemCode ?? row?.itemInput ?? '—'}</Table.Td>
                      <Table.Td>{row?.warehouseCode ?? row?.warehouseInput ?? '—'}</Table.Td>
                      <Table.Td>
                        <Badge color={OUTCOME_COLOURS[outcome.outcome] ?? 'gray'} variant="light">
                          {outcome.outcome}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c={outcome.outcome === 'Skipped' ? 'red' : 'dimmed'}>
                          {outcome.message ?? ''}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
                {result.rows.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text ta="center" c="dimmed" py="md">
                        The server reported no row.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          {result.rows.length > resultShown ? (
            <Group justify="center">
              <Button variant="subtle" size="xs" onClick={() => setResultShown((n) => n + PAGE)}>
                Show more ({formatNumber(result.rows.length - resultShown)} more rows)
              </Button>
            </Group>
          ) : null}

          <Group justify="flex-end">
            <Button onClick={onClose}>Close</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

/** A Min / Max cell: the number, or what the file had in red when it did not read, or a dash. */
function cellNumber(value: number | null, raw: string | null) {
  if (value !== null) return formatNumber(value)
  return (
    <Text fz="sm" c={raw ? 'red' : 'dimmed'} span>
      {raw ?? '—'}
    </Text>
  )
}

/** "Continue with {n} changes", disabled with its reason when nothing would change. */
function ContinueButton({ count, onClick }: { count: number; onClick(): void }) {
  if (count > 0)
    return (
      <Button onClick={onClick} data-stock-levels-continue>
        Continue with {formatNumber(count)} change{count === 1 ? '' : 's'}
      </Button>
    )
  return (
    <Stack gap={2} align="flex-end">
      <Button disabled data-stock-levels-continue>
        Continue with 0 changes
      </Button>
      <Text fz="xs" c="dimmed" ta="right">
        Nothing to import: every row is unchanged or has an error.
      </Text>
    </Stack>
  )
}

function SummaryCard({ label, value, colour }: { label: string; value: number; colour?: string }) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fz={26} fw={700} c={colour}>
        {formatNumber(value)}
      </Text>
    </Card>
  )
}

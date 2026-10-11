import { useMemo, useRef, useState } from 'react'
import {
  Alert,
  Anchor,
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
  Switch,
  Table,
  Text,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconDownload, IconFileSpreadsheet } from '@tabler/icons-react'
import { Link } from 'react-router'
import { ApiError } from '../../api/http'
import {
  containerChargeImportApi,
  type ChargeImportResult,
  type ChargeImportRow,
  type ChargeImportRowStatus,
  type ChargeImportValidation,
} from '../../api/logistics/containerChargeImport'
import { allocationMethodLabel } from '../../api/purchase/chargeTypes'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import { dateLabel } from '../documents/documentKind'
import { formatMoney, formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'

const CONTAINERS_ROUTE = '/logistics/containers'

/** The API's limit (ContainerChargeImportParser.MaxFileBytes), so the hint and the server say the same. */
const MAX_FILE_BYTES = 5 * 1024 * 1024

const STATUS_COLOURS: Record<ChargeImportRowStatus, string> = {
  Valid: 'green',
  Warning: 'orange',
  Error: 'red',
}

/** What became of one row, once imported: the four ways a row can end. */
type Ending = 'Posted' | 'Draft' | 'DraftKept' | 'Refused'

const ENDINGS: Record<Ending, { label: string; colour: string }> = {
  Posted: { label: 'Posted', colour: 'green' },
  Draft: { label: 'Draft', colour: 'gray' },
  DraftKept: { label: 'Draft, not posted', colour: 'orange' },
  Refused: { label: 'Refused', colour: 'red' },
}

interface ResultLine {
  rowNumber: number
  containerId: number | null
  containerRef: string | null
  containerNo: string | null
  chargeLabel: string | null
  amount: number | null
  currencyCode: string | null
  ending: Ending
  message: string | null
}

export interface ImportContainerChargesWizardProps {
  opened: boolean
  onClose: () => void
  /** After an import that created at least one charge: the host reloads its list (the Charges column). */
  onImported: () => void
}

/** "1 charge", "3 charges". */
function count(n: number, word: string): string {
  return `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`
}

/**
 * Every row of the result, one line each, in the file's order. What the result leaves out is taken from the
 * row as validated, so a refusal always names its container and charge. A Draft with a message is a row
 * whose posting was asked and refused: the draft is there, the message says why it was not posted.
 */
function resultLines(result: ChargeImportResult, sent: ChargeImportRow[]): ResultLine[] {
  return result.rows
    .map((o): ResultLine => {
      const row = sent.find((r) => r.rowNumber === o.rowNumber)
      const code = o.chargeCode ?? row?.chargeCode ?? null
      const name = o.chargeName ?? row?.chargeName ?? null
      return {
        rowNumber: o.rowNumber,
        containerId: o.containerId ?? row?.containerId ?? null,
        containerRef: o.containerRef ?? row?.containerRef ?? row?.containerInput ?? null,
        containerNo: o.containerNo ?? row?.containerNo ?? null,
        chargeLabel: code ? `${code}${name ? ` - ${name}` : ''}` : (row?.chargeTypeInput ?? null),
        amount: o.amount ?? row?.amount ?? null,
        currencyCode: o.currencyCode ?? row?.currencyCode ?? null,
        ending:
          o.outcome === 'Posted' ? 'Posted' : o.outcome === 'Failed' ? 'Refused' : result.post && o.message ? 'DraftKept' : 'Draft',
        message: o.message,
      }
    })
    .sort((a, b) => a.rowNumber - b.rowNumber)
}

/** "1 row refused, 2 not posted": what went wrong in a result, or null when nothing did. */
function troubleText(lines: ResultLine[]): string | null {
  const refused = lines.filter((l) => l.ending === 'Refused').length
  const kept = lines.filter((l) => l.ending === 'DraftKept').length
  const parts = [
    refused > 0 ? `${count(refused, 'row')} refused` : null,
    kept > 0 ? `${formatNumber(kept)} not posted` : null,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? null : parts.join(', ')
}

/**
 * "Import charges from Excel…" on the Containers page: container charges from a file, in three steps —
 * choose the file, look at what the server made of every row, then create the charges.
 *
 * ONE ROW = ONE CHARGE ON ONE CONTAINER. The whole amount of a row goes on its container and is divided
 * over the container's items by the row's allocation method (the charge type's when the file leaves it
 * blank). There is no split over several containers here: that is what "Add charge" is for.
 *
 * NOTHING IS IMPORTED SILENTLY, the rule of every import in the application. Step 2 shows every row with
 * its verdict, including the ones that will be skipped, and the import button says how many are left
 * behind. Each row is created on its own: one refused row — at creation or at posting — is listed with
 * its reason and never stops the others, so the result is a list rather than one message.
 */
/** THE RATE AS IT IS, NOT PADDED: stored with 6 decimals, but "0.92" reads better than "0.920000". */
function rateDecimals(rate: number): number {
  return Math.min(6, (String(rate).split('.')[1] ?? '').length)
}

export function ImportContainerChargesWizard(props: ImportContainerChargesWizardProps) {
  /*
   * KEYED ON opened, SO OPENING THE DIALOG IS A FRESH COMPONENT: the chosen file, the validation and
   * the result are per run, and a wizard that remembered the previous file would import its rows again.
   */
  return <WizardBody key={props.opened ? 'open' : 'closed'} {...props} />
}

function WizardBody({ opened, onClose, onImported }: ImportContainerChargesWizardProps) {
  const fullScreen = useMediaQuery('(max-width: 768px)')
  const { hasPermission } = useAuth()
  const canPost = hasPermission(PERMISSIONS.containerChargesPost)

  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState<ChargeImportValidation | null>(null)
  const [filter, setFilter] = useState<'all' | ChargeImportRowStatus>('all')

  const [post, setPost] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ChargeImportResult | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  /** The base currency's code, for the "≈ … USD" under an amount typed in another currency. */
  const baseCode = validation?.baseCurrencyCode ?? null

  /** Valid and Warning rows are imported; a Warning is a possible duplicate, imported as its own charge. */
  const importable = useMemo(
    () => validation?.rows.filter((r) => r.status === 'Valid' || r.status === 'Warning') ?? [],
    [validation],
  )
  const skipped = validation?.errorRows ?? 0

  const visibleRows = useMemo(
    () => (filter === 'all' ? (validation?.rows ?? []) : (validation?.rows ?? []).filter((r) => r.status === filter)),
    [validation, filter],
  )

  /** What step 3 is about to create: the containers it touches and the totals per currency. */
  const plan = useMemo(() => {
    const containers = new Set(importable.map((r) => r.containerId ?? r.containerRef))
    const totals = new Map<string, number>()
    let base = 0
    for (const row of importable) {
      const code = row.currencyCode ?? baseCode ?? ''
      totals.set(code, (totals.get(code) ?? 0) + (row.amount ?? 0))
      base += row.amountBase ?? 0
    }
    // The charge groups of several rows: the rows of one provider invoice, created as one group.
    const groupSizes = new Map<number, number>()
    for (const row of importable) {
      if (row.groupRowNumber !== null) groupSizes.set(row.groupRowNumber, (groupSizes.get(row.groupRowNumber) ?? 0) + 1)
    }
    const groups = [...groupSizes.values()].filter((size) => size > 1)
    return {
      containers: containers.size,
      totals: [...totals.entries()],
      base,
      groups: groups.length,
      groupedRows: groups.reduce((acc, size) => acc + size, 0),
    }
  }, [importable, baseCode])

  const lines = useMemo(() => (result ? resultLines(result, importable) : []), [result, importable])
  const tally = useMemo(() => {
    const by = (ending: Ending) => lines.filter((l) => l.ending === ending).length
    return { posted: by('Posted'), drafts: by('Draft'), kept: by('DraftKept'), refused: by('Refused') }
  }, [lines])
  const createdCount = tally.posted + tally.drafts + tally.kept
  const failedCount = tally.kept + tally.refused

  /* ── step 1 ─────────────────────────────────────────────────────────────────────────────────── */

  /**
   * Checked here as well as on the server, for WHEN rather than whether: a 12 MB file refused before it
   * is uploaded saves a wait. The server checks again, because a client is not a guard.
   */
  function chooseFile(next: File | null) {
    if (!next) {
      setFile(null)
      setFileError(null)
      return
    }
    if (!next.name.toLowerCase().endsWith('.xlsx')) {
      setFile(null)
      setFileError('Only .xlsx files can be imported. Save the file as an Excel workbook and try again.')
      return
    }
    if (next.size > MAX_FILE_BYTES) {
      setFile(null)
      setFileError(`The file is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.`)
      return
    }
    setFile(next)
    setFileError(null)
  }

  async function downloadTemplate() {
    try {
      await containerChargeImportApi.downloadTemplate()
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The template could not be downloaded.')
    }
  }

  async function validate() {
    if (!file) return
    setValidating(true)
    try {
      const answer = await containerChargeImportApi.validate(file)
      setValidation(answer)
      setFilter('all')
      setStep(1)
    } catch (error) {
      // The API's own sentence ("The file does not match the import template…") is written for the
      // person holding the file.
      notify.error(error instanceof ApiError ? error.message : 'The file could not be validated.')
    } finally {
      setValidating(false)
    }
  }

  /* ── step 2 ─────────────────────────────────────────────────────────────────────────────────── */

  async function downloadErrorReport(rows: ChargeImportRow[]) {
    try {
      await containerChargeImportApi.downloadErrorReport(rows)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The error report could not be downloaded.')
    }
  }

  /** Back to step 1 for another file: the validation is of the old one, so it goes. */
  function chooseAnotherFile() {
    setValidation(null)
    setFile(null)
    setFileError(null)
    setStep(0)
  }

  /* ── step 3 ─────────────────────────────────────────────────────────────────────────────────── */

  async function runImport() {
    if (importable.length === 0) return
    setImporting(true)
    try {
      const answer = await containerChargeImportApi.importRows({
        post: canPost && post,
        fileName: validation?.fileName ?? null,
        rows: importable,
      })
      setResult(answer)
      const ended = resultLines(answer, importable)
      const made = ended.filter((l) => l.ending !== 'Refused').length
      const trouble = troubleText(ended)
      if (made > 0) onImported()
      if (trouble === null) notify.success(`${count(made, 'charge')} imported${answer.post ? ' and posted' : ' as drafts'}.`)
      else if (made > 0) notify.warning(`${count(made, 'charge')} imported; ${trouble} — see the reasons below.`)
      else notify.error('No charge could be imported — see the reasons below.')
    } catch (error) {
      // A refusal of the whole call (no right to post, a file the server no longer accepts): nothing was
      // created, and the reader stays on step 3 to change the switch or go back.
      notify.error(error instanceof ApiError ? error.message : 'The charges could not be imported.')
    } finally {
      setImporting(false)
    }
  }

  /**
   * The refused rows as the file again, each with the reason it was refused, to correct and re-import.
   * ONLY THE ROWS THAT CREATED NOTHING: a "Draft, not posted" row has its charge already, and importing it
   * again would put a second one on the container (the duplicate check is only a warning). It is posted
   * from the container or Logistics › Container Charges instead.
   */
  function refusedRows(): ChargeImportRow[] {
    return lines
      .filter((l) => l.ending === 'Refused')
      .flatMap((l): ChargeImportRow[] => {
        const row = importable.find((r) => r.rowNumber === l.rowNumber)
        return row ? [{ ...row, status: 'Error', message: l.message }] : []
      })
  }

  /* ── closing ────────────────────────────────────────────────────────────────────────────────── */

  /** Asks before throwing away a validation that was not imported, and only then. */
  async function requestClose() {
    if (importing) return
    if (validation !== null && result === null && importable.length > 0) {
      const go = await confirm({
        title: 'Discard this import?',
        message: `${count(importable.length, 'row')} ${importable.length === 1 ? 'has' : 'have'} been validated but not imported. Closing now discards them.`,
        confirmLabel: 'Discard',
        danger: true,
      })
      if (!go) return
    }
    onClose()
  }

  const importLabel =
    skipped > 0
      ? `Import ${formatNumber(importable.length)}, skip ${formatNumber(skipped)}`
      : `Import ${count(importable.length, 'charge')}`

  const base = baseCode ?? 'base currency'

  return (
    <Modal
      opened={opened}
      onClose={() => void requestClose()}
      title="Import Container Charges from Excel"
      size={1280}
      fullScreen={fullScreen}
      centered={!fullScreen}
      closeOnClickOutside={!importing}
      closeOnEscape={!importing}
      withCloseButton={!importing}
    >
      <Stepper active={result ? 3 : step} size="sm" mb="lg" allowNextStepsSelect={false}>
        <Stepper.Step label="Upload File" description={fullScreen ? undefined : 'Choose an .xlsx'} />
        <Stepper.Step label="Validate & Preview" description={fullScreen ? undefined : 'Check every row'} />
        <Stepper.Step label="Import" description={fullScreen ? undefined : 'Create the charges'} />
      </Stepper>

      {step === 0 && (
        <Stack>
          <Alert color="blue" title="Use the template">
            <Stack gap="xs" align="flex-start">
              <Text size="sm">
                One row is one charge on one container: the whole amount goes on that container and is divided over its
                items by the allocation method. The Container column takes the container no. (MSKU1234565) or the
                reference (KTG-2026-0031); the sheet Lists names the charge types and currencies you can use.
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

          {/* A PLAIN DROP TARGET, as in the invoice import: drag-and-drop plus a hidden file input. A click
              anywhere in it opens the picker for the mouse; the "Choose a file…" button inside is the way in
              from the keyboard. The box itself is not given role="button": it holds the remove button, and a
              button inside a role="button" is no longer announced as one. */}
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
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(event) => {
                const picked = event.currentTarget.files?.[0] ?? null
                // Emptied, so the same file chosen again after "Remove the file" still fires a change.
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
                    // The button sits inside the drop target, whose click opens the file picker.
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
                    // The drop target's own click would open the picker a second time.
                    event.stopPropagation()
                    inputRef.current?.click()
                  }}
                  data-charge-import-browse
                >
                  Choose a file…
                </Button>
                <Text size="sm" c="dimmed">
                  .xlsx only, up to {MAX_FILE_BYTES / (1024 * 1024)} MB.
                </Text>
              </Stack>
            )}
          </Box>

          {fileError && (
            <Alert color="red" title="That file cannot be imported">
              {fileError}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => void requestClose()}>
              Cancel
            </Button>
            <Button disabled={!file} loading={validating} onClick={() => void validate()}>
              Validate File
            </Button>
          </Group>
        </Stack>
      )}

      {step === 1 && validation && (
        <Stack>
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <SummaryCard label="Total Rows" value={validation.totalRows} />
            <SummaryCard label="Valid Rows" value={validation.validRows} colour="green" />
            <SummaryCard label="Warning Rows" value={validation.warningRows} colour="orange" />
            <SummaryCard label="Error Rows" value={validation.errorRows} colour="red" />
          </SimpleGrid>

          {validation.warningRows > 0 && (
            <Alert color="orange" title="Check the warnings">
              {count(validation.warningRows, 'row')} {validation.warningRows === 1 ? 'has' : 'have'} a warning, such as a
              charge that looks like one already on the container or like another row of the file. They are imported like
              the valid rows, each as its own charge: correct the file and validate it again if one should not be.
            </Alert>
          )}

          {importable.length === 0 && (
            <Alert color="red" title="Nothing can be imported">
              Every row has an error. Download the error report, correct the rows in the file and validate it again.
            </Alert>
          )}

          <Chip.Group multiple={false} value={filter} onChange={(v) => setFilter(v as typeof filter)}>
            <Group gap="xs">
              <Chip value="all">All ({formatNumber(validation.rows.length)})</Chip>
              <Chip value="Valid" color="green">
                Valid ({formatNumber(validation.validRows)})
              </Chip>
              <Chip value="Warning" color="orange">
                Warnings ({formatNumber(validation.warningRows)})
              </Chip>
              <Chip value="Error" color="red">
                Errors ({formatNumber(validation.errorRows)})
              </Chip>
            </Group>
          </Chip.Group>

          <ScrollArea.Autosize mah={fullScreen ? undefined : 340} type="auto">
            <Table striped highlightOnHover stickyHeader miw={1180} verticalSpacing={6} data-charge-import-preview>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={50}>#</Table.Th>
                  <Table.Th miw={130}>Container</Table.Th>
                  <Table.Th miw={150}>Charge Type</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th miw={150}>Provider</Table.Th>
                  <Table.Th>Allocation</Table.Th>
                  <Table.Th miw={110}>Status</Table.Th>
                  <Table.Th miw={210}>Message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleRows.map((row) => {
                  const code = row.currencyCode ?? row.currencyInput ?? baseCode ?? ''
                  const foreign = row.currencyCode !== null && !row.isBaseCurrency
                  const grouped = row.groupRowNumber !== null && row.groupRowNumber !== row.rowNumber
                  return (
                    <Table.Tr key={row.rowNumber}>
                      <Table.Td>{row.rowNumber}</Table.Td>
                      <Table.Td>
                        {row.containerRef ? (
                          <>
                            <Text fz="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
                              {row.containerRef}
                            </Text>
                            {(row.containerNo || row.containerStatusName) && (
                              <Text fz="xs" c="dimmed">
                                {[row.containerNo, row.containerStatusName].filter(Boolean).join(' · ')}
                              </Text>
                            )}
                          </>
                        ) : (
                          <Text fz="sm" c={row.containerInput ? 'red' : 'dimmed'}>
                            {row.containerInput ?? '—'}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {row.chargeCode ? (
                          <Text fz="sm">
                            {row.chargeCode}
                            {row.chargeName ? ` - ${row.chargeName}` : ''}
                          </Text>
                        ) : (
                          <Text fz="sm" c={row.chargeTypeInput ? 'red' : 'dimmed'}>
                            {row.chargeTypeInput ?? '—'}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        {row.chargeDate ? (
                          dateLabel(row.chargeDate)
                        ) : (
                          <Text fz="sm" c={row.rawChargeDate ? 'red' : 'dimmed'}>
                            {row.rawChargeDate ?? '—'}
                          </Text>
                        )}
                        {row.chargeDateDefaulted && (
                          <Text fz="xs" c="dimmed">
                            today
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">
                        {row.amount == null ? (
                          <Text fz="sm" c={row.rawAmount ? 'red' : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
                            {row.rawAmount ?? '—'}
                          </Text>
                        ) : (
                          <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
                            {formatMoney(row.amount, code)}
                          </Text>
                        )}
                        {foreign && row.amountBase != null && (
                          <Text fz="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                            ≈ {formatMoney(row.amountBase, baseCode ?? '')}
                          </Text>
                        )}
                        {foreign && row.exchangeRate != null && (
                          <Text fz="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                            rate {formatNumber(row.exchangeRate, rateDecimals(row.exchangeRate))}
                            {row.exchangeRateLookedUp ? ' of the date' : ''}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {row.providerName || row.providerInput ? (
                          <Text fz="sm" c={row.providerName ? undefined : 'red'}>
                            {row.providerName ?? row.providerInput}
                          </Text>
                        ) : (
                          <Text fz="sm" c="dimmed">
                            —
                          </Text>
                        )}
                        {row.reference && (
                          <Text fz="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                            Inv. {row.reference}
                          </Text>
                        )}
                        {grouped && (
                          <Text fz="xs" c="blue" style={{ whiteSpace: 'nowrap' }}>
                            One group with row {row.groupRowNumber}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        {row.allocationMethod ? (
                          allocationMethodLabel(row.allocationMethod)
                        ) : (
                          <Text fz="sm" c={row.allocationInput ? 'red' : 'dimmed'}>
                            {row.allocationInput ?? '—'}
                          </Text>
                        )}
                        {row.allocationMethod && row.allocationDefaulted && (
                          <Text fz="xs" c="dimmed">
                            the type&apos;s default
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge color={STATUS_COLOURS[row.status]} variant="light">
                          {row.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c={row.status === 'Error' ? 'red' : 'dimmed'}>
                          {row.message ?? ''}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
                {visibleRows.length === 0 && (
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

          <Group justify="space-between" gap="sm">
            <Button variant="subtle" onClick={chooseAnotherFile}>
              Choose another file
            </Button>
            <Group gap="sm" justify="flex-end">
              <Button variant="default" onClick={() => void requestClose()}>
                Cancel
              </Button>
              {(validation.errorRows > 0 || validation.warningRows > 0) && (
                <Button
                  variant="light"
                  leftSection={<IconDownload size={16} />}
                  onClick={() => void downloadErrorReport(validation.rows)}
                >
                  Download the error report
                </Button>
              )}
              <Button disabled={importable.length === 0} onClick={() => setStep(2)}>
                Continue with {count(importable.length, 'charge')}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}

      {step === 2 && validation && result === null && (
        <Stack>
          <Alert color="blue" title={`${count(importable.length, 'charge')} to create`}>
            <Stack gap={6}>
              <Text size="sm">
                One charge per row, on {count(plan.containers, 'container')}: each charge carries the row&apos;s whole
                amount, divided over the container&apos;s items by its allocation method.
                {skipped > 0 ? ` ${count(skipped, 'row')} with an error ${skipped === 1 ? 'is' : 'are'} skipped.` : ''}
              </Text>
              {plan.groups > 0 && (
                <Text size="sm">
                  {formatNumber(plan.groupedRows)} rows of the same provider invoice become{' '}
                  {plan.groups === 1 ? 'one charge group' : `${formatNumber(plan.groups)} charge groups`}, so the invoice
                  is attached once per group.
                </Text>
              )}
              <Text size="sm">
                Amounts:{' '}
                <Text span fw={600} size="sm">
                  {plan.totals.map(([code, total]) => formatMoney(total, code || base)).join(' · ')}
                </Text>
                {plan.totals.length > 1 || (plan.totals[0] && plan.totals[0][0] !== baseCode) ? (
                  <Text span c="dimmed" size="sm">
                    {' '}
                    (≈ {formatMoney(plan.base, base)})
                  </Text>
                ) : null}
              </Text>
            </Stack>
          </Alert>

          {/* POSTING IS ITS OWN RIGHT: without containers.charges.post the switch is not offered (the server
              checks it as well) and the charges wait as drafts for someone who may post them. */}
          {canPost ? (
            <Switch
              label="Post the charges"
              description="Off: the charges are created as drafts, to check and post later. On: each charge is posted right after it is created; a refused posting leaves that charge as a draft and the others go on."
              checked={post}
              onChange={(event) => setPost(event.currentTarget.checked)}
              disabled={importing}
              data-charge-import-post
            />
          ) : (
            <Text size="sm" c="dimmed">
              The charges are created as drafts. Someone allowed to post charges posts them from Logistics › Container
              Charges.
            </Text>
          )}

          {importing && (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm">
                Importing {count(importable.length, 'charge')}… each row is created on its own, this can take a moment.
              </Text>
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
                {importLabel}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}

      {result && (
        <Stack>
          <Alert
            color={failedCount === 0 ? 'green' : createdCount === 0 ? 'red' : 'orange'}
            title={
              createdCount === 0
                ? 'No charge was imported'
                : `${count(createdCount, 'charge')} imported${failedCount > 0 ? `; ${troubleText(lines)}` : ''}`
            }
          >
            <Stack gap={4}>
              <Text size="sm">
                {[
                  tally.posted > 0 ? `${formatNumber(tally.posted)} posted` : null,
                  tally.drafts > 0 ? `${formatNumber(tally.drafts)} as ${tally.drafts === 1 ? 'a draft' : 'drafts'}` : null,
                  tally.kept > 0 ? `${formatNumber(tally.kept)} created but not posted` : null,
                  tally.refused > 0 ? `${formatNumber(tally.refused)} refused` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                .
              </Text>
              {tally.drafts + tally.kept > 0 && (
                <Text size="sm">
                  Drafts do not change the item costs until they are posted, from the container or Logistics › Container
                  Charges.
                </Text>
              )}
              {failedCount > 0 && (
                <Text size="sm">Each refusal is listed below with its reason; the other rows went ahead.</Text>
              )}
              {tally.kept > 0 && (
                <Text size="sm" fw={500}>
                  {tally.kept === 1
                    ? 'The charge marked "Draft, not posted" was created as a draft'
                    : `The ${formatNumber(tally.kept)} charges marked "Draft, not posted" were created as drafts`}
                  : post {tally.kept === 1 ? 'it' : 'them'} from the container or Logistics › Container Charges once the
                  reason is fixed; do not import {tally.kept === 1 ? 'it' : 'them'} again.
                </Text>
              )}
            </Stack>
          </Alert>

          <ScrollArea.Autosize mah={fullScreen ? undefined : 380} type="auto">
            <Table withTableBorder withColumnBorders miw={760} verticalSpacing={6} data-charge-import-result>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={50}>#</Table.Th>
                  <Table.Th miw={140}>Container</Table.Th>
                  <Table.Th miw={170}>Charge Type</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th miw={150}>Status</Table.Th>
                  <Table.Th miw={240}>Reason</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lines.map((line) => (
                  <Table.Tr key={line.rowNumber}>
                    <Table.Td>{line.rowNumber}</Table.Td>
                    <Table.Td>
                      {line.containerId !== null ? (
                        <Anchor
                          component={Link}
                          to={`${CONTAINERS_ROUTE}/${line.containerId}`}
                          fz="sm"
                          fw={600}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {line.containerRef ?? `#${line.containerId}`}
                        </Anchor>
                      ) : (
                        <Text fz="sm">{line.containerRef ?? '—'}</Text>
                      )}
                      {line.containerNo && (
                        <Text fz="xs" c="dimmed">
                          {line.containerNo}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{line.chargeLabel ?? '—'}</Table.Td>
                    <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                      {line.amount == null ? '—' : formatMoney(line.amount, line.currencyCode ?? baseCode ?? '')}
                    </Table.Td>
                    <Table.Td>
                      <Badge color={ENDINGS[line.ending].colour} variant="light">
                        {ENDINGS[line.ending].label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c={line.ending === 'Refused' || line.ending === 'DraftKept' ? 'red' : 'dimmed'}>
                        {line.message ?? ''}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {lines.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={6}>
                      <Text ta="center" c="dimmed" py="md">
                        The server reported no row.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>

          <Group justify="flex-end" gap="sm">
            {tally.refused > 0 && (
              <Button
                variant="light"
                leftSection={<IconDownload size={16} />}
                onClick={() => void downloadErrorReport(refusedRows())}
              >
                Download the refused rows
              </Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </Group>
        </Stack>
      )}
    </Modal>
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

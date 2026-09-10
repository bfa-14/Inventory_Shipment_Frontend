import { useCallback, useMemo, useRef, useState } from 'react'
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
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Stepper,
  Table,
  Text,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { ApiError } from '../../api/http'
import {
  invoiceImportApi,
  type ImportRowStatus,
  type ImportValidatedRow,
  type ImportValidationResult,
} from '../../api/sales/invoiceImport'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'

/** A line the wizard hands back, ready to be appended to the host screen's grid. */
export interface ImportedLine {
  itemId: number
  itemCode: string
  itemName: string
  itemUnitId: number
  unitTypeName: string
  packingFormula: number
  warehouseId: number
  warehouseCode: string
  quantity: number
  /** The selling price in invoice mode, the unit cost in stock mode. Null when the file gave none. */
  unitPrice: number | null
  discountPercent: number
  expiryDate: string | null
  notes: string | null
  /** The Excel row it came from, so a later error can point back at the file. */
  importRowNumber: number
}

export interface ImportWizardHeader {
  branchId: number
  warehouseId: number
  /** Null in stock mode: an Inventory In / Out document has no price list. */
  priceListId: number | null
  currencyCode: string
  decimalPlaces: number
}

export interface ImportInvoiceItemsWizardProps {
  opened: boolean
  onClose: () => void
  header: ImportWizardHeader
  /**
   * invoice: rows are priced against the header's price list and discounts apply.
   * stock: nothing is priced — the price column is the UNIT COST and discounts do not exist.
   */
  mode?: 'invoice' | 'stock'
  /** The host's draft id, recorded on the audit row so it can be attached to the document later. */
  draftReference?: string | null
  onImported: (lines: ImportedLine[]) => void
}

const MAX_FILE_BYTES = 10 * 1024 * 1024

const STATUS_COLOURS: Record<ImportRowStatus, string> = {
  Valid: 'green',
  Warning: 'orange',
  Error: 'red',
  Merged: 'gray',
}

/**
 * Importing invoice or stock lines from an Excel file, in three steps: choose the file, look at what
 * the server made of it, then take the rows that are usable.
 *
 * NOTHING IS EVER IMPORTED SILENTLY, which is the rule the whole design serves. The file is
 * validated on the server and every row comes back with a verdict; step 2 shows all of them,
 * including the ones that will be skipped, and the import button says in words how many are being
 * left behind. A wizard that quietly dropped four rows out of forty would be worse than one that
 * refused the file outright, because nobody would find out until the stock count disagreed.
 *
 * THE HOST OWNS THE LINES. This component returns them through onImported and writes only the audit
 * row; whichever screen opened it adds them to its own draft and saves them with everything else.
 * That is what lets one wizard serve the Sales Invoice, Inventory In and Inventory Out screens.
 *
 * TWO MODES, ONE FILE FORMAT. In stock mode there is no price list, so the API prices nothing and
 * the Unit Price column is read as the unit cost; the discount column is hidden here because an
 * inventory document has no discounts to give.
 */
export function ImportInvoiceItemsWizard(props: ImportInvoiceItemsWizardProps) {
  /*
   * KEYED ON opened, SO OPENING THE DIALOG IS A FRESH COMPONENT.
   *
   * Everything inside is per-run state: the chosen file, the validation, how far the import got. It
   * all has to be forgotten between runs, and a wizard that remembered the previous file is the
   * classic version of this bug — here it would mean importing yesterday's rows. React's own answer
   * to "reset all state when a prop changes" is a key rather than an effect that calls a dozen
   * setters, and a key cannot get out of step the way a hand-written reset can.
   */
  return <ImportWizardBody key={props.opened ? 'open' : 'closed'} {...props} />
}

function ImportWizardBody({
  opened,
  onClose,
  header,
  mode = 'invoice',
  draftReference,
  onImported,
}: ImportInvoiceItemsWizardProps) {
  const fullScreen = useMediaQuery('(max-width: 768px)')
  const isStock = mode === 'stock'

  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [result, setResult] = useState<ImportValidationResult | null>(null)
  const [filter, setFilter] = useState<'all' | ImportRowStatus>('all')

  /** How far the step-3 animation has walked the importable rows. Cosmetic, and deliberately so. */
  const [progress, setProgress] = useState(0)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  /** Valid and Warning rows are what gets imported; Merged is already inside one of them. */
  const importable = useMemo(
    () => result?.rows.filter((r) => r.status === 'Valid' || r.status === 'Warning') ?? [],
    [result],
  )

  const visibleRows = useMemo(
    () => (filter === 'all' ? (result?.rows ?? []) : (result?.rows ?? []).filter((r) => r.status === filter)),
    [result, filter],
  )

  const money = useCallback(
    (value: number | null) =>
      value == null ? '—' : `${value.toFixed(header.decimalPlaces)} ${header.currencyCode}`,
    [header.currencyCode, header.decimalPlaces],
  )

  /* ── step 1 ─────────────────────────────────────────────────────────────────────────────────── */

  /**
   * Checked here as well as on the server, and the point is WHEN rather than whether: a 12 MB file
   * refused before it is uploaded saves the person a wait to be told something the browser already
   * knew. The server checks again regardless, because a client is not a guard.
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
      await invoiceImportApi.downloadTemplate()
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The template could not be downloaded.')
    }
  }

  async function validate() {
    if (!file) return

    setValidating(true)
    try {
      const answer = await invoiceImportApi.validate(file, {
        branchId: header.branchId,
        warehouseId: header.warehouseId,
        // Stock mode sends no price list at all — see the class remark.
        priceListId: isStock ? null : header.priceListId,
      })
      setResult(answer)
      setFilter('all')
      setStep(1)
    } catch (error) {
      // The API's own sentence: "The file does not match the import template..." is written for the
      // person holding the file, and no house apology would be worth more.
      notify.error(error instanceof ApiError ? error.message : 'The file could not be validated.')
    } finally {
      setValidating(false)
    }
  }

  /* ── step 2 ─────────────────────────────────────────────────────────────────────────────────── */

  async function downloadErrorReport() {
    if (!result) return
    try {
      await invoiceImportApi.downloadErrorReport(result.rows)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The error report could not be downloaded.')
    }
  }

  /**
   * Walks the importable rows on screen and then hands them over.
   *
   * THE PROGRESS IS HONEST ABOUT BEING COSMETIC: the rows are already validated and already in the
   * browser, so there is nothing to wait for. It exists because handing sixty lines to a grid in one
   * frame looks like nothing happened, and a person who pressed Import needs to see that it did.
   */
  async function runImport() {
    if (!result || importable.length === 0) return

    setStep(2)
    setImporting(true)
    setProgress(0)

    const step = Math.max(1, Math.round(importable.length / 20))
    for (let done = 0; done < importable.length; done += step) {
      setProgress(Math.min(done + step, importable.length))
      await new Promise((resolve) => setTimeout(resolve, 30))
    }

    try {
      await invoiceImportApi.log({
        branchId: header.branchId,
        warehouseId: header.warehouseId,
        priceListId: isStock ? null : header.priceListId,
        fileName: result.fileName,
        totalRows: result.totalRows,
        importedRows: importable.length,
        warningRows: result.warningRows,
        rejectedRows: result.errorRows,
        draftReference: draftReference ?? null,
      })
    } catch {
      // THE LINES STILL GO IN. The audit row is a record of the import, not a condition of it, and
      // losing the record is a smaller harm than making somebody redo the whole file because a log
      // write failed.
    }

    onImported(importable.map(toLine))
    setImporting(false)
    setImported(true)
  }

  /* ── closing ────────────────────────────────────────────────────────────────────────────────── */

  /**
   * Asks before throwing away a validation, and ONLY then: on step 1 there is nothing to lose, and
   * after a successful import the work is already in the host's grid.
   */
  async function requestClose() {
    const hasUnimportedWork = result !== null && !imported && importable.length > 0
    if (hasUnimportedWork) {
      const go = await confirm({
        title: 'Discard this import?',
        message: `${importable.length} row(s) have been validated but not imported. Closing now discards them.`,
        confirmLabel: 'Discard',
        danger: true,
      })
      if (!go) return
    }

    onClose()
  }

  const skipped = (result?.errorRows ?? 0)
  const importLabel = importable.length === 0
    ? 'Import Valid Rows'
    : skipped > 0
      ? `Import ${importable.length} Row(s), Skip ${skipped}`
      : `Import Valid Rows (${importable.length})`

  return (
    <Modal
      opened={opened}
      onClose={() => void requestClose()}
      title={isStock ? 'Import Stock Lines from Excel' : 'Import Invoice Items from Excel'}
      size="xl"
      fullScreen={fullScreen}
      centered={!fullScreen}
    >
      <Stepper active={step} size="sm" mb="lg" allowNextStepsSelect={false}>
        <Stepper.Step label="Upload File" description="Choose an .xlsx" />
        <Stepper.Step label="Validate & Preview" description="Check what will be imported" />
        <Stepper.Step label="Import" description="Add the rows" />
      </Stepper>

      {step === 0 && (
        <Stack>
          <Alert color="blue" title="Use the standard template">
            <Group justify="space-between" align="center" wrap="wrap" gap="sm">
              <Text size="sm">Use the standard template to ensure your file is imported correctly.</Text>
              <Button variant="light" size="xs" onClick={() => void downloadTemplate()}>
                Download Template
              </Button>
            </Group>
          </Alert>

          {/* A PLAIN DROP TARGET rather than a dependency. @mantine/dropzone is not installed in this
              project, and drag-and-drop plus a hidden file input is the whole of what is needed. */}
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
              onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)}
            />

            {file ? (
              <Group justify="center" gap="xs">
                <Text fw={500}>{file.name}</Text>
                <Text c="dimmed" size="sm">
                  ({(file.size / 1024).toFixed(0)} KB)
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
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
              <Stack gap={4}>
                <Text fw={500}>Drag and drop your file here</Text>
                <Text size="sm" c="dimmed">
                  or click to browse. .xlsx only, up to 10 MB.
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

      {step === 1 && result && (
        <Stack>
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <SummaryCard label="Total Rows" value={result.totalRows} />
            <SummaryCard label="Valid Rows" value={result.validRows} colour="green" />
            <SummaryCard label="Warning Rows" value={result.warningRows} colour="orange" />
            <SummaryCard label="Error Rows" value={result.errorRows} colour="red" />
          </SimpleGrid>

          <Chip.Group multiple={false} value={filter} onChange={(v) => setFilter(v as typeof filter)}>
            <Group gap="xs">
              <Chip value="all">All ({result.rows.length})</Chip>
              <Chip value="Valid" color="green">Valid ({result.validRows})</Chip>
              <Chip value="Warning" color="orange">Warnings ({result.warningRows})</Chip>
              <Chip value="Error" color="red">Errors ({result.errorRows})</Chip>
            </Group>
          </Chip.Group>

          <ScrollArea.Autosize mah={360} type="auto">
            <Table striped highlightOnHover stickyHeader miw={900}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={50}>#</Table.Th>
                  <Table.Th>Item Code</Table.Th>
                  <Table.Th>Item Name</Table.Th>
                  <Table.Th>Unit</Table.Th>
                  <Table.Th>Warehouse</Table.Th>
                  <Table.Th ta="right">Qty</Table.Th>
                  <Table.Th ta="right">{isStock ? 'Unit Cost' : 'Price'}</Table.Th>
                  {/* An inventory document has no discounts, so the column is not there to explain. */}
                  {!isStock && <Table.Th ta="right">Discount %</Table.Th>}
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleRows.map((row) => (
                  <Table.Tr key={row.rowNumber}>
                    <Table.Td>{row.rowNumber}</Table.Td>
                    <Table.Td>{row.itemCode ?? row.itemRef ?? '—'}</Table.Td>
                    <Table.Td>{row.itemName ?? '—'}</Table.Td>
                    <Table.Td>{row.unitTypeName ?? '—'}</Table.Td>
                    <Table.Td>{row.warehouseCode ?? '—'}</Table.Td>
                    <Table.Td ta="right">{row.quantity ?? '—'}</Table.Td>
                    <Table.Td ta="right">{money(row.unitPrice)}</Table.Td>
                    {!isStock && <Table.Td ta="right">{row.discountPercent}</Table.Td>}
                    <Table.Td>
                      <Badge color={STATUS_COLOURS[row.status]} variant="light">
                        {row.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {row.message ?? ''}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {visibleRows.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={isStock ? 9 : 10}>
                      <Text ta="center" c="dimmed" py="md">
                        No rows with that status.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => void requestClose()}>
              Cancel
            </Button>
            {(result.errorRows > 0 || result.warningRows > 0) && (
              <Button variant="light" onClick={() => void downloadErrorReport()}>
                Download Error File
              </Button>
            )}
            <Button disabled={importable.length === 0} onClick={() => void runImport()}>
              {importLabel}
            </Button>
          </Group>
        </Stack>
      )}

      {step === 2 && result && (
        <Stack>
          {importing && (
            <Stack align="center" py="xl" gap="sm">
              <Loader />
              <Text>
                Importing valid rows… {progress} / {importable.length}
              </Text>
              <Progress
                value={importable.length === 0 ? 0 : (progress / importable.length) * 100}
                w="100%"
              />
            </Stack>
          )}

          {imported && importable.length > 0 && (
            <Alert color="green" title="Import complete">
              {importable.length} item(s) imported successfully. {result.warningRows} row(s) with warning
              and {result.errorRows} row(s) with error were not imported.
            </Alert>
          )}

          {/* NOTHING WAS USABLE. A different panel rather than a success message with a zero in it:
              the next action is not "close", it is "go and fix the file". */}
          {imported && importable.length === 0 && (
            <Alert color="red" title="Nothing could be imported">
              <Stack gap="sm" align="flex-start">
                <Text size="sm">
                  {result.errorRows} row(s) contain errors and were not imported. Please correct the
                  errors in your Excel file and try again.
                </Text>
                <Button variant="light" size="xs" onClick={() => void downloadErrorReport()}>
                  Download Error File
                </Button>
              </Stack>
            </Alert>
          )}

          {imported && (
            <Group justify="flex-end">
              <Button onClick={onClose}>Close</Button>
            </Group>
          )}
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
        {value}
      </Text>
    </Card>
  )
}

/**
 * A validated row as the host's grid wants it.
 *
 * The non-null assertions are safe by construction: only Valid and Warning rows reach here, and the
 * server cannot judge a row usable without having resolved its item, unit and warehouse.
 */
function toLine(row: ImportValidatedRow): ImportedLine {
  return {
    itemId: row.itemId!,
    itemCode: row.itemCode ?? '',
    itemName: row.itemName ?? '',
    itemUnitId: row.itemUnitId!,
    unitTypeName: row.unitTypeName ?? '',
    packingFormula: row.packingFormula ?? 1,
    warehouseId: row.warehouseId!,
    warehouseCode: row.warehouseCode ?? '',
    quantity: row.quantity ?? 0,
    unitPrice: row.unitPrice,
    discountPercent: row.discountPercent,
    expiryDate: row.expiryDate,
    notes: row.notes,
    importRowNumber: row.rowNumber,
  }
}

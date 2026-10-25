import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Stepper,
  Switch,
  Table,
  Text,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { Link } from 'react-router'
import type { ImportCreateResult } from '../../api/documents'
import { ApiError } from '../../api/http'
import {
  invoiceImportApi,
  type ImportPriceSource,
  type ImportRowStatus,
  type ImportValidatedRow,
  type ImportValidationResult,
} from '../../api/sales/invoiceImport'
import { formatMoney, formatNumber } from '../format'
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
  /** Where that price came from. A host sends only a Manual price back; a list price is the server's to re-find. */
  priceSource: ImportPriceSource | null
  discountPercent: number
  expiryDate: string | null
  notes: string | null
  /** The Excel row it came from, so a later error can point back at the file. */
  importRowNumber: number
}

export interface ImportWizardHeader {
  branchId: number
  warehouseId: number
  /** The header warehouse's code, for the question a single-warehouse file for another warehouse raises. */
  warehouseCode?: string
  /** Null in stock mode: an Inventory In / Out document has no price list. */
  priceListId: number | null
  currencyCode: string
  decimalPlaces: number
}

export interface ImportInvoiceItemsWizardProps {
  opened: boolean
  onClose: () => void
  header: ImportWizardHeader
  /** The hosting page's document type: always sent, it picks the unit preference and rejects rows typed for another kind. */
  documentTypeCode: string
  /**
   * invoice: rows are priced against the header's price list and discounts apply.
   * stock: nothing is priced — the price column is the UNIT COST and discounts do not exist.
   * transfer (a transfer order, script 90): no money and no warehouse at all - the order holds both ends - so the
   * preview has neither column, the rows are checked by the transfer's own `validate` against its From, and the last
   * step says the lines are on the draft, not saved yet. No import log is written (the transfer has none).
   */
  mode?: 'invoice' | 'stock' | 'transfer'
  /**
   * The family's own validation of the file, in place of the sales import's (a transfer's `import-validate` against
   * its From). It answers the same rows and verdicts.
   */
  validate?: (file: File) => Promise<ImportValidationResult>
  /** The family's own template, in place of the sales import's (a transfer's Transfer_Order_Lines_Template.xlsx). */
  downloadTemplate?: () => Promise<void>
  /** The host's draft id, recorded on the audit row so it can be attached to the document later. */
  draftReference?: string | null
  /**
   * Invoice mode only: rows that would take more than the stock on hand — cumulatively with the
   * rows above them for the same item and warehouse — come back as Errors.
   */
  checkStock?: boolean
  /** The usable rows, and the name of the file they came from (a transfer's draft says it: "… added from {file}."). */
  onImported: (lines: ImportedLine[], fileName: string) => void
  /**
   * The family's import-create. With splitByWarehouse false: ONE new document holding every row, each
   * keeping the warehouse the file named. With it true: one new document per warehouse, in the order
   * the file first names them. When it is given and the validated rows span several warehouses, the
   * wizard offers to create instead of appending; without it the rows are appended to the open
   * document, which can hold several warehouses just as well.
   *
   * splitByWarehouse is only ever true when the host passed allowSplitByWarehouse; a host that did not
   * may ignore it.
   */
  importCreate?: (lines: ImportedLine[], postImmediately: boolean, splitByWarehouse: boolean) => Promise<ImportCreateResult>
  /**
   * Offers "One document per warehouse" in step 3 when the file names several warehouses: a choice
   * made on every import, OFF by default (one document holding every warehouse). Sales Invoice and
   * Inventory In pass it; the family's import-create must accept splitByWarehouse.
   */
  allowSplitByWarehouse?: boolean
  /** Where a created document lives, for the links in the result panel. */
  documentRoute?: (id: number) => string
  /**
   * A supplier invoice holds ONE item. With import-create given, a file of several items — or of another
   * item than the open invoice's — becomes one new invoice per item instead of being appended.
   */
  onePerItem?: boolean
  /** The item the open invoice already holds (its first line's), null when it has no line yet. */
  heldItemId?: number | null
  /** After the result panel's "Go to the list": the host navigates and highlights the new rows. */
  onDocumentsCreated?: (result: ImportCreateResult) => void
  /**
   * A single-warehouse file for another warehouse than the header's: after the reader agrees, the
   * host switches the document to that warehouse and the lines are appended.
   */
  onSwitchWarehouse?: (warehouseId: number, warehouseCode: string) => void
}

const MAX_FILE_BYTES = 10 * 1024 * 1024

const STATUS_COLOURS: Record<ImportRowStatus, string> = {
  Valid: 'green',
  Warning: 'orange',
  Error: 'red',
  Merged: 'gray',
}

/** Where step 3 is: appending to the open document, or making one new document from the file. */
type Phase = 'appending' | 'groups' | 'creating' | 'created'

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
 * THE WAREHOUSE IS A LINE'S. A file naming several warehouses can be appended to the open document
 * as it is; when the host passed import-create, step 3 lists the warehouses and offers to make ONE
 * new document from the file instead — or, where the host allows it and the reader turns on "One
 * document per warehouse" ("One invoice per warehouse" on the Sales Invoice page), one new document
 * per warehouse. A file for one other warehouse asks to switch the lines to it.
 *
 * THE HOST OWNS THE LINES. This component returns them through onImported and writes only the audit
 * row; whichever screen opened it adds them to its own draft and saves them with everything else.
 * That is what lets one wizard serve the Sales Invoice, Inventory In and Inventory Out screens - and, in
 * transfer mode, a transfer order's draft (no warehouse, no money, the transfer's own validation and template).
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
  documentTypeCode,
  mode = 'invoice',
  draftReference,
  checkStock = false,
  onImported,
  importCreate,
  allowSplitByWarehouse = false,
  documentRoute,
  onePerItem = false,
  heldItemId = null,
  onDocumentsCreated,
  onSwitchWarehouse,
  validate: validateFile,
  downloadTemplate: downloadOwnTemplate,
}: ImportInvoiceItemsWizardProps) {
  const fullScreen = useMediaQuery('(max-width: 768px)')
  const isStock = mode === 'stock'
  const isTransfer = mode === 'transfer'
  // Nothing priced: an inventory document's cost, or a transfer, which has none.
  const unpriced = mode !== 'invoice'
  /* NO ERROR FILE FOR A TRANSFER. The file is the sales import's (its columns: Warehouse, Unit Price...), behind its
     own right (sales.invoices.import): a transfer's rows would come back in a sales-shaped sheet. The reasons of every
     row are on screen (2.5.5 asks for no file). */
  const errorFileOffered = !isTransfer

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

  const [phase, setPhase] = useState<Phase>('appending')
  const [postImmediately, setPostImmediately] = useState(false)
  const [created, setCreated] = useState<ImportCreateResult | null>(null)
  /** Step 3 makes one invoice per item of the file (a supplier invoice holds one item). */
  const [byItem, setByItem] = useState(false)
  /** The reader's "One document per warehouse" switch. Off is today's single mixed document. */
  const [splitByWarehouse, setSplitByWarehouse] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  /** Valid and Warning rows are what gets imported; Merged is already inside one of them. */
  const importable = useMemo(
    () => result?.rows.filter((r) => r.status === 'Valid' || r.status === 'Warning') ?? [],
    [result],
  )

  /** The warehouses the importable rows name, first-seen order, with how many rows each has. */
  const warehouseGroups = useMemo(() => {
    const groups: { warehouseId: number; warehouseCode: string; rows: number; warnings: number }[] = []
    for (const row of importable) {
      if (row.warehouseId === null) continue
      let group = groups.find((g) => g.warehouseId === row.warehouseId)
      if (!group) {
        group = { warehouseId: row.warehouseId, warehouseCode: row.warehouseCode ?? String(row.warehouseId), rows: 0, warnings: 0 }
        groups.push(group)
      }
      group.rows++
      if (row.status === 'Warning') group.warnings++
    }
    return groups
  }, [importable])

  /** The items the importable rows name, first-seen order, with how many rows each has. */
  const itemGroups = useMemo(() => {
    const groups: { itemId: number; itemCode: string; itemName: string; rows: number }[] = []
    for (const row of importable) {
      if (row.itemId === null) continue
      const group = groups.find((g) => g.itemId === row.itemId)
      if (group) group.rows++
      else groups.push({ itemId: row.itemId, itemCode: row.itemCode ?? String(row.itemId), itemName: row.itemName ?? '', rows: 1 })
    }
    return groups
  }, [importable])

  /*
   * ONE DOCUMENT OR ONE PER WAREHOUSE. The switch is offered only where the host allows it, the file
   * names several warehouses and the supplier-invoice item split is not in play; split is what will be
   * sent. The noun is what step 3 calls a created document: the Sales Invoice page makes invoices,
   * every other host keeps the "document" it always read.
   */
  const noun = allowSplitByWarehouse && !isStock ? 'invoice' : 'document'
  const splitOffered = allowSplitByWarehouse && !byItem && warehouseGroups.length > 1
  const split = splitOffered && splitByWarehouse

  /*
   * HOW MANY WAREHOUSES OF A SPLIT WENT THROUGH WITHOUT A REFUSAL, for the result to say only what is
   * true. Each warehouse's document fails at most once (refused save, refused posting, unexpected
   * error) and a split's failure always names its warehouse, so a warehouse no failure names went ahead.
   */
  const refusedWarehouseIds = new Set(created?.failed.map((f) => f.warehouseId) ?? [])
  const warehousesThrough = warehouseGroups.filter((g) => !refusedWarehouseIds.has(g.warehouseId)).length

  const visibleRows = useMemo(
    () => (filter === 'all' ? (result?.rows ?? []) : (result?.rows ?? []).filter((r) => r.status === filter)),
    [result, filter],
  )

  const money = useCallback(
    (value: number | null) =>
      value == null ? '—' : formatMoney(value, header.currencyCode, header.decimalPlaces),
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
      if (downloadOwnTemplate) await downloadOwnTemplate()
      else await invoiceImportApi.downloadTemplate(documentTypeCode)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The template could not be downloaded.')
    }
  }

  async function validate() {
    if (!file) return

    setValidating(true)
    try {
      const answer = validateFile
        ? await validateFile(file)
        : await invoiceImportApi.validate(file, {
            branchId: header.branchId,
            warehouseId: header.warehouseId,
            // Stock mode sends no price list at all — see the class remark.
            priceListId: unpriced ? null : header.priceListId,
            checkStock: !unpriced && checkStock,
            documentTypeCode,
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
   * The audit row. A record of the import, not a condition of it: a failed log never stops the lines.
   *
   * part is one warehouse's share of the file when it became an invoice of its own: the row then
   * names that warehouse and counts only the rows that invoice took, so each invoice's "Imported"
   * entry says what came to IT rather than repeating the whole file.
   */
  async function logImport(invoiceId?: number, part?: { warehouseId: number; rows: number; warnings: number }) {
    // A transfer keeps no import log: its audit says what was saved, once the draft is saved.
    if (!result || isTransfer) return
    try {
      await invoiceImportApi.log({
        branchId: header.branchId,
        warehouseId: part?.warehouseId ?? header.warehouseId,
        priceListId: isStock ? null : header.priceListId,
        fileName: result.fileName,
        totalRows: result.totalRows,
        importedRows: part?.rows ?? importable.length,
        warningRows: part?.warnings ?? result.warningRows,
        rejectedRows: result.errorRows,
        draftReference: draftReference ?? null,
        invoiceId: invoiceId ?? null,
      })
    } catch {
      // THE LINES STILL GO IN. Losing the record is a smaller harm than making somebody redo the
      // whole file because a log write failed.
    }
  }

  /**
   * Decides what step 3 is, then does it.
   *
   * SEVERAL WAREHOUSES AND A HOST THAT CAN CREATE DOCUMENTS: the groups panel, not an append — the
   * open document holds one warehouse. ONE OTHER WAREHOUSE: ask, switch the document, append. The
   * header's own warehouse, or a host without import-create: append as before.
   */
  async function runImport() {
    if (!result || importable.length === 0) return

    // ONE ITEM PER SUPPLIER INVOICE: several items, or another item than the open invoice holds, cannot be
    // appended to it — they become new invoices, one per item.
    if (onePerItem && importCreate && (itemGroups.length > 1 || (heldItemId !== null && itemGroups[0]?.itemId !== heldItemId))) {
      setByItem(true)
      setStep(2)
      setPhase('groups')
      return
    }

    if (warehouseGroups.length > 1 && importCreate) {
      setStep(2)
      setPhase('groups')
      return
    }

    const only = warehouseGroups[0]
    if (warehouseGroups.length === 1 && only && only.warehouseId !== header.warehouseId && onSwitchWarehouse) {
      const go = await confirm({
        title: 'Switch the document warehouse?',
        message: `The file is for ${only.warehouseCode}${header.warehouseCode ? `, not ${header.warehouseCode}` : ''} — switch the document to ${only.warehouseCode}? The lines already on the document move with it.`,
        confirmLabel: `Switch to ${only.warehouseCode}`,
      })
      if (!go) return
      onSwitchWarehouse(only.warehouseId, only.warehouseCode)
    }

    await appendRows()
  }

  /**
   * Walks the importable rows on screen and then hands them over.
   *
   * THE PROGRESS IS HONEST ABOUT BEING COSMETIC: the rows are already validated and already in the
   * browser, so there is nothing to wait for. It exists because handing sixty lines to a grid in one
   * frame looks like nothing happened, and a person who pressed Import needs to see that it did.
   */
  async function appendRows() {
    setStep(2)
    setPhase('appending')
    setImporting(true)
    setProgress(0)

    const stride = Math.max(1, Math.round(importable.length / 20))
    for (let done = 0; done < importable.length; done += stride) {
      setProgress(Math.min(done + stride, importable.length))
      await new Promise((resolve) => setTimeout(resolve, 30))
    }

    await logImport()

    onImported(importable.map(toLine), result?.fileName ?? '')
    setImporting(false)
    setImported(true)
  }

  /**
   * The new documents, through the host's import-create: ONE holding every row, each in its own
   * warehouse — or, with the switch on, one per warehouse (split), each holding that warehouse's rows.
   */
  async function createDocuments() {
    if (!importCreate) return
    setPhase('creating')
    try {
      const answer = await importCreate(importable.map(toLine), postImmediately, split)
      setCreated(answer)
      setPhase('created')
      await logCreated(answer)
      const what = `${formatNumber(answer.created)} ${byItem ? 'invoice' : noun}(s) created${answer.posted > 0 ? `, ${formatNumber(answer.posted)} posted` : ''}`
      const unreceived = answer.documents.filter((d) => d.warning).length
      if (answer.failed.length === 0) notify.success(`${what}.`)
      // ONE PER WAREHOUSE SUCCEEDS OR FAILS ONE BY ONE: the ones that went through are said as well,
      // not buried under a refusal that concerned another warehouse.
      else if (split && answer.created > 0) notify.warning(`${what}; ${formatNumber(answer.failed.length)} refused — see the reasons below.`)
      else if (split) notify.error(`No ${noun} could be created — see the reasons below.`)
      else notify.error(`The ${noun} could not be ${postImmediately ? 'posted' : 'created'} — see the reason below.`)
      if (unreceived > 0) notify.warning(`${formatNumber(unreceived)} posted without their goods receipt — see the reason below.`)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The documents could not be created.')
      setPhase('groups')
    }
  }

  /**
   * The audit rows for what import-create made.
   *
   * EVERY INVOICE GETS ITS OWN "Imported" ENTRY. A log written with an invoice id is what puts one on
   * a sales invoice, so one invoice per warehouse means one log per invoice, each counting that
   * warehouse's rows; the one mixed invoice keeps the one log, against it. Stock mode (Inventory In /
   * Out, purchase) keeps the draft reference only, the log having no such document to point at.
   * Nothing created still leaves the one log of the attempt.
   */
  async function logCreated(answer: ImportCreateResult) {
    if (isStock) return logImport()
    if (!split || answer.documents.length === 0) return logImport(answer.documents[0]?.id)
    for (const doc of answer.documents) {
      const group = warehouseGroups.find((g) => g.warehouseId === doc.warehouseId)
      await logImport(doc.id, { warehouseId: doc.warehouseId, rows: group?.rows ?? doc.lineCount, warnings: group?.warnings ?? 0 })
    }
  }

  /* ── closing ────────────────────────────────────────────────────────────────────────────────── */

  /**
   * Asks before throwing away a validation, and ONLY then: on step 1 there is nothing to lose, and
   * after a successful import the work is already in the host's grid.
   */
  async function requestClose() {
    const hasUnimportedWork = result !== null && !imported && created === null && importable.length > 0 && phase !== 'creating'
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

  const skipped = result?.errorRows ?? 0
  const importLabel = isTransfer
    ? `Add ${formatNumber(importable.length)} line${importable.length === 1 ? '' : 's'}`
    : importable.length === 0
      ? 'Import Valid Rows'
      : skipped > 0
        ? `Import ${importable.length} Row(s), Skip ${skipped}`
        : `Import Valid Rows (${importable.length})`

  const columnCount = isTransfer ? 9 : isStock ? 11 : 12

  return (
    <Modal
      opened={opened}
      onClose={() => void requestClose()}
      title={isTransfer ? 'Import Transfer Lines from Excel' : isStock ? 'Import Stock Lines from Excel' : 'Import Invoice Items from Excel'}
      size="xl"
      fullScreen={fullScreen}
      centered={!fullScreen}
    >
      <Stepper active={step} size="sm" mb="lg" allowNextStepsSelect={false}>
        <Stepper.Step label="Upload File" description="Choose an .xlsx" />
        <Stepper.Step label="Validate & Preview" description="Check what will be imported" />
        <Stepper.Step label="Import" description={phase === 'appending' ? 'Add the rows' : 'Create the documents'} />
      </Stepper>

      {step === 0 && (
        <Stack>
          <Alert color="blue" title="Use the standard template">
            <Group justify="space-between" align="center" wrap="wrap" gap="sm">
              {isTransfer ? (
                <Text size="sm">
                  The transfer&apos;s own template: Item Code / Barcode, Unit, Quantity and Notes. No warehouse or cost: they
                  come from the order. A blank Unit is the item&apos;s base unit; a box&apos;s barcode takes the box.
                </Text>
              ) : allowSplitByWarehouse && importCreate ? (
                <Text size="sm">
                  One template for every document type. Rows may name a warehouse; a file naming several
                  warehouses becomes one {noun} whose lines each keep their own, or one {noun} per warehouse
                  when you turn on “One {noun} per warehouse” at the last step.
                </Text>
              ) : (
                <Text size="sm">
                  One template for every document type. Rows may name a warehouse; a file naming several
                  warehouses becomes one document whose lines each keep their own.
                </Text>
              )}
              <Button variant="light" size="xs" onClick={() => void downloadTemplate()}>
                {isTransfer ? 'Download the template' : 'Download Template'}
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

          {warehouseGroups.length > 1 && (
            <Alert color="blue" title={`${warehouseGroups.length} warehouses in this file`}>
              {warehouseGroups.map((g) => `${g.warehouseCode} - ${g.rows} line(s)`).join(', ')}.{' '}
              {importCreate && splitOffered
                ? `On the next step they become one new ${noun} whose lines each keep their own warehouse, or one ${noun} per warehouse — your choice.`
                : importCreate
                  ? 'They become one new document on the next step; each line keeps its own warehouse.'
                  : 'The lines are appended to this document; each keeps the warehouse the file named.'}
            </Alert>
          )}

          <Chip.Group multiple={false} value={filter} onChange={(v) => setFilter(v as typeof filter)}>
            <Group gap="xs">
              <Chip value="all">All ({result.rows.length})</Chip>
              <Chip value="Valid" color="green">Valid ({result.validRows})</Chip>
              <Chip value="Warning" color="orange">Warnings ({result.warningRows})</Chip>
              <Chip value="Error" color="red">Errors ({result.errorRows})</Chip>
            </Group>
          </Chip.Group>

          <ScrollArea.Autosize mah={360} type="auto">
            <Table striped highlightOnHover stickyHeader miw={1000}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={50}>#</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Item Code</Table.Th>
                  <Table.Th>Item Name</Table.Th>
                  <Table.Th>Unit</Table.Th>
                  {/* A transfer's warehouses are the order's: no row has one of its own. */}
                  {!isTransfer && <Table.Th>Warehouse</Table.Th>}
                  {/* What the shelf holds, beside what the row asks of it. Base units, like the check. */}
                  <Table.Th ta="right">On Hand</Table.Th>
                  <Table.Th ta="right">Qty</Table.Th>
                  {/* A transfer moves no money. */}
                  {!isTransfer && <Table.Th ta="right">{isStock ? 'Unit Cost' : 'Price'}</Table.Th>}
                  {/* An inventory document has no discounts, so the column is not there to explain. */}
                  {!unpriced && <Table.Th ta="right">Discount %</Table.Th>}
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleRows.map((row) => {
                  const short = row.onHandBase != null && row.requiredBase != null && row.requiredBase > row.onHandBase
                  return (
                    <Table.Tr key={row.rowNumber}>
                      <Table.Td>{row.rowNumber}</Table.Td>
                      <Table.Td>
                        <Text fz="xs" c={row.rowDocumentTypeCode === documentTypeCode ? 'dimmed' : 'red'} span>
                          {row.rowDocumentTypeCode ?? '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>{row.itemCode ?? row.itemRef ?? '—'}</Table.Td>
                      <Table.Td>{row.itemName ?? '—'}</Table.Td>
                      <Table.Td>{row.unitTypeName ?? '—'}</Table.Td>
                      {!isTransfer && <Table.Td>{row.warehouseCode ?? '—'}</Table.Td>}
                      <Table.Td ta="right">
                        {row.onHandBase == null ? (
                          '—'
                        ) : (
                          <Text fz="sm" span c={short ? 'red' : undefined} fw={short ? 700 : 400}>
                            {formatNumber(row.onHandBase)}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">{row.quantity == null ? '—' : formatNumber(row.quantity)}</Table.Td>
                      {!isTransfer && <Table.Td ta="right">{money(row.unitPrice)}</Table.Td>}
                      {!unpriced && <Table.Td ta="right">{row.discountPercent}</Table.Td>}
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
                  )
                })}
                {visibleRows.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={columnCount}>
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
            {errorFileOffered && (result.errorRows > 0 || result.warningRows > 0) && (
              <Button variant="light" onClick={() => void downloadErrorReport()}>
                Download Error File
              </Button>
            )}
            <Button disabled={importable.length === 0} onClick={() => void runImport()}>
              {warehouseGroups.length > 1 && importCreate ? `Continue with ${importable.length} Row(s)` : importLabel}
            </Button>
          </Group>
        </Stack>
      )}

      {step === 2 && result && phase === 'appending' && (
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

          {/* A TRANSFER'S LINES ARE ON THE DRAFT, NOT SAVED: the last step says so, and what was left out. */}
          {imported && importable.length > 0 && isTransfer && (
            <Alert color="green" title="Lines added" data-import-transfer>
              {formatNumber(importable.length)} line{importable.length === 1 ? '' : 's'} added from {result.fileName}. Save the order to
              keep them.
              {result.errorRows > 0
                ? ` ${formatNumber(result.errorRows)} row(s) with errors were not added.`
                : ''}
            </Alert>
          )}

          {imported && importable.length > 0 && !isTransfer && (
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
                {errorFileOffered && (
                  <Button variant="light" size="xs" onClick={() => void downloadErrorReport()}>
                    Download Error File
                  </Button>
                )}
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

      {step === 2 && result && (phase === 'groups' || phase === 'creating') && (
        <Stack>
          {byItem ? (
            <Alert color="blue" title="One invoice per item" data-import-by-item>
              The file holds {formatNumber(itemGroups.length)} item(s). A supplier invoice holds one item: they become{' '}
              {formatNumber(itemGroups.length)} new invoice(s), one per item, with the header of this one; the open invoice is
              left as it is.
            </Alert>
          ) : split ? (
            <Alert color="blue" title={`One ${noun} per warehouse`} data-import-split>
              The file names {formatNumber(warehouseGroups.length)} warehouses. They become{' '}
              {formatNumber(warehouseGroups.length)} new {noun}s, one per warehouse, each with the header of this one and
              only that warehouse&apos;s lines; the open {noun} is left as it is.
            </Alert>
          ) : (
            <Alert color="blue" title={`One ${noun}, several warehouses`}>
              The file names {formatNumber(warehouseGroups.length)} warehouses. They become ONE new {noun} whose
              lines each keep the warehouse the file gave them; the open {noun} is left as it is.
            </Alert>
          )}

          {/* THE READER'S CHOICE, MADE ON EVERY IMPORT and off by default: off is the one mixed
              document the import has always made, so nobody gets several by surprise. */}
          {splitOffered && (
            <Switch
              label={`One ${noun} per warehouse`}
              description={`Off: one ${noun} holding every warehouse. On: one ${noun} per warehouse (${formatNumber(warehouseGroups.length)} ${noun}s).`}
              checked={splitByWarehouse}
              onChange={(event) => setSplitByWarehouse(event.currentTarget.checked)}
              disabled={phase === 'creating'}
              data-import-split-switch
            />
          )}

          <Table withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{byItem ? 'Item' : 'Warehouse'}</Table.Th>
                <Table.Th ta="right">Lines</Table.Th>
                {splitOffered && <Table.Th>Becomes</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {byItem
                ? itemGroups.map((g) => (
                    <Table.Tr key={g.itemId}>
                      <Table.Td>
                        {g.itemCode} - {g.itemName}
                      </Table.Td>
                      <Table.Td ta="right">{formatNumber(g.rows)}</Table.Td>
                    </Table.Tr>
                  ))
                : warehouseGroups.map((g, index) => (
                    <Table.Tr key={g.warehouseId}>
                      <Table.Td>{g.warehouseCode}</Table.Td>
                      <Table.Td ta="right">{formatNumber(g.rows)}</Table.Td>
                      {splitOffered && (
                        <Table.Td>
                          <Text fz="sm" c={split ? undefined : 'dimmed'}>
                            {split
                              ? `New ${noun} ${formatNumber(index + 1)} of ${formatNumber(warehouseGroups.length)}`
                              : `Lines on the one new ${noun}`}
                          </Text>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
            </Table.Tbody>
          </Table>

          <Checkbox
            label="Post immediately"
            description={
              split
                ? `Each ${noun} is posted right after it is created; a refused posting leaves that ${noun} as a draft and the others go on.`
                : `The ${noun} is posted right after it is created; a refused posting leaves it as a draft.`
            }
            checked={postImmediately}
            onChange={(event) => setPostImmediately(event.currentTarget.checked)}
            disabled={phase === 'creating'}
          />

          <Group justify="flex-end">
            <Button variant="default" onClick={() => void requestClose()} disabled={phase === 'creating'}>
              Cancel
            </Button>
            <Button loading={phase === 'creating'} onClick={() => void createDocuments()}>
              {byItem
                ? itemGroups.length === 1 ? 'Create 1 invoice' : `Create ${formatNumber(itemGroups.length)} invoices`
                : split
                  ? `Create ${formatNumber(warehouseGroups.length)} ${noun}s, one per warehouse`
                  : splitOffered ? `Create 1 ${noun}` : 'Create one document'}
            </Button>
          </Group>
        </Stack>
      )}

      {step === 2 && phase === 'created' && created && (
        <Stack>
          <Alert
            color={created.failed.length === 0 ? 'green' : 'orange'}
            title={`${formatNumber(created.created)}${split && created.created < warehouseGroups.length ? ` of ${formatNumber(warehouseGroups.length)}` : ''} ${byItem ? 'invoice' : noun}(s) created${byItem ? ', one per item' : split ? ', one per warehouse' : ''}${created.posted > 0 ? `, ${formatNumber(created.posted)} posted` : ''}`}
          >
            {/* A SPLIT'S REFUSALS ARE SAID AS THEY FELL: nothing created, some warehouses through, or a
                refusal in every warehouse (a document created there then failed its posting). */}
            {created.failed.length > 0
              ? !split
                ? 'The reason is listed below.'
                : created.created === 0
                  ? `No ${noun} was created; the refusals are listed below, each naming its warehouse.`
                  : warehousesThrough > 0
                    ? 'The refusals are listed below, each naming its warehouse; the other warehouses went ahead.'
                    : `Every warehouse met a refusal, listed below with its warehouse; open the ${noun}s that were created to finish them.`
              : byItem
                ? 'Every row in the file is on the invoice of its item, each in the warehouse the file named.'
                : split
                  ? `Every row in the file is on the ${noun} of its warehouse.`
                  : `Every row in the file is on the ${noun}, each in the warehouse the file named.`}
          </Alert>

          {/* ONE PER WAREHOUSE CAN MAKE A LONG LIST: it scrolls inside the dialog, so Close and "Go to
              the list" never leave the screen. */}
          <ScrollArea.Autosize mah={360} type="auto">
            <Table withTableBorder withColumnBorders miw={560} data-import-created>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Document</Table.Th>
                  {byItem && <Table.Th>Item</Table.Th>}
                  <Table.Th>Warehouse</Table.Th>
                  <Table.Th ta="right">Lines</Table.Th>
                  <Table.Th>Status</Table.Th>
                  {documentRoute && <Table.Th w={70} />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {created.documents.map((d) => (
                  <Table.Tr key={d.id}>
                    <Table.Td>
                      {documentRoute ? (
                        <Anchor component={Link} to={documentRoute(d.id)} onClick={onClose} fz="sm" fw={500}>
                          {d.documentNumber ?? `draft #${d.id}`}
                        </Anchor>
                      ) : (
                        <Text fz="sm" fw={500}>{d.documentNumber ?? `draft #${d.id}`}</Text>
                      )}
                    </Table.Td>
                    {/* A MIXED DOCUMENT HAS NO SINGLE WAREHOUSE to name, so it says how many it spans
                        rather than naming the header's and implying the rest are in it. */}
                    {byItem && (
                      <Table.Td>
                        {d.itemCode ? `${d.itemCode} - ${d.itemName ?? ''}` : '—'}
                      </Table.Td>
                    )}
                    <Table.Td>
                      {d.warehouseCount > 1 ? `${formatNumber(d.warehouseCount)} warehouses` : d.warehouseName}
                    </Table.Td>
                    <Table.Td ta="right">{formatNumber(d.lineCount)}</Table.Td>
                    <Table.Td>
                      <Badge color={d.status === 'Posted' ? (d.warning ? 'orange' : 'green') : 'gray'} variant="light">
                        {d.status}
                      </Badge>
                      {/* A SUPPLIER INVOICE WHOSE TYPE RECEIVES ITS GOODS (script 79): the receipt made with it, or
                          why it was not - the invoice is posted either way. */}
                      {d.goodsReceiptNumber ? (
                        <Text fz="xs" c="dimmed" mt={4}>
                          Goods received: {d.goodsReceiptNumber}
                        </Text>
                      ) : null}
                      {d.warning ? (
                        <Text fz="xs" c="orange.8" mt={4} data-import-warning>
                          {d.warning}
                        </Text>
                      ) : null}
                    </Table.Td>
                    {documentRoute && (
                      <Table.Td>
                        <Anchor component={Link} to={documentRoute(d.id)} onClick={onClose} fz="sm" fw={500}>
                          Open
                        </Anchor>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
                {created.failed.map((f, index) => {
                  /* KEYED BY POSITION: a create that never got as far as a document has no document
                     to be keyed by, and a mixed document has no one warehouse to name either. The
                     warehouse is named whenever there is one — one per warehouse always has — and the
                     file's own code stands in when the server could not give its name. */
                  const where =
                    f.warehouseName
                    ?? (f.warehouseId === null
                      ? null
                      : (warehouseGroups.find((g) => g.warehouseId === f.warehouseId)?.warehouseCode ?? `warehouse #${f.warehouseId}`))
                  return (
                    <Table.Tr key={`failed-${index}`} data-import-failed>
                      <Table.Td colSpan={4 + (byItem ? 1 : 0) + (documentRoute ? 1 : 0)}>
                        <Text fz="sm" c="red">
                          {where && (
                            <Text span fz="sm" fw={600}>
                              {where}:{' '}
                            </Text>
                          )}
                          {f.message} ({f.code})
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
            {onDocumentsCreated && (
              <Button onClick={() => onDocumentsCreated(created)}>Go to the list</Button>
            )}
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
    priceSource: row.priceSource,
    discountPercent: row.discountPercent,
    // Date only: the API answers "2028-06-30T00:00:00" and takes a DateOnly back, which "T00:00:00" would fail.
    expiryDate: row.expiryDate ? row.expiryDate.slice(0, 10) : null,
    notes: row.notes,
    importRowNumber: row.rowNumber,
  }
}

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Anchor,
  Autocomplete,
  Badge,
  Button,
  Checkbox,
  Chip,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconDownload, IconFileImport, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react'
import { Link } from 'react-router'
import { ApiError } from '../../api/http'
import {
  containerChargeImportApi,
  type ChargeImportFileRow,
  type ChargeImportOptions,
  type ChargeImportResult,
  type ChargeImportRow,
  type ChargeImportRowStatus,
  type ChargeImportValidation,
} from '../../api/logistics/containerChargeImport'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { chargeTypesApi } from '../../api/purchase/chargeTypes'
import { useAuth } from '../../auth/useAuth'
import { isoDate } from '../../components/documents/documentKind'
import { formatMoney, formatNumber, numberInputValue } from '../../components/format'
import { ChargePaymentPanel } from '../../components/logistics/ChargePaymentPanel'
import { ON_ACCOUNT, chargePaymentErrors, chargePaymentRequest, type ChargePaymentForm } from '../../components/logistics/chargePayment'
import { DateInput } from '../../components/ui/DateInput'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'

const CONTAINERS_ROUTE = '/logistics/containers'
const CHARGES_ROUTE = '/logistics/container-charges'

/** The API's limit (ContainerChargeImportParser.MaxFileBytes), checked before the upload. */
const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Rows drawn at a time: a file may hold 5,000. */
const PAGE = 200

/** Each verdict its colour: the badge, and the row's background for the three that need a look. */
const STATUS: Record<ChargeImportRowStatus, { colour: string; background?: string }> = {
  Valid: { colour: 'green' },
  Warning: { colour: 'yellow', background: 'var(--mantine-color-yellow-light)' },
  Duplicate: { colour: 'violet', background: 'var(--mantine-color-violet-light)' },
  Error: { colour: 'red', background: 'var(--mantine-color-red-light)' },
}

type Filter = 'All' | ChargeImportRowStatus

const DEFAULT_OPTIONS: ChargeImportOptions = { matchContainerNo: true, matchContainerRef: true, matchReference: true }

/** Blank = the charge type's method; Manual is typed line by line on a charge, never imported. */
const ALLOCATIONS = [
  { value: '', label: "Type's default" },
  { value: 'Value', label: 'By Value' },
  { value: 'Quantity', label: 'By Quantity' },
  { value: 'Weight', label: 'By Weight' },
  { value: 'Volume', label: 'By Volume' },
]

const EMPTY_ROW: Omit<ChargeImportFileRow, 'rowNumber'> = {
  container: null,
  chargeType: null,
  amount: null,
  rawAmount: null,
  currency: null,
  chargeDate: null,
  rawChargeDate: null,
  exchangeRate: null,
  rawExchangeRate: null,
  provider: null,
  providerInvoiceNo: null,
  allocation: null,
  notes: null,
}

/** What a validation was asked with: when the page's rows, options or payment change, it no longer says anything. */
const askedKey = (rows: ChargeImportFileRow[], options: ChargeImportOptions, payment: ChargePaymentForm) =>
  JSON.stringify([rows, options, payment])

/** "1 charge", "3 charges". */
const count = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`

/** A cell typed empty is blank in the file. */
const blank = (value: string) => (value.trim() === '' ? null : value)

interface Suggestions {
  chargeTypes: string[]
  currencies: string[]
  providers: string[]
}

/**
 * Logistics › Import Container Charges (script 113): container charges from an Excel file, on a page of their own.
 *
 * THE PAGE IS THE GRID. It opens on its four parts - what to validate on, the payment, the rows, Apply - and "Import
 * Charges" fills the rows from a file (read once by the server, kept on the page as the file says them). Every cell
 * can be corrected in place, a row added by hand or deleted; the server then judges the rows as they are with what the
 * page validates on (the Container column against the container no., the ref or both; the provider's invoice no. as
 * part of what makes two charges the same) and the Payment panel. Errors (red) and Duplicates (violet) are never
 * imported: Apply waits for a validation of the rows as they are now, without either.
 *
 * ONE ROW = ONE CHARGE ON ONE CONTAINER, the rows of one provider invoice in one charge group (and paid cash, one
 * supplier payment) - the rules of the import service, unchanged.
 */
export function ImportContainerChargesPage() {
  const { hasPermission } = useAuth()
  const mayPost = hasPermission(PERMISSIONS.containerChargesPost)

  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<ChargeImportFileRow[]>([])
  const [suggestions, setSuggestions] = useState<Suggestions>({ chargeTypes: [], currencies: [], providers: [] })

  const [options, setOptions] = useState<ChargeImportOptions>(DEFAULT_OPTIONS)
  const [payment, setPayment] = useState<ChargePaymentForm>(ON_ACCOUNT)
  const [validation, setValidation] = useState<ChargeImportValidation | null>(null)
  const [validatedKey, setValidatedKey] = useState<string | null>(null)
  const [validateError, setValidateError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<Filter>('All')
  const [shown, setShown] = useState(PAGE)
  const [post, setPost] = useState(false)
  const [busy, setBusy] = useState<'parse' | 'validate' | 'apply' | null>(null)
  const [result, setResult] = useState<{ result: ChargeImportResult; sent: ChargeImportRow[] } | null>(null)

  // The cells' suggestions: what a file may name (codes), so a typed correction reads as the server will.
  useEffect(() => {
    let alive = true
    Promise.all([
      chargeTypesApi.lookup(true),
      currenciesApi.lookup(true),
      partiesApi.lookup({ partyType: 'Supplier', activeOnly: true }),
    ])
      .then(([types, currencies, parties]) => {
        if (!alive) return
        setSuggestions({
          chargeTypes: types.map((t) => t.chargeCode),
          currencies: currencies.map((c) => c.currencyCode),
          providers: [...new Set(parties.map((p) => p.partyCode))],
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const verdicts = useMemo(() => new Map((validation?.rows ?? []).map((r) => [r.rowNumber, r])), [validation])
  const current = validation !== null && validatedKey === askedKey(rows, options, payment)
  const countOf = (status: ChargeImportRowStatus) => rows.filter((r) => verdicts.get(r.rowNumber)?.status === status).length
  const errors = countOf('Error')
  const duplicates = countOf('Duplicate')
  const importable = countOf('Valid') + countOf('Warning')

  // The charges' currency, for the cash account list: one when the rows have one.
  const currencies = [...new Set((validation?.rows ?? []).map((r) => r.currencyId).filter((id): id is number => id !== null))]
  const currencyCodes = [...new Set((validation?.rows ?? []).map((r) => r.currencyCode).filter(Boolean))].join(', ')
  const paymentProblems = chargePaymentErrors(payment, true)
  const paymentIncomplete = Object.keys(paymentProblems).length > 0

  const applyBlocked =
    rows.length === 0 ? 'Import Charges from a file, or add rows, first.'
    : !current ? 'Validate the rows as they are now first.'
    : errors > 0 || duplicates > 0
      ? `Delete or correct the ${[errors > 0 ? count(errors, 'error row') : null, duplicates > 0 ? count(duplicates, 'duplicate row') : null].filter(Boolean).join(' and ')} first, then validate again.`
    : importable === 0 ? 'Nothing to import.'
    : paymentIncomplete ? Object.values(paymentProblems)[0]
    : null

  /* ── the file ── */

  async function chooseFile(next: File | null) {
    if (!next) return
    if (!next.name.toLowerCase().endsWith('.xlsx')) {
      notify.error('Only .xlsx files can be imported. Save the file as an Excel workbook and try again.')
      return
    }
    if (next.size > MAX_FILE_BYTES) {
      notify.error('The file is larger than 5 MB.')
      return
    }
    if (rows.length > 0 && !(await confirm({ title: 'Import Charges', message: "The rows on the page are replaced by the new file's.", confirmLabel: 'Replace' }))) {
      return
    }
    setBusy('parse')
    try {
      const parsed = await containerChargeImportApi.parse(next)
      setFileName(parsed.fileName)
      setRows(parsed.rows)
      setValidation(null)
      setValidatedKey(null)
      setSelected(new Set())
      setFilter('All')
      setShown(PAGE)
      setResult(null)
      await validate(parsed.rows, parsed.fileName)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be read.')
    } finally {
      setBusy(null)
    }
  }

  async function downloadTemplate() {
    try {
      await containerChargeImportApi.downloadTemplate()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The template could not be downloaded.')
    }
  }

  /* ── edit, validate, delete, apply ── */

  /** A cell corrected: the row as the file would now say it (a typed value replaces what could not be read). */
  const editRow = useCallback((rowNumber: number, patch: Partial<ChargeImportFileRow>) => {
    setRows((prev) => prev.map((r) => (r.rowNumber === rowNumber ? { ...r, ...patch } : r)))
  }, [])

  const tickRow = useCallback((rowNumber: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(rowNumber)) next.delete(rowNumber)
      else next.add(rowNumber)
      return next
    })
  }, [])

  function addRow() {
    const rowNumber = rows.reduce((max, r) => Math.max(max, r.rowNumber), 1) + 1
    setRows([...rows, { rowNumber, ...EMPTY_ROW }])
    setFilter('All')
    setShown((n) => Math.max(n, rows.length + 1))
  }

  async function validate(list = rows, name = fileName) {
    if (list.length === 0) return
    if (!options.matchContainerNo && !options.matchContainerRef) {
      setValidateError('Validate on the container no., the container ref or both: the Container column must find its container.')
      return
    }
    setBusy('validate')
    setValidateError(null)
    try {
      const answer = await containerChargeImportApi.validateRows({ fileName: name, rows: list, options, payment: chargePaymentRequest(payment) })
      setValidation(answer)
      setValidatedKey(askedKey(list, options, payment))
      setSelected(new Set())
    } catch (err) {
      setValidateError(err instanceof ApiError ? err.message : 'The rows could not be validated.')
    } finally {
      setBusy(null)
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return
    const ok = await confirm({
      title: 'Delete rows',
      message: `Delete ${count(selected.size, 'row')} from the import? The file itself is not changed. Validate the rows left again before applying.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setRows(rows.filter((r) => !selected.has(r.rowNumber)))
    setSelected(new Set())
  }

  function selectStatus(status: ChargeImportRowStatus) {
    setSelected(new Set(rows.filter((r) => verdicts.get(r.rowNumber)?.status === status).map((r) => r.rowNumber)))
  }

  async function apply() {
    if (applyBlocked || !validation) return
    const sent = validation.rows.filter((r) => rows.some((x) => x.rowNumber === r.rowNumber))
    const ok = await confirm({
      title: 'Apply the charges',
      message:
        `Create ${count(importable, 'charge')}${post ? ' and post them' : ' as drafts'}?`
        + (payment.paymentType === 1 && post ? ' Paid cash: one supplier payment is made and posted per provider invoice.' : ''),
      confirmLabel: 'Apply',
    })
    if (!ok) return
    setBusy('apply')
    try {
      const answer = await containerChargeImportApi.importRows({ post, payment: chargePaymentRequest(payment), fileName, rows: sent })
      setResult({ result: answer, sent })
      if (answer.createdRows > 0) notify.success(`${count(answer.createdRows, 'charge')} created.`)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The charges could not be imported.')
    } finally {
      setBusy(null)
    }
  }

  function startAgain() {
    setFileName(null)
    setRows([])
    setValidation(null)
    setValidatedKey(null)
    setSelected(new Set())
    setResult(null)
    setPost(false)
  }

  /* ── the page ── */

  const visible = rows.filter((r) => filter === 'All' || verdicts.get(r.rowNumber)?.status === filter)
  const allVisibleTicked = visible.length > 0 && visible.every((r) => selected.has(r.rowNumber))
  const baseCode = validation?.baseCurrencyCode ?? ''

  return (
    <Stack gap="md" data-import-charges-page>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(event) => {
          const picked = event.currentTarget.files?.[0] ?? null
          event.currentTarget.value = ''
          void chooseFile(picked)
        }}
      />
      <PageHeader
        title="Import Container Charges"
        subtitle={fileName ? `From ${fileName}: one row is one charge on one container` : 'Charges from an Excel file: one row is one charge on one container'}
        breadcrumbs={[{ label: 'Logistics' }, { label: 'Containers', to: CONTAINERS_ROUTE }, { label: 'Import charges' }]}
        actions={
          <Group gap="xs">
            <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => void downloadTemplate()}>
              Download the template
            </Button>
            {!result && (
              <Button leftSection={<IconFileImport size={16} />} loading={busy === 'parse'} onClick={() => inputRef.current?.click()}>
                Import Charges
              </Button>
            )}
          </Group>
        }
      />

      {result ? (
        <ImportResult result={result.result} sent={result.sent} onAgain={startAgain} />
      ) : (
        <>
          {/* What to validate on */}
          <Paper radius="lg" p="md" withBorder>
            <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
              <div>
                <Title order={5} mb={6}>Validate on</Title>
                <Chip.Group
                  multiple
                  value={[
                    ...(options.matchContainerNo ? ['no'] : []),
                    ...(options.matchContainerRef ? ['ref'] : []),
                    ...(options.matchReference ? ['charge'] : []),
                  ]}
                  onChange={(next) =>
                    setOptions({ matchContainerNo: next.includes('no'), matchContainerRef: next.includes('ref'), matchReference: next.includes('charge') })
                  }
                >
                  <Group gap="xs">
                    <Chip value="no">Container no.</Chip>
                    <Chip value="ref">Container reference</Chip>
                    <Chip value="charge">Charge reference</Chip>
                  </Group>
                </Chip.Group>
                <Text size="xs" c="dimmed" mt={6}>
                  The Container column is looked up as the ticked container keys. With Charge reference, a row is a duplicate
                  when its container already has the same charge type and provider invoice no. (or another row does); without
                  it, the same type, amount, currency and date.
                </Text>
              </div>
              <Button
                leftSection={<IconRefresh size={16} />}
                loading={busy === 'validate'}
                disabled={rows.length === 0}
                variant={current ? 'default' : 'filled'}
                onClick={() => void validate()}
              >
                {validation ? 'Validate again' : 'Validate'}
              </Button>
            </Group>
            {validateError && <Alert color="red" mt="sm">{validateError}</Alert>}
            {validation && !current && !validateError && rows.length > 0 && (
              <Alert color="orange" mt="sm" variant="light">
                The rows, the options or the payment changed since the last validation: validate again before applying.
              </Alert>
            )}
          </Paper>

          {/* How they are paid */}
          <ChargePaymentPanel
            value={payment}
            onChange={(patch) => setPayment((prev) => ({ ...prev, ...patch }))}
            currencyId={currencies.length === 1 ? currencies[0] : null}
            currencyCode={currencyCodes || "the charges' currency"}
            errors={payment.paymentType === 1 ? paymentProblems : {}}
            postVerb={post ? 'Applying and posting the charges' : 'Posting each charge'}
          />

          {/* The rows, editable */}
          <Paper radius="lg" p="md" withBorder>
            <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
              <Group gap="xs">
                <Title order={5}>Rows</Title>
                {validation && (
                  <>
                    <Badge variant="light" color="green">Valid {formatNumber(countOf('Valid'))}</Badge>
                    <Badge variant="light" color="yellow">Warning {formatNumber(countOf('Warning'))}</Badge>
                    <Badge variant="light" color="violet">Duplicate {formatNumber(duplicates)}</Badge>
                    <Badge variant="light" color="red">Error {formatNumber(errors)}</Badge>
                  </>
                )}
              </Group>
              <Group gap="xs">
                {duplicates > 0 && (
                  <Button size="xs" variant="light" color="violet" onClick={() => selectStatus('Duplicate')}>Tick the duplicates</Button>
                )}
                {errors > 0 && (
                  <Button size="xs" variant="light" color="red" onClick={() => selectStatus('Error')}>Tick the errors</Button>
                )}
                {validation && errors + duplicates + countOf('Warning') > 0 && (
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconDownload size={14} />}
                    onClick={() =>
                      void containerChargeImportApi
                        .downloadErrorReport(validation.rows.filter((r) => r.status !== 'Valid' && rows.some((x) => x.rowNumber === r.rowNumber)))
                        .catch((err: unknown) => notify.error(err instanceof ApiError ? err.message : 'The report could not be downloaded.'))
                    }
                  >
                    Error report
                  </Button>
                )}
                <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={addRow}>Add row</Button>
                <Button size="xs" color="red" leftSection={<IconTrash size={14} />} disabled={selected.size === 0} onClick={() => void deleteSelected()}>
                  Delete{selected.size > 0 ? ` ${formatNumber(selected.size)}` : ''}
                </Button>
              </Group>
            </Group>

            {validation && rows.length > 0 && (
              <SegmentedControl
                size="xs"
                mb="sm"
                value={filter}
                onChange={(next) => {
                  setFilter(next as Filter)
                  setShown(PAGE)
                }}
                data={(['All', 'Error', 'Duplicate', 'Warning', 'Valid'] as Filter[]).map((f) => ({ value: f, label: f === 'All' ? `All ${formatNumber(rows.length)}` : f }))}
              />
            )}

            <ScrollArea type="auto">
              <Table stickyHeader miw={1500} verticalSpacing={4} data-charge-import-rows>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={36}>
                      <Checkbox
                        aria-label="Tick every row shown"
                        checked={allVisibleTicked}
                        indeterminate={!allVisibleTicked && visible.some((r) => selected.has(r.rowNumber))}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            visible.forEach((r) => (allVisibleTicked ? next.delete(r.rowNumber) : next.add(r.rowNumber)))
                            return next
                          })
                        }
                      />
                    </Table.Th>
                    <Table.Th w={46}>Row</Table.Th>
                    <Table.Th miw={170}>Container</Table.Th>
                    <Table.Th miw={110}>Charge Type</Table.Th>
                    <Table.Th miw={130}>Date</Table.Th>
                    <Table.Th miw={130} ta="right">Amount</Table.Th>
                    <Table.Th miw={80}>Currency</Table.Th>
                    <Table.Th miw={150}>Provider</Table.Th>
                    <Table.Th miw={130}>Charge ref.</Table.Th>
                    <Table.Th miw={130}>Allocation</Table.Th>
                    <Table.Th miw={90}>Status</Table.Th>
                    <Table.Th miw={240}>Message</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visible.slice(0, shown).map((file) => (
                    <ChargeRow
                      key={file.rowNumber}
                      file={file}
                      row={verdicts.get(file.rowNumber) ?? null}
                      baseCode={baseCode}
                      ticked={selected.has(file.rowNumber)}
                      suggestions={suggestions}
                      onTick={tickRow}
                      onEdit={editRow}
                    />
                  ))}
                  {visible.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={12}>
                        <Text ta="center" c="dimmed" py="xl">
                          {rows.length === 0
                            ? 'No rows yet: click Import Charges to load an Excel file of the template, or Add row to type a charge.'
                            : 'No rows with that status.'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            {visible.length > shown && (
              <Group justify="center" mt="sm">
                <Button variant="subtle" size="xs" onClick={() => setShown((n) => n + PAGE)}>
                  Show {formatNumber(Math.min(PAGE, visible.length - shown))} more of {formatNumber(visible.length - shown)}
                </Button>
              </Group>
            )}
          </Paper>

          {/* Apply */}
          <Paper radius="lg" p="md" withBorder>
            <Group justify="space-between" wrap="wrap" gap="sm">
              {mayPost ? (
                <Switch
                  checked={post}
                  onChange={(event) => setPost(event.currentTarget.checked)}
                  label="Post the charges"
                  description={payment.paymentType === 1 ? 'Paid cash: posting also pays them.' : 'Off: they are created as drafts.'}
                />
              ) : (
                <Text size="sm" c="dimmed">The charges are created as drafts: posting them needs the Post Container Charges permission.</Text>
              )}
              <Tooltip label={applyBlocked} disabled={applyBlocked === null} multiline w={300}>
                <span>
                  <Button size="md" loading={busy === 'apply'} disabled={applyBlocked !== null} onClick={() => void apply()}>
                    Apply {importable > 0 && current ? count(importable, 'charge') : 'the charges'}
                  </Button>
                </span>
              </Tooltip>
            </Group>
          </Paper>
        </>
      )}
    </Stack>
  )
}

interface ChargeRowProps {
  file: ChargeImportFileRow
  row: ChargeImportRow | null
  baseCode: string
  ticked: boolean
  suggestions: Suggestions
  onTick: (rowNumber: number) => void
  onEdit: (rowNumber: number, patch: Partial<ChargeImportFileRow>) => void
}

/**
 * One row, every cell editable: what the file says in the inputs, what the server made of it under them (the
 * container found, the provider's name, the amount in the base currency), the row's background its verdict's colour.
 * Memoised: typing in one row redraws that row only.
 */
const ChargeRow = memo(function ChargeRow({ file, row, baseCode, ticked, suggestions, onTick, onEdit }: ChargeRowProps) {
  const status = row?.status
  const n = file.rowNumber
  const edit = (patch: Partial<ChargeImportFileRow>) => onEdit(n, patch)
  const foreign = row?.currencyCode != null && !row.isBaseCurrency
  const grouped = row?.groupRowNumber != null && row.groupRowNumber !== row.rowNumber
  const cell = { size: 'xs' as const, variant: 'filled' as const }

  return (
    <Table.Tr style={{ background: status ? STATUS[status].background : undefined }} data-status={status ?? 'Unvalidated'}>
      <Table.Td>
        <Checkbox aria-label={`Tick row ${n}`} checked={ticked} onChange={() => onTick(n)} />
      </Table.Td>
      <Table.Td>{n}</Table.Td>
      <Table.Td>
        <TextInput {...cell} aria-label={`Row ${n} container`} placeholder="No. or ref" value={file.container ?? ''} onChange={(e) => edit({ container: blank(e.currentTarget.value) })} />
        {row?.containerRef && (
          <Text fz="xs" c="dimmed" mt={2}>{[row.containerRef, row.containerNo, row.containerStatusName].filter(Boolean).join(' · ')}</Text>
        )}
      </Table.Td>
      <Table.Td>
        <Autocomplete {...cell} aria-label={`Row ${n} charge type`} placeholder="Code" data={suggestions.chargeTypes} value={file.chargeType ?? ''} onChange={(v) => edit({ chargeType: blank(v) })} />
        {row?.chargeName && <Text fz="xs" c="dimmed" mt={2}>{row.chargeName}</Text>}
      </Table.Td>
      <Table.Td>
        <DateInput
          {...cell}
          aria-label={`Row ${n} date`}
          placeholder={file.rawChargeDate ?? 'Today'}
          valueFormat="DD/MM/YYYY"
          value={file.chargeDate}
          onChange={(v) => edit({ chargeDate: v ? isoDate(v) : null, rawChargeDate: null })}
          clearable
          error={file.rawChargeDate ? `'${file.rawChargeDate}' is not a date` : undefined}
        />
      </Table.Td>
      <Table.Td>
        <NumberInput
          {...cell}
          aria-label={`Row ${n} amount`}
          placeholder={file.rawAmount ?? '0.00'}
          value={file.amount ?? ''}
          min={0}
          decimalScale={2}
          thousandSeparator=","
          hideControls
          styles={{ input: { textAlign: 'right' } }}
          onChange={(v) => edit({ amount: numberInputValue(v), rawAmount: null })}
          error={file.rawAmount ? `'${file.rawAmount}' is not an amount` : undefined}
        />
        {foreign && row?.amountBase != null && (
          <Text fz="xs" c="dimmed" ta="right" mt={2}>≈ {formatMoney(row.amountBase, baseCode)}</Text>
        )}
      </Table.Td>
      <Table.Td>
        <Autocomplete {...cell} aria-label={`Row ${n} currency`} placeholder={baseCode || 'Base'} data={suggestions.currencies} value={file.currency ?? ''} onChange={(v) => edit({ currency: blank(v) })} />
      </Table.Td>
      <Table.Td>
        <Autocomplete {...cell} aria-label={`Row ${n} provider`} placeholder="Supplier code" data={suggestions.providers} value={file.provider ?? ''} onChange={(v) => edit({ provider: blank(v) })} limit={20} />
        {row?.providerName && <Text fz="xs" c="dimmed" mt={2}>{row.providerName}</Text>}
      </Table.Td>
      <Table.Td>
        <TextInput {...cell} aria-label={`Row ${n} charge reference`} placeholder="Provider invoice no." maxLength={100} value={file.providerInvoiceNo ?? ''} onChange={(e) => edit({ providerInvoiceNo: blank(e.currentTarget.value) })} />
        {grouped && <Text fz="xs" c="blue" mt={2} style={{ whiteSpace: 'nowrap' }}>One group with row {row!.groupRowNumber}</Text>}
      </Table.Td>
      <Table.Td>
        <Select
          {...cell}
          aria-label={`Row ${n} allocation`}
          data={ALLOCATIONS}
          value={ALLOCATIONS.some((a) => a.value === (file.allocation ?? '')) ? (file.allocation ?? '') : null}
          placeholder={file.allocation ?? "Type's default"}
          onChange={(v) => edit({ allocation: v ? v : null })}
          allowDeselect={false}
        />
      </Table.Td>
      <Table.Td>
        {status ? <Badge color={STATUS[status].colour} variant="filled">{status}</Badge> : <Text fz="xs" c="dimmed">not validated</Text>}
      </Table.Td>
      <Table.Td>
        <Text size="xs" c={status === 'Error' ? 'red' : status === 'Duplicate' ? 'violet' : undefined}>{row?.message ?? ''}</Text>
      </Table.Td>
    </Table.Tr>
  )
})

/** What became of each row: created (posted or a draft) or refused, with a link to its container. */
function ImportResult({ result, sent, onAgain }: { result: ChargeImportResult; sent: ChargeImportRow[]; onAgain: () => void }) {
  const lines = [...result.rows].sort((a, b) => a.rowNumber - b.rowNumber)
  return (
    <Paper radius="lg" p="md" withBorder data-charge-import-result>
      <Title order={5} mb="sm">Result</Title>
      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
        <Stat label="Created" value={result.createdRows} colour="green" />
        <Stat label="Posted" value={result.postedRows} colour="blue" />
        <Stat label="Drafts" value={result.draftRows} />
        <Stat label="Refused" value={result.failedRows} colour={result.failedRows > 0 ? 'red' : undefined} />
      </SimpleGrid>
      <ScrollArea type="auto">
        <Table striped miw={760} verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={50}>Row</Table.Th>
              <Table.Th>Container</Table.Th>
              <Table.Th>Charge</Table.Th>
              <Table.Th ta="right">Amount</Table.Th>
              <Table.Th>Outcome</Table.Th>
              <Table.Th>Message</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((line) => {
              const row = sent.find((r) => r.rowNumber === line.rowNumber)
              const ref = line.containerRef ?? row?.containerRef ?? row?.containerInput
              const containerId = line.containerId ?? row?.containerId
              const colour = line.outcome === 'Posted' ? 'green' : line.outcome === 'Failed' ? 'red' : line.message ? 'orange' : 'gray'
              return (
                <Table.Tr key={line.rowNumber}>
                  <Table.Td>{line.rowNumber}</Table.Td>
                  <Table.Td>
                    {containerId ? <Anchor component={Link} to={`${CONTAINERS_ROUTE}/${containerId}`} fz="sm">{ref}</Anchor> : (ref ?? '—')}
                  </Table.Td>
                  <Table.Td>{line.chargeCode ?? row?.chargeCode ?? '—'}</Table.Td>
                  <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                    {line.amount != null ? formatMoney(line.amount, line.currencyCode ?? '') : '—'}
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={colour}>
                      {line.outcome === 'Failed' ? 'Refused' : line.outcome === 'Draft' && line.message ? 'Draft, not posted' : line.outcome}
                    </Badge>
                  </Table.Td>
                  <Table.Td><Text size="xs" c={line.outcome === 'Failed' ? 'red' : undefined}>{line.message ?? ''}</Text></Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Group justify="flex-end" mt="md">
        <Button variant="default" component={Link} to={CHARGES_ROUTE}>Open Container Charges</Button>
        <Button onClick={onAgain}>Import another file</Button>
      </Group>
    </Paper>
  )
}

function Stat({ label, value, colour }: { label: string; value: number; colour?: string }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} fz="lg" c={colour}>{formatNumber(value)}</Text>
    </Paper>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert, Badge, Button, Group, Paper, Select, SimpleGrid, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconPrinter } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { partiesApi } from '../../api/masterdata/parties'
import { receiptsApi, type CustomerStatementDto, type CustomerStatementEntryDto } from '../../api/sales/receipts'
import type { PartyLookupDto } from '../../api/types'
import { dateLabel, fromIsoDate, isoDate } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { partyLabel } from '../../components/sales/salesLines'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { FilterBar } from '../../components/ui/FilterBar'
import { PageHeader } from '../../components/ui/PageHeader'
import { STATEMENT_ROUTE } from '../../components/sales/receipt/receiptModel'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'

/** What each entry did to the balance: owed more is orange, owed less is green. */
const TYPE_COLOURS: Record<string, string> = {
  Invoice: 'orange',
  'Receipt reversed': 'orange',
  Receipt: 'green',
  'Sales return': 'green',
  'Invoice cancelled': 'gray',
}

type Row = CustomerStatementEntryDto & { rowKey: string }

/**
 * What each column IS, for the grid engine. The debit and credit columns are totalled over every row
 * the filters leave; the balance is a RUNNING figure and has no total, and the document's own
 * amount mixes currencies and cannot be added up.
 */
const GRID_COLUMNS: GridColumnMeta<Row>[] = [
  { accessor: 'entryDate', kind: 'date' },
  { accessor: 'entryType', kind: 'list', summary: 'count' },
  { accessor: 'documentNumber', text: (r) => r.documentNumber ?? '' },
  { accessor: 'docAmount', kind: 'number', text: (r) => `${formatNumber(r.docAmount, r.decimalPlaces)} ${r.currencyCode ?? ''}` },
  { accessor: 'debit', kind: 'number', summary: 'sum', text: (r) => (r.debit === 0 ? '' : formatNumber(r.debit, 2)) },
  { accessor: 'credit', kind: 'number', summary: 'sum', text: (r) => (r.credit === 0 ? '' : formatNumber(r.credit, 2)) },
  { accessor: 'balance', kind: 'number', text: (r) => formatNumber(r.balance, 2) },
]

/**
 * One customer's account: what they were invoiced, what they paid, and what is still owed.
 *
 * IN THE BASE CURRENCY, because a customer billed in USD and CDF has no single figure otherwise.
 * Each line also shows the document's own amount and currency, so a CDF invoice is recognisable
 * against the receipt that paid it. The balance is a running one that starts from everything before
 * the first date, so a period report still ends at the true closing balance.
 */
export function CustomerStatementPage() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<PartyLookupDto[]>([])
  const [clientId, setClientId] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)
  const [loaded, setStatement] = useState<CustomerStatementDto | null>(null)
  /** The filter combination the loaded statement answers; while it differs from the current one, a load is under way. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const requestKey = `${clientId}|${dateFrom}|${dateTo}`
  const loading = clientId !== null && loadedFor !== requestKey
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    partiesApi.lookup({ partyType: 'Client', activeOnly: false }).then(setClients).catch(() => setError('Customers could not be loaded.'))
  }, [])

  useEffect(() => {
    if (clientId === null) return
    const controller = new AbortController()
    receiptsApi
      .statement(Number(clientId), dateFrom, dateTo, controller.signal)
      .then((doc) => {
        setStatement(doc)
        setLoadedFor(requestKey)
        setError(null)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setLoadedFor(requestKey)
        setError(err instanceof ApiError ? err.message : 'The statement could not be loaded.')
      })
    return () => controller.abort()
  }, [clientId, dateFrom, dateTo, requestKey])

  // Nothing is shown until a customer is chosen, and clearing the choice hides what was loaded.
  const statement = clientId === null ? null : loaded
  const base = statement?.baseCurrencyCode ?? 'USD'
  const rows: Row[] = useMemo(() => (statement?.entries ?? []).map((e, i) => ({ ...e, rowKey: `${i}-${e.entryType}-${e.documentId}` })), [statement])
  /* The whole statement is loaded at once, so the engine filters, sorts, pages and totals it. Same-day
     entries keep their ledger order, and the running balance still reads correctly when the date is
     the sort. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'sales.customerStatement',
    sort: [{ accessor: 'entryDate', direction: 'asc' }],
  })

    const money = (value: number) => (value === 0 ? '—' : formatNumber(value, 2))

  const columns: DataTableColumn<Row>[] = [
    rowNumberColumn<Row>(engine.page, engine.pageSize),
    { accessor: 'entryDate', title: 'Date', width: 110, render: (row) => dateLabel(row.entryDate) },
    { accessor: 'entryType', title: 'Type', width: 150, render: (row) => <Badge color={TYPE_COLOURS[row.entryType] ?? 'gray'} variant="light">{row.entryType}</Badge> },
    { accessor: 'documentNumber', title: 'Document', render: (row) => <Text fz="sm" fw={500}>{row.documentNumber ?? '—'}</Text> },
    {
      accessor: 'docAmount',
      title: 'Document amount',
      width: 190,
      textAlign: 'right',
      render: (row) => <span style={{ whiteSpace: 'nowrap' }}>{formatNumber(row.docAmount, row.decimalPlaces)} {row.currencyCode}</span>,
    },
    { accessor: 'debit', title: `Debit (${base})`, width: 140, textAlign: 'right', render: (row) => money(row.debit) },
    { accessor: 'credit', title: `Credit (${base})`, width: 140, textAlign: 'right', render: (row) => money(row.credit) },
    { accessor: 'balance', title: `Balance (${base})`, width: 150, textAlign: 'right', render: (row) => <Text fz="sm" fw={600}>{formatNumber(row.balance, 2)}</Text> },
  ]

  const print = () => {
    const params = new URLSearchParams({ clientId: clientId ?? '' })
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    void navigate(`${STATEMENT_ROUTE}/print?${params.toString()}`)
  }

  return (
    <div>
      <PageHeader
        title="Customer Statement"
        subtitle="What a customer was invoiced, what they paid, and what is still owed."
        actions={
          <Button variant="default" leftSection={<IconPrinter size={16} />} disabled={statement === null} onClick={print}>
            Print
          </Button>
        }
      />

      <FilterBar>
        <FilterBar.Col span={5}>
          <Select label="Customer" placeholder="Choose a customer" data={clients.map((c) => ({ value: String(c.id), label: partyLabel(c) }))} value={clientId} onChange={setClientId} searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput label="From" placeholder="Beginning" valueFormat="DD/MM/YYYY" value={fromIsoDate(dateFrom)} onChange={(next) => setDateFrom(next ? isoDate(new Date(next)) : null)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput label="To" placeholder="Today" valueFormat="DD/MM/YYYY" value={fromIsoDate(dateTo)} onChange={(next) => setDateTo(next ? isoDate(new Date(next)) : null)} clearable />
        </FilterBar.Col>
      </FilterBar>

      {error && <Alert color="red" mb="md">{error}</Alert>}

      {statement && (
        <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
          <Figure label="Balance brought forward" value={statement.openingBalance} base={base} />
          <Figure label="Invoiced (debit)" value={statement.totalDebit} base={base} />
          <Figure label="Received (credit)" value={statement.totalCredit} base={base} />
          <Figure label="Balance owed" value={statement.closingBalance} base={base} strong />
        </SimpleGrid>
      )}

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="sales.customerStatement"
          idAccessor="rowKey"
          engine={engine}
          exportFileName="customer-statement"
          columns={columns}
          fetching={loading}
          noRecordsText={clientId === null ? 'Choose a customer to see their statement.' : 'No entries in this period.'}
        />
      </Paper>

      {statement && statement.entries.length > 0 && (
        <Group justify="flex-end" mt="xs">
          <Text size="xs" c="dimmed">A positive balance means the customer owes us.</Text>
        </Group>
      )}
    </div>
  )
}

function Figure({ label, value, base, strong }: { label: string; value: number; base: string; strong?: boolean }) {
  return (
    <Paper radius="lg" p="md" withBorder>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fz={strong ? 'xl' : 'lg'} fw={strong ? 700 : 600}>{formatNumber(value, 2)} <Text span size="sm" c="dimmed">{base}</Text></Text>
    </Paper>
  )
}

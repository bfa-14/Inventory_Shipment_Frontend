import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Grid, Group, Paper, Select, Text, Tooltip } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconFilterOff, IconPlus, IconRefresh, IconTableExport } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { currenciesApi } from '../../api/masterdata/currencies'
import { exchangeRatesApi } from '../../api/masterdata/exchangeRates'
import type { CurrencyLookupDto, ExchangeRateDto, RateType } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { currencyLabel, formatDateOnly, formatDateTime, formatRate } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { ExchangeRateFormModal } from './ExchangeRateFormModal'
import {
  RATE_TYPES,
  RATE_TYPE_OPTIONS,
  rateTypeColor,
  rateTypeLabel,
} from './rateTypes'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  currencyId: string | null
  rateType: RateType | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = { currencyId: null, rateType: null, dateFrom: null, dateTo: null }

/** What each column IS, for the grid engine: its kind and what it shows. How a cell LOOKS stays below. */
const GRID_COLUMNS: GridColumnMeta<ExchangeRateDto>[] = [
  { accessor: 'rateDate', kind: 'date', text: (r) => formatDateOnly(r.rateDate), summary: 'count' },
  { accessor: 'currencyCode', kind: 'list', text: (r) => `${r.currencyCode} - ${r.currencyName}` },
  { accessor: 'rateType', kind: 'list', text: (r) => rateTypeLabel(r.rateType) },
  { accessor: 'rate', kind: 'number', text: (r) => formatRate(r.rate, r.decimalPlaces) },
  { accessor: 'notes', text: (r) => r.notes ?? '' },
  { accessor: 'updatedAtUtc', kind: 'date', text: (r) => formatDateTime(r.updatedAtUtc) },
]

type Dialog = { kind: 'create' } | { kind: 'edit'; rate: ExchangeRateDto } | null

export function ExchangeRatesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  /** The last answer from GET latest, tagged with the currency it describes. */
  const [latest, setLatest] = useState<{ currencyId: number; rows: ExchangeRateDto[] } | null>(null)
  const [latestToken, setLatestToken] = useState(0)

  const canCreate = hasPermission(PERMISSIONS.exchangeRatesCreate)
  const canEdit = hasPermission(PERMISSIONS.exchangeRatesEdit)
  const canDelete = hasPermission(PERMISSIONS.exchangeRatesDelete)

  const grid = useGridQuery<Filters, ExchangeRateDto, AllRows<ExchangeRateDto>>({
    initialFilters: NO_FILTERS,
    // Nothing here is typed into: every control is a pick, so every change lands at once.
    initialSort: { columnAccessor: 'rateDate', direction: 'desc' },
    // The rates are loaded whole (newest first, up to the grid's cap) and the grid does the rest.
    paging: 'client',
    errorMessage: 'The exchange rates could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          exchangeRatesApi.search(
            {
              currencyId: filters.currencyId === null ? undefined : Number(filters.currencyId),
              rateType: filters.rateType ?? undefined,
              dateFrom: filters.dateFrom ?? undefined,
              dateTo: filters.dateTo ?? undefined,
              sortBy: 'RateDate',
              sortDir: 'desc',
              page,
              pageSize,
            },
            signal,
          ),
        ),
      [],
    ),
  })

  const { filters, setFilter, data, loading, error } = grid
  const load = grid.reload
  const rows = useMemo(() => data?.items ?? [], [data])

  /* THE ENGINE HOLDS THE LOADED RATES AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column sort,
     paging, footer totals, grouping, CSV. The currency, type and date range above the grid still narrow
     what is loaded from the server; the column filters then narrow that. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'masterdata.exchangeRates',
    sort: [{ accessor: 'rateDate', direction: 'desc' }],
  })

  // Every currency, including inactive ones, so rows on a deactivated currency stay filterable.
  useEffect(() => {
    currenciesApi
      .lookup(false)
      .then(setCurrencies)
      .catch(() => {
        // Not fatal: the filter simply offers no currencies until the next reload.
      })
  }, [])

  const selectedCurrency = currencies.find((c) => String(c.id) === filters.currencyId)
  const baseCode = currencies.find((c) => c.isBaseCurrency)?.currencyCode ?? null
  /* The base currency has no rates - its rate is 1 - so the cards would be three dashes that mean
     nothing. They belong to a quoted currency or to nothing. */
  const showLatest = selectedCurrency !== undefined && !selectedCurrency.isBaseCurrency

  useEffect(() => {
    if (!showLatest || !selectedCurrency) return

    const controller = new AbortController()
    exchangeRatesApi
      .latest(selectedCurrency.id, undefined, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setLatest({ currencyId: selectedCurrency.id, rows })
      })
      .catch(() => {
        // The grid below is the source of record; a failed summary must not blank the page.
      })

    return () => controller.abort()
    // latestToken re-asks after a rate is created, edited or deleted.
  }, [showLatest, selectedCurrency, latestToken])

  /* Read only when the answer describes the currency now selected. Deriving it here rather than
     clearing the state in the effect is what stops the cards showing the PREVIOUS currency's rates
     for a frame after the pick - and keeps the effect free of a synchronous setState. */
  const latestRows = selectedCurrency && latest?.currencyId === selectedCurrency.id ? latest.rows : []

  function exportCsv() {
    downloadCsv(
      'exchange-rates.csv',
      ['Date', 'Currency', 'Type', 'Rate', 'Notes'],
      engine.rows.map((r) => [
        r.rateDate,
        `${r.currencyCode} - ${r.currencyName}`,
        rateTypeLabel(r.rateType),
        formatRate(r.rate, r.decimalPlaces),
        r.notes ?? '',
      ]),
    )
  }

  async function afterChange(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
    // The cards read a different endpoint, so they have to be told the rates moved.
    setLatestToken((token) => token + 1)
  }

  async function handleDelete(rate: ExchangeRateDto) {
    const confirmed = await confirm({
      title: 'Delete exchange rate',
      message: `Delete the ${rateTypeLabel(rate.rateType)} rate for ${rate.currencyCode} on ${formatDateOnly(rate.rateDate)}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await exchangeRatesApi.remove(rate.id)
      await afterChange('Exchange rate deleted successfully.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The exchange rate could not be deleted.')
    }
  }

  const columns: DataTableColumn<ExchangeRateDto>[] = [
    rowNumberColumn<ExchangeRateDto>(engine.page, engine.pageSize),
    {
      accessor: 'rateDate',
      title: 'Date',
      width: 140,
      render: (r) => formatDateOnly(r.rateDate),
    },
    {
      accessor: 'currencyCode',
      title: 'Currency',
      width: 220,
      render: (r) => (
        <Text fz="sm" title={r.currencyName}>
          {r.currencyCode} - {r.currencyName}
        </Text>
      ),
    },
    {
      accessor: 'rateType',
      title: 'Type',
      width: 160,
      render: (r) => (
        <Badge variant="light" color={rateTypeColor(r.rateType)}>
          {rateTypeLabel(r.rateType)}
        </Badge>
      ),
    },
    {
      accessor: 'rate',
      title: 'Rate',
      width: 150,
      textAlign: 'right',
      render: (r) => formatRate(r.rate, r.decimalPlaces),
    },
    {
      accessor: 'notes',
      title: 'Notes',
      render: (r) =>
        r.notes ? (
          <Tooltip label={r.notes} withArrow multiline w={320} position="top-start">
            <Text fz="sm" truncate="end">
              {r.notes}
            </Text>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      accessor: 'updatedAtUtc',
      title: 'Updated',
      width: 180,
      render: (r) => formatDateTime(r.updatedAtUtc),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 110,
      textAlign: 'right',
      render: (rate) => (
        <RowActions
          label={`${rate.currencyCode} ${rateTypeLabel(rate.rateType)}`}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', rate }) }}
          remove={{ visible: canDelete, onClick: () => void handleDelete(rate) }}
        />
      ),
    },
  ]

  const filtered = !grid.isDefault

  return (
    <>
      <PageHeader
        title="Exchange Rates"
        subtitle={
          baseCode
            ? `Rates against the base currency: 1 ${baseCode} = rate x the quoted currency.`
            : 'Rates against the base currency.'
        }
        actions={
          <>
            <MoreActionsMenu
              actions={[
                { label: 'Refresh', icon: <IconRefresh size={16} />, onClick: () => void load() },
                { label: 'Export CSV', icon: <IconTableExport size={16} />, onClick: exportCsv },
              ]}
            />
            {canCreate ? (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
                New Rate
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <Select
            label="Currency"
            placeholder="All currencies"
            searchable
            clearable
            nothingFoundMessage="No currency found"
            data={currencies.map((c) => ({ value: String(c.id), label: currencyLabel(c) }))}
            value={filters.currencyId}
            onChange={(value) => setFilter('currencyId', value)}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            label="Rate Type"
            placeholder="All types"
            data={RATE_TYPE_OPTIONS}
            value={filters.rateType}
            onChange={(value) => setFilter('rateType', (value as RateType | null) ?? null)}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <DatePickerInput
            label="Date from"
            placeholder="Any"
            clearable
            valueFormat="DD MMM YYYY"
            maxDate={filters.dateTo ?? undefined}
            value={filters.dateFrom}
            onChange={(value) => setFilter('dateFrom', value)}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <DatePickerInput
            label="Date to"
            placeholder="Any"
            clearable
            valueFormat="DD MMM YYYY"
            minDate={filters.dateFrom ?? undefined}
            value={filters.dateTo}
            onChange={(value) => setFilter('dateTo', value)}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Button
            variant="default"
            leftSection={<IconFilterOff size={16} />}
            onClick={grid.clearFilters}
            disabled={grid.isDefault}
          >
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {showLatest && selectedCurrency ? (
        <Grid mb="md" gap="md">
          {RATE_TYPES.map((type) => {
            const row = latestRows.find((r) => r.rateType === type.value)
            return (
              <Grid.Col key={type.value} span={{ base: 12, sm: 4 }}>
                <Paper radius="lg" p="md" withBorder h="100%">
                  <Group justify="space-between" mb={6} wrap="nowrap">
                    <Badge variant="light" color={type.color}>
                      {type.label}
                    </Badge>
                    <Text fz="xs" c="dimmed">
                      {row ? formatDateOnly(row.rateDate) : 'No rate yet'}
                    </Text>
                  </Group>
                  <Text fz="lg" fw={700}>
                    {row && baseCode
                      ? `1 ${baseCode} = ${formatRate(row.rate, row.decimalPlaces)} ${row.currencyCode}`
                      : '-'}
                  </Text>
                </Paper>
              </Grid.Col>
            )
          })}
        </Grid>
      ) : null}

      {error ? (
        <Alert color="red" mb="md" title="Could not load exchange rates">
          {error}
        </Alert>
      ) : null}

      {data?.truncated ? (
        <Alert color="yellow" mb="md" title="Showing the newest rows only">
          There are more exchange rates than the grid loads at once. Narrow the list with the filters above (dates, status, customer) to see the rest.
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<ExchangeRateDto>
          storeKey="masterdata.exchangeRates"
          engine={engine}
          exportFileName="exchange-rates"
          columns={columns}
          fetching={loading}
          // Enter on the selected row does what its pencil does.
          onRowActivate={canEdit ? ({ record }) => setDialog({ kind: 'edit', rate: record }) : undefined}
          noRecordsText={
            filtered
              ? 'No exchange rates found. Try clearing the filters to see every rate.'
              : 'No exchange rates found.'
          }
        />
      </Paper>

      {dialog ? (
        <ExchangeRateFormModal
          mode={dialog.kind}
          rate={dialog.kind === 'edit' ? dialog.rate : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterChange(
              dialog.kind === 'create' ? 'Exchange rate created successfully.' : 'Exchange rate updated successfully.',
            )
          }
        />
      ) : null}
    </>
  )
}

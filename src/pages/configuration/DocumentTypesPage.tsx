import { useMemo, useState } from 'react'
import { Alert, Badge, Paper, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import type { DocumentTypeDto } from '../../api/inventory/stockDocuments'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import { columnFilter } from '../../components/ui/columnFilter'
import { DataTable, type DataTableColumn, type DataTableSortStatus } from '../../components/ui/DataTable'
import { useGridFilters, type ColumnText } from '../../components/ui/gridFilters'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useDocumentTypes } from '../../hooks/useDocumentTypes'
import { PERMISSIONS } from '../../navigation'
import { DocumentTypeFormModal } from './DocumentTypeFormModal'

const PRICING_COLOURS: Record<string, string> = { Cost: 'blue', PriceList: 'grape', None: 'gray' }

const yesNo = (value: boolean) => (value ? 'Yes' : 'No')
const stockText = (t: DocumentTypeDto) => (t.stockDirection > 0 ? 'In' : t.stockDirection < 0 ? 'Out' : 'None')
const pricingText = (t: DocumentTypeDto) => (t.defaultPricing === 'PriceList' ? 'Price list' : t.defaultPricing)

/**
 * What each column SHOWS for a type - the text its header filter matches and its funnel lists. Every
 * column here is a closed set or a short word, so each carries a tick list of what it actually holds.
 */
const COLUMN_TEXT: Record<string, ColumnText<DocumentTypeDto>> = {
  code: (t) => t.code,
  name: (t) => t.name,
  family: (t) => t.family,
  stockDirection: stockText,
  numberPrefix: (t) => t.numberPrefix,
  nextNumber: (t) => formatNumber(t.nextNumber),
  numberLength: (t) => String(t.numberLength),
  numberOnPost: (t) => yesNo(t.numberOnPost),
  numberPerBranch: (t) => yesNo(t.numberPerBranch),
  yearInNumber: (t) => yesNo(t.yearInNumber),
  requiresReason: (t) => yesNo(t.requiresReason),
  defaultPricing: pricingText,
  priceEditable: (t) => yesNo(t.priceEditable),
  isActive: (t) => (t.isActive ? 'Active' : 'Inactive'),
}

/** The closed sets the funnels offer, whatever the eight rows happen to contain. */
const YES_NO_VALUES = ['Yes', 'No']
const STATUS_VALUES = ['Active', 'Inactive']

/** Sorts on whatever column was clicked: numbers numerically, flags with No first, the rest as text. */
function compareRows(a: DocumentTypeDto, b: DocumentTypeDto, key: keyof DocumentTypeDto): number {
  const left = a[key]
  const right = b[key]
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true })
}

/**
 * Configuration › Document Types: the eight kinds of document and how each numbers, prices and
 * behaves.
 *
 * EIGHT ROWS AND NO PAGING. It is a settings table, not a list: everything is on one screen, and a
 * reader who wants Inventory Out finds it by reading. What matters is that the columns say, in
 * words, what every document page will do with the type — so a change here can be checked here
 * before the next document proves it.
 *
 * Every column still sorts and filters, as on every other grid. At eight rows neither earns its
 * keep on its own; carrying them means a reader never has to wonder which grids answer a funnel.
 */
export function DocumentTypesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSIONS.documentTypesManage)

  const { types, loading, error, refresh } = useDocumentTypes()
  const [editing, setEditing] = useState<DocumentTypeDto | null>(null)
  const [sortStatus, setSortStatus] = useState<DataTableSortStatus<DocumentTypeDto>>({
    columnAccessor: 'code',
    direction: 'asc',
  })

  const grid = useGridFilters(COLUMN_TEXT)
  const { apply: applyColumnFilters, options: columnOptions } = grid

  /** Eight rows held in one place, so the funnels and the sort both work right here. */
  const records = useMemo(() => {
    const narrowed = applyColumnFilters(types)
    const key = sortStatus.columnAccessor as keyof DocumentTypeDto
    const ordered = [...narrowed].sort((a, b) => compareRows(a, b, key))
    if (sortStatus.direction === 'desc') ordered.reverse()
    return ordered
  }, [types, sortStatus, applyColumnFilters])

  /** The tick lists come from EVERY type, not from the rows surviving the filters. */
  const values = useMemo(
    () => ({
      code: columnOptions(types, 'code'),
      name: columnOptions(types, 'name'),
      family: columnOptions(types, 'family'),
      stockDirection: columnOptions(types, 'stockDirection'),
      numberPrefix: columnOptions(types, 'numberPrefix'),
      numberLength: columnOptions(types, 'numberLength'),
      defaultPricing: columnOptions(types, 'defaultPricing'),
    }),
    [types, columnOptions],
  )

  /** Every yes/no column reads the same, so they are built rather than written out seven times. */
  const flag = (accessor: string, title: string, width: number): DataTableColumn<DocumentTypeDto> => ({
    accessor,
    title,
    width,
    sortable: true,
    ...columnFilter({ ...grid.bind(accessor), label: title, options: YES_NO_VALUES, withText: false }),
    render: (t) => <YesNo value={t[accessor as keyof DocumentTypeDto] as boolean} />,
  })

  const columns: DataTableColumn<DocumentTypeDto>[] = [
    {
      accessor: 'code',
      title: 'Code',
      width: 90,
      sortable: true,
      ...columnFilter({ ...grid.bind('code'), label: 'Code', options: values.code }),
      render: (t) => <Text fz="sm" fw={600}>{t.code}</Text>,
    },
    {
      accessor: 'name',
      title: 'Name',
      width: 150,
      sortable: true,
      ...columnFilter({ ...grid.bind('name'), label: 'Name', options: values.name }),
    },
    {
      accessor: 'family',
      title: 'Family',
      width: 100,
      sortable: true,
      ...columnFilter({ ...grid.bind('family'), label: 'Family', options: values.family, withText: false }),
    },
    {
      accessor: 'stockDirection',
      title: 'Stock',
      width: 90,
      sortable: true,
      ...columnFilter({
        ...grid.bind('stockDirection'),
        label: 'Stock',
        options: values.stockDirection,
        withText: false,
      }),
      render: (t) => (
        <Badge variant="light" color={t.stockDirection > 0 ? 'green' : t.stockDirection < 0 ? 'orange' : 'gray'}>
          {t.stockDirection > 0 ? 'In' : t.stockDirection < 0 ? 'Out' : 'None'}
        </Badge>
      ),
    },
    {
      accessor: 'numberPrefix',
      title: 'Prefix',
      width: 80,
      sortable: true,
      ...columnFilter({ ...grid.bind('numberPrefix'), label: 'Prefix', options: values.numberPrefix }),
    },
    {
      accessor: 'nextNumber',
      title: 'Next number',
      width: 110,
      textAlign: 'right',
      sortable: true,
      // No tick list: the next number is different on every row and climbs as documents are posted.
      ...columnFilter({ ...grid.bind('nextNumber'), label: 'Next number' }),
      render: (t) => formatNumber(t.nextNumber),
    },
    {
      accessor: 'numberLength',
      title: 'Length',
      width: 80,
      textAlign: 'right',
      sortable: true,
      ...columnFilter({
        ...grid.bind('numberLength'),
        label: 'Length',
        options: values.numberLength,
        withText: false,
      }),
    },
    flag('numberOnPost', 'Number on post', 120),
    flag('numberPerBranch', 'Per branch', 100),
    flag('yearInNumber', 'Year in number', 120),
    flag('requiresReason', 'Requires reason', 120),
    {
      accessor: 'defaultPricing',
      title: 'Default pricing',
      width: 120,
      sortable: true,
      ...columnFilter({
        ...grid.bind('defaultPricing'),
        label: 'Default pricing',
        options: values.defaultPricing,
        withText: false,
      }),
      render: (t) => (
        <Badge variant="light" color={PRICING_COLOURS[t.defaultPricing] ?? 'gray'}>
          {t.defaultPricing === 'PriceList' ? 'Price list' : t.defaultPricing}
        </Badge>
      ),
    },
    flag('priceEditable', 'Price editable', 110),
    {
      accessor: 'isActive',
      title: 'Active',
      width: 100,
      sortable: true,
      ...columnFilter({ ...grid.bind('isActive'), label: 'Active', options: STATUS_VALUES, withText: false }),
      render: (t) => <StatusBadge active={t.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 90,
      textAlign: 'right',
      render: (t) => <RowActions label={t.code} edit={{ visible: canManage, onClick: () => setEditing(t) }} />,
    },
  ]

  return (
    <div>
      <PageHeader title="Document Types" subtitle="How every kind of document numbers, prices its lines and behaves." />

      <Alert color="yellow" icon={<IconAlertTriangle size={18} />} mb="md" title="Changing the prefix or the numbering applies to NEW documents only">
        Documents already numbered keep their numbers. Pricing and behaviour changes apply to every document
        opened after the change.
      </Alert>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="configuration.documentTypes"
          records={records}
          columns={columns}
          sortStatus={sortStatus}
          onSortStatusChange={setSortStatus}
          filters={{ activeCount: grid.activeCount, clearAll: grid.clearAll }}
          fetching={loading}
          noRecordsText="No document types."
          onRowClick={canManage ? ({ record }) => setEditing(record) : undefined}
        />
      </Paper>

      {editing ? (
        <DocumentTypeFormModal
          type={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            notify.success(`${saved.code} saved.`)
            // Every document page reads the shared cache; a refresh is what makes them see the change.
            void refresh()
          }}
        />
      ) : null}
    </div>
  )
}

function YesNo({ value }: { value: boolean }) {
  return (
    <Text fz="sm" c={value ? undefined : 'dimmed'}>
      {value ? 'Yes' : 'No'}
    </Text>
  )
}

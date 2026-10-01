import { useState } from 'react'
import { Alert, Badge, Paper, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import type { DocumentTypeDto } from '../../api/inventory/stockDocuments'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
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
const GRID_COLUMNS: GridColumnMeta<DocumentTypeDto>[] = [
  { accessor: 'code', summary: 'count' },
  { accessor: 'name' },
  { accessor: 'family' },
  { accessor: 'stockDirection', text: stockText },
  { accessor: 'numberPrefix' },
  { accessor: 'nextNumber', kind: 'number', text: (t) => formatNumber(t.nextNumber) },
  { accessor: 'numberLength', kind: 'number' },
  { accessor: 'numberOnPost', kind: 'boolean', text: (t) => yesNo(t.numberOnPost) },
  { accessor: 'numberPerBranch', kind: 'boolean', text: (t) => yesNo(t.numberPerBranch) },
  { accessor: 'yearInNumber', kind: 'boolean', text: (t) => yesNo(t.yearInNumber) },
  { accessor: 'requiresReason', kind: 'boolean', text: (t) => yesNo(t.requiresReason) },
  { accessor: 'defaultPricing', text: pricingText },
  { accessor: 'priceEditable', kind: 'boolean', text: (t) => yesNo(t.priceEditable) },
  { accessor: 'isActive', kind: 'boolean', text: (t) => (t.isActive ? 'Active' : 'Inactive') },
]

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

  /** Eight rows held in one place: the engine's filters, sort and totals all work right here. */
  const engine = useDataGrid({
    rows: types,
    columns: GRID_COLUMNS,
    storeKey: 'configuration.documentTypes',
    sort: [{ accessor: 'code', direction: 'asc' }],
  })

  /** Every yes/no column reads the same, so they are built rather than written out seven times. */
  const flag = (accessor: string, title: string, width: number): DataTableColumn<DocumentTypeDto> => ({
    accessor,
    title,
    width,
    render: (t) => <YesNo value={t[accessor as keyof DocumentTypeDto] as boolean} />,
  })

  const columns: DataTableColumn<DocumentTypeDto>[] = [
    {
      accessor: 'code',
      title: 'Code',
      width: 90,
      render: (t) => <Text fz="sm" fw={600}>{t.code}</Text>,
    },
    {
      accessor: 'name',
      title: 'Name',
      width: 150,
    },
    {
      accessor: 'family',
      title: 'Family',
      width: 100,
    },
    {
      accessor: 'stockDirection',
      title: 'Stock',
      width: 90,
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
    },
    {
      accessor: 'nextNumber',
      title: 'Next number',
      width: 110,
      textAlign: 'right',
      // No tick list: the next number is different on every row and climbs as documents are posted.
      render: (t) => formatNumber(t.nextNumber),
    },
    {
      accessor: 'numberLength',
      title: 'Length',
      width: 80,
      textAlign: 'right',
    },
    flag('numberOnPost', 'Number on post', 120),
    flag('numberPerBranch', 'Per branch', 100),
    flag('yearInNumber', 'Year in number', 120),
    flag('requiresReason', 'Requires reason', 120),
    {
      accessor: 'defaultPricing',
      title: 'Default pricing',
      width: 120,
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
          engine={engine}
          exportFileName="document-types"
          columns={columns}
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

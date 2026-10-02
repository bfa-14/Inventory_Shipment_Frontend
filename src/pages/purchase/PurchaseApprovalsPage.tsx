import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Anchor, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconCheck, IconEye, IconX } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { approvalsApi, type PendingApprovalDto } from '../../api/purchase/approvals'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { dateLabel } from '../../components/documents/documentKind'
import { formatMoney, formatNumber } from '../../components/format'
import { announceApproved, waitingLabel, WAITING_LATE_HOURS } from '../../components/purchase/approvalNotices'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { refreshApprovalsMe, useApprovalsMe } from '../../hooks/useApprovalsMe'
import { routes } from '../../routes'

/** Hidden below the small breakpoint: on a phone the Order cell carries the supplier and the wait, so the total keeps its width. */
const WIDE_ONLY = (theme: { breakpoints: { sm: string } }) => `(min-width: ${theme.breakpoints.sm})`

/**
 * The purchase orders waiting for the reader's decision — the ones they can approve IN THE APP, oldest
 * first (the server's list: who may approve is Settings > Purchase approval's to say, not the roles').
 *
 * Every decision refreshes the list and the menu badge together, so the count beside "Approvals" never
 * disagrees with the rows below it.
 */
export function PurchaseApprovalsPage() {
  const navigate = useNavigate()
  const me = useApprovalsMe()
  // Read on the first render: the grid keeps the column widths it is first given.
  const phone = useMediaQuery('(max-width: 48em)', undefined, { getInitialValueInEffect: false })
  const baseCode = me?.baseCurrencyCode ?? 'base'

  const [rows, setRows] = useState<PendingApprovalDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<PendingApprovalDto | null>(null)
  /** Bumped to read the list again. */
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    approvalsApi
      .pending(controller.signal)
      .then((pending) => {
        setRows(pending)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught instanceof ApiError ? caught.message : 'The orders waiting for approval could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [version])

  /** After a decision, or a refusal that says the list is stale: the rows and the badge again. */
  const refresh = useCallback(() => {
    setVersion((current) => current + 1)
    void refreshApprovalsMe()
  }, [])

  function failed(caught: unknown) {
    notify.error(caught instanceof ApiError ? caught.message : 'The decision could not be saved.')
    // Somebody else decided first, or the order changed: what is on screen is no longer true.
    if (caught instanceof ApiError && (caught.status === 409 || caught.status === 410 || caught.status === 403)) refresh()
  }

  async function approve(row: PendingApprovalDto) {
    const go = await confirm({
      title: 'Approve purchase order',
      message: `Approve the order of ${row.supplierName} for ${formatMoney(row.total, row.currencyCode)}?`,
      confirmLabel: 'Approve',
    })
    if (!go) return
    setBusyId(row.id)
    try {
      announceApproved(await approvalsApi.approve(row.id, row.rowVersion))
      refresh()
    } catch (caught) {
      failed(caught)
    } finally {
      setBusyId(null)
    }
  }

  async function reject(row: PendingApprovalDto, reason: string) {
    setBusyId(row.id)
    try {
      await approvalsApi.reject(row.id, reason, row.rowVersion)
      notify.success(`Rejected: the order of ${row.supplierName} is a draft again.`)
      setRejecting(null)
      refresh()
    } catch (caught) {
      failed(caught)
    } finally {
      setBusyId(null)
    }
  }

  const late = (row: PendingApprovalDto) => (row.waitingHours ?? 0) >= WAITING_LATE_HOURS
  const waiting = (row: PendingApprovalDto) => (
    <Text
      component="span"
      fz="inherit"
      fw={late(row) ? 600 : undefined}
      c={late(row) ? 'orange.7' : undefined}
      style={{ whiteSpace: 'nowrap' }}
      data-waiting-late={late(row) || undefined}
    >
      {waitingLabel(row.waitingHours)}
    </Text>
  )

  const columns: DataTableColumn<PendingApprovalDto>[] = [
    { accessor: 'supplierName', title: 'Supplier', visibleMediaQuery: WIDE_ONLY },
    {
      accessor: 'reference',
      title: 'Order',
      width: phone ? undefined : 150,
      render: (row) => (
        <>
          <Anchor component={Link} to={routes.purchaseOrder(row.id)} fz="sm" onClick={(event) => event.stopPropagation()}>
            {row.reference}
          </Anchor>
          {phone ? (
            <Text fz="xs" c="dimmed">
              {row.supplierName} · waiting {waiting(row)}
            </Text>
          ) : null}
        </>
      ),
    },
    { accessor: 'orderDate', title: 'Order date', width: 110, visibleMediaQuery: WIDE_ONLY, render: (row) => dateLabel(row.orderDate) },
    {
      accessor: 'total',
      title: 'Total',
      width: phone ? 96 : 160,
      textAlign: 'right',
      render: (row) => (
        <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
          {formatMoney(row.total, row.currencyCode)}
        </Text>
      ),
    },
    {
      accessor: 'totalBase',
      title: `Total (${baseCode})`,
      width: 130,
      textAlign: 'right',
      visibleMediaQuery: WIDE_ONLY,
      render: (row) => formatNumber(row.totalBase, 2),
    },
    { accessor: 'lineCount', title: 'Lines', width: 70, textAlign: 'right', visibleMediaQuery: WIDE_ONLY, render: (row) => formatNumber(row.lineCount) },
    { accessor: 'requestedByName', title: 'Requested by', visibleMediaQuery: WIDE_ONLY, render: (row) => row.requestedByName ?? '—' },
    {
      accessor: 'waitingHours',
      title: 'Waiting',
      width: 100,
      visibleMediaQuery: WIDE_ONLY,
      render: (row) => <Text fz="sm">{waiting(row)}</Text>,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: phone ? 104 : 130,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={`${row.reference} of ${row.supplierName}`}
          custom={[
            { icon: <IconEye size={16} />, tooltip: 'Open', onClick: () => void navigate(routes.purchaseOrder(row.id)) },
            { icon: <IconCheck size={16} />, tooltip: 'Approve', color: 'green', disabled: busyId !== null, onClick: () => void approve(row) },
            { icon: <IconX size={16} />, tooltip: 'Reject...', color: 'red', disabled: busyId !== null, onClick: () => setRejecting(row) },
          ]}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="Waiting for my approval" subtitle="Purchase orders you can approve in the application, oldest first." />

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      <DataTable
        records={rows}
        columns={columns}
        fetching={loading}
        idAccessor="id"
        noRecordsText="Nothing waits for your approval."
        minHeight={rows.length === 0 ? 180 : undefined}
        onRowClick={({ record }) => void navigate(routes.purchaseOrder(record.id))}
        pinLastColumn
      />

      <CancelReasonModal
        opened={rejecting !== null}
        onClose={() => setRejecting(null)}
        documentLabel={rejecting?.reference ?? ''}
        title={rejecting ? `Reject ${rejecting.reference} of ${rejecting.supplierName}` : 'Reject'}
        description="The order goes back to its author as a draft, with your reason. They can change it and send it again."
        placeholder="Why is this order rejected?"
        confirmLabel="Reject"
        busy={busyId !== null}
        onConfirm={(reason) => rejecting && void reject(rejecting, reason)}
      />
    </div>
  )
}

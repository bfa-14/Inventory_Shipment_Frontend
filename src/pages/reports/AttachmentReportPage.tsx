import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ActionIcon, Alert, Anchor, Button, Checkbox, Group, Loader, MultiSelect, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconDownload, IconFileZip, IconPlayerPlay, IconFilterOff } from '@tabler/icons-react'
import { saveBlob } from '../../api/documentFiles'
import { ApiError } from '../../api/http'
import {
  attachmentReportApi,
  type AttachmentReportFilters,
  type AttachmentReportResult,
  type AttachmentReportRowDto,
  type AttachmentReportTypeDto,
} from '../../api/reports/attachments'
import { isoDate } from '../../components/documents/documentKind'
import { formatDateOnly, formatDateTime, formatNumber } from '../../components/format'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PAGE_SIZE_OPTIONS } from '../../config'

const PAGE_SIZE = 50
/** The page sizes the grid offers (config.ts). */
const PAGE_SIZES: number[] = [...PAGE_SIZE_OPTIONS]

/**
 * Reports › Attachment Report (script 101): every module's attachments by type and by two date ranges, a page at a time
 * from the server, downloaded one, several or all at once.
 *
 * THE FILTERS LIVE IN THE ADDRESS (?types=3,7&docFrom=...&run=1), so a refresh, a bookmark or a link to a colleague opens
 * the same report. What is typed in the filter bar only counts once "Run report" is clicked.
 */
export function AttachmentReportPage() {
  const [params, setParams] = useSearchParams()
  const applied = useMemo(() => filtersFrom(params), [params])
  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = PAGE_SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : PAGE_SIZE
  const ran = params.get('run') === '1'

  const [draft, setDraft] = useState<AttachmentReportFilters>(applied)
  const [types, setTypes] = useState<AttachmentReportTypeDto[]>([])
  const [result, setResult] = useState<AttachmentReportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AttachmentReportRowDto[]>([])
  /** "Select all matching": every result across every page, not only the ticked rows. */
  const [allMatching, setAllMatching] = useState(false)
  const [preparing, setPreparing] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    attachmentReportApi
      .types(controller.signal)
      .then(setTypes)
      .catch(() => {
        /* the filter is then empty: every type */
      })
    return () => controller.abort()
  }, [])

  const dateErrors = dateRangeErrors(draft)

  // The report runs from the address: a refresh or a shared link reruns it.
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!ran || dateRangeErrors(applied).any) return
      setLoading(true)
      setError(null)
      try {
        const loaded = await attachmentReportApi.list(applied, page, pageSize, signal)
        if (!signal?.aborted) setResult(loaded)
      } catch (err) {
        if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
        setError(err instanceof ApiError ? err.messages.join(' ') : 'The report could not be loaded.')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [ran, applied, page, pageSize],
  )

  useEffect(() => {
    const controller = new AbortController()
    // Fetching is the "synchronize with an external system" case: loading has to show before the await.
    // eslint-disable-next-line react/set-state-in-effect
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  function run() {
    if (dateErrors.any) return
    setSelected([])
    setAllMatching(false)
    const next = paramsFrom(draft, 1)
    if (pageSize !== PAGE_SIZE) next.set('size', String(pageSize))
    setParams(next, { replace: false })
  }

  function clearFilters() {
    const empty = emptyFilters()
    setDraft(empty)
    setSelected([])
    setAllMatching(false)
    setResult(null)
    setParams({}, { replace: false })
  }

  function changePageSize(size: number) {
    const nextParams = new URLSearchParams(params)
    nextParams.set('size', String(size))
    nextParams.set('page', '1')
    setParams(nextParams)
  }

  function goToPage(next: number) {
    const nextParams = new URLSearchParams(params)
    nextParams.set('page', String(next))
    setParams(nextParams)
  }

  /** The files a download would take, checked against the limits before asking the server (which checks again). */
  function tooLarge(count: number, bytes: number): string | null {
    if (!result) return null
    if (count <= result.maxFiles && bytes <= result.maxBytes) return null
    return (
      `${formatNumber(count)} files (${sizeLabel(bytes)}) are more than one download may take ` +
      `(${formatNumber(result.maxFiles)} files or ${sizeLabel(result.maxBytes)}). Narrow the filters and try again.`
    )
  }

  async function download(mode: 'selected' | 'all') {
    if (!result) return
    const everything = mode === 'all' || allMatching
    const count = everything ? result.totalCount : selected.length
    const bytes = everything ? result.totalBytes : selected.reduce((sum, r) => sum + r.sizeBytes, 0)
    const refused = tooLarge(count, bytes)
    if (refused) {
      notify.error(refused)
      return
    }

    setPreparing(
      count === 1 && !everything
        ? `Preparing ${selected[0]?.fileName ?? 'the file'}…`
        : `Preparing the ZIP of ${formatNumber(count)} files (${sizeLabel(bytes)})…`,
    )
    try {
      if (everything) {
        saveBlob(await attachmentReportApi.downloadAll(applied), result.zipFileName)
      } else if (selected.length === 1) {
        const only = selected[0] as AttachmentReportRowDto
        saveBlob(await attachmentReportApi.downloadSelected([only.key]), only.downloadName)
      } else {
        saveBlob(
          await attachmentReportApi.downloadSelected(selected.map((r) => r.key)),
          `attachments_selected_${isoDate(new Date())}.zip`,
        )
      }
    } catch (err) {
      notify.error(err instanceof ApiError ? err.messages.join(' ') : 'The download failed.')
    } finally {
      setPreparing(null)
    }
  }

  async function downloadOne(row: AttachmentReportRowDto) {
    setPreparing(`Preparing ${row.fileName}…`)
    try {
      saveBlob(await attachmentReportApi.downloadSelected([row.key]), row.downloadName)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.messages.join(' ') : 'The download failed.')
    } finally {
      setPreparing(null)
    }
  }

  /* The attachment types grouped by category, inactive ones marked: older files keep the type they were filed under. */
  const typeOptions = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>()
    for (const t of types) {
      const list = groups.get(t.category) ?? []
      list.push({ value: String(t.id), label: t.isActive ? t.subType : `${t.subType} (inactive)` })
      groups.set(t.category, list)
    }
    return [...groups].map(([group, items]) => ({ group, items }))
  }, [types])

  const columns: DataTableColumn<AttachmentReportRowDto>[] = [
    {
      accessor: 'fileName',
      title: 'File name',
      render: (row) => (
        <Anchor component="button" type="button" fz="sm" onClick={() => void downloadOne(row)} title={`Download ${row.downloadName}`}>
          {row.fileName}
        </Anchor>
      ),
    },
    { accessor: 'typeLabel', title: 'Attachment type' },
    {
      accessor: 'reference',
      title: 'Reference',
      render: (row) => (
        <Stack gap={0}>
          {row.ownerPath ? (
            <Anchor component={Link} to={row.ownerPath} fz="sm" fw={600}>
              {row.reference}
            </Anchor>
          ) : (
            <Text fz="sm" fw={600}>
              {row.reference}
            </Text>
          )}
          <Text fz="xs" c="dimmed">
            {row.documentKindName}
          </Text>
        </Stack>
      ),
    },
    { accessor: 'documentDate', title: 'Document date', render: (row) => formatDateOnly(row.documentDate) },
    {
      accessor: 'uploadedAtUtc',
      title: 'Uploaded',
      render: (row) => (
        <Stack gap={0}>
          <Text fz="sm">{formatDateTime(row.uploadedAtUtc)}</Text>
          {row.uploadedByName ? (
            <Text fz="xs" c="dimmed">
              {row.uploadedByName}
            </Text>
          ) : null}
        </Stack>
      ),
    },
    { accessor: 'sizeBytes', title: 'Size', textAlign: 'right', render: (row) => sizeLabel(row.sizeBytes) },
    {
      accessor: 'key',
      title: '',
      width: 50,
      render: (row) => (
        <Tooltip label="Download">
          <ActionIcon variant="subtle" aria-label={`Download ${row.fileName}`} onClick={() => void downloadOne(row)} disabled={preparing !== null}>
            <IconDownload size={16} />
          </ActionIcon>
        </Tooltip>
      ),
    },
  ]

  const selectedCount = allMatching ? (result?.totalCount ?? 0) : selected.length
  const filtered = applied.typeIds.length > 0 || hasAnyDate(applied)

  return (
    <>
      <PageHeader
        title="Attachment Report"
        subtitle="Find the documents attached anywhere in the system, by type and date, and download them."
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <MultiSelect
            label="Attachment types"
            placeholder={draft.typeIds.length === 0 ? 'All types' : undefined}
            data={typeOptions}
            value={draft.typeIds.map(String)}
            onChange={(values) => setDraft((d) => ({ ...d, typeIds: values.map(Number) }))}
            searchable
            clearable
            nothingFoundMessage="No type matches"
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Document date from"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={draft.documentDateFrom}
            onChange={(next) => setDraft((d) => ({ ...d, documentDateFrom: next ? isoDate(next) : null }))}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Document date to"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={draft.documentDateTo}
            onChange={(next) => setDraft((d) => ({ ...d, documentDateTo: next ? isoDate(next) : null }))}
            error={dateErrors.document}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Uploaded from"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={draft.uploadedFrom}
            onChange={(next) => setDraft((d) => ({ ...d, uploadedFrom: next ? isoDate(next) : null }))}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Uploaded to"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={draft.uploadedTo}
            onChange={(next) => setDraft((d) => ({ ...d, uploadedTo: next ? isoDate(next) : null }))}
            error={dateErrors.upload}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={12}>
          <Group justify="space-between" wrap="wrap" gap="sm">
            <Text fz="xs" c="dimmed">
              No type chosen = every type. A document-date range leaves out files that have no document date.
            </Text>
            <Group gap="sm">
              <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={clearFilters} disabled={!ran && !filtered}>
                Clear Filters
              </Button>
              <Button leftSection={<IconPlayerPlay size={16} />} onClick={run} disabled={dateErrors.any} loading={loading}>
                Run report
              </Button>
            </Group>
          </Group>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load the report">
          {error}
        </Alert>
      ) : null}

      {preparing ? (
        <Alert color="blue" mb="md" icon={<Loader size={16} />} title="Preparing download">
          {preparing} The download starts by itself when it is ready.
        </Alert>
      ) : null}

      {!ran ? (
        <Paper withBorder radius="lg" p="xl">
          <Text c="dimmed" ta="center">
            Choose the attachment types and dates, then click Run report.
          </Text>
        </Paper>
      ) : (
        <Paper withBorder radius="lg" p="md">
          <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
            <Group gap="md" wrap="wrap">
              <Text fw={600}>
                {formatNumber(result?.totalCount ?? 0)} attachment{result?.totalCount === 1 ? '' : 's'}
                {result && result.totalCount > 0 ? ` · ${sizeLabel(result.totalBytes)}` : ''}
              </Text>
              {result && result.totalCount > 0 ? (
                <Checkbox
                  label={`Select all ${formatNumber(result.totalCount)} matching`}
                  checked={allMatching}
                  onChange={(event) => {
                    setAllMatching(event.currentTarget.checked)
                    setSelected([])
                  }}
                />
              ) : null}
              {selectedCount > 0 ? (
                <Text fz="sm" c="dimmed">
                  {formatNumber(selectedCount)} selected
                </Text>
              ) : null}
            </Group>
            <Group gap="sm">
              <Button
                variant="default"
                leftSection={<IconDownload size={16} />}
                onClick={() => void download('selected')}
                disabled={selectedCount === 0 || preparing !== null}
              >
                Download selected
              </Button>
              <Button
                leftSection={<IconFileZip size={16} />}
                onClick={() => void download('all')}
                disabled={!result || result.totalCount === 0 || preparing !== null}
              >
                Download all
              </Button>
            </Group>
          </Group>

          <DataTable
            records={result?.items ?? []}
            columns={columns}
            idAccessor="key"
            totalRecords={result?.totalCount ?? 0}
            page={page}
            recordsPerPage={pageSize}
            onPageChange={goToPage}
            onRecordsPerPageChange={changePageSize}
            fetching={loading}
            minHeight={200}
            noRecordsText="No attachment matches these filters. Choose other types or a wider date range."
            selectedRecords={allMatching ? (result?.items ?? []) : selected}
            onSelectedRecordsChange={(records) => {
              // Unticking a row while "all matching" is on means the reader wants a hand-picked set again.
              if (allMatching) setAllMatching(false)
              setSelected(records)
            }}
          />
        </Paper>
      )}
    </>
  )
}

function emptyFilters(): AttachmentReportFilters {
  return { typeIds: [], documentDateFrom: null, documentDateTo: null, uploadedFrom: null, uploadedTo: null }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function filtersFrom(params: URLSearchParams): AttachmentReportFilters {
  const date = (name: string) => {
    const value = params.get(name)
    return value && DATE.test(value) ? value : null
  }
  return {
    typeIds: (params.get('types') ?? '')
      .split(',')
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0),
    documentDateFrom: date('docFrom'),
    documentDateTo: date('docTo'),
    uploadedFrom: date('upFrom'),
    uploadedTo: date('upTo'),
  }
}

function paramsFrom(filters: AttachmentReportFilters, page: number): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.typeIds.length > 0) params.set('types', filters.typeIds.join(','))
  if (filters.documentDateFrom) params.set('docFrom', filters.documentDateFrom)
  if (filters.documentDateTo) params.set('docTo', filters.documentDateTo)
  if (filters.uploadedFrom) params.set('upFrom', filters.uploadedFrom)
  if (filters.uploadedTo) params.set('upTo', filters.uploadedTo)
  params.set('page', String(page))
  params.set('run', '1')
  return params
}

function hasAnyDate(f: AttachmentReportFilters): boolean {
  return !!(f.documentDateFrom || f.documentDateTo || f.uploadedFrom || f.uploadedTo)
}

/** A "from" after its "to" stops the report: the message sits under the "to" field. */
function dateRangeErrors(f: AttachmentReportFilters): { document: string | null; upload: string | null; any: boolean } {
  const document =
    f.documentDateFrom && f.documentDateTo && f.documentDateFrom > f.documentDateTo ? 'Before the "from" date.' : null
  const upload = f.uploadedFrom && f.uploadedTo && f.uploadedFrom > f.uploadedTo ? 'Before the "from" date.' : null
  return { document, upload, any: document !== null || upload !== null }
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

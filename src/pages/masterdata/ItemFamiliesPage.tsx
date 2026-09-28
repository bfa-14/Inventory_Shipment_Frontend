import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Alert, Box, Button, Group, Paper, Select, Text, TextInput, Tooltip } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconChevronDown,
  IconChevronRight,
  IconFilterOff,
  IconFolder,
  IconFolderOpen,
  IconFoldDown,
  IconFoldUp,
  IconPlus,
  IconSearch,
} from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import type { ItemFamilyDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { PERMISSIONS } from '../../navigation'
import { ItemFamilyFormModal } from './ItemFamilyFormModal'
import { ancestors, childrenOf, descendants, flattenTree, indexFamilies, parentOptionLabel } from './itemFamilyTree'

/** Which rows the reader has opened. Survives a reload so a deep tree does not collapse under them. */
const EXPANDED_KEY = 'inventory_shipment.itemFamilies.expanded'

/** Pixels of indent per level - the only thing that makes the hierarchy readable in a flat grid. */
const INDENT = 20

/**
 * The combined message for both refusals to delete. The customer asked for one wording: to the
 * reader "it has children" and "an item points at it" are the same problem with the same way out.
 */
const CANNOT_DELETE =
  'This family cannot be deleted because it contains child families or is assigned to existing items. You may deactivate it instead.'

type Dialog =
  | { kind: 'create'; parentId: number | null }
  | { kind: 'edit'; family: ItemFamilyDto }
  | null

export function ItemFamiliesPage() {
  const { hasPermission } = useAuth()

  const canCreate = hasPermission(PERMISSIONS.itemFamiliesCreate)
  const canEdit = hasPermission(PERMISSIONS.itemFamiliesEdit)
  const canDelete = hasPermission(PERMISSIONS.itemFamiliesDelete)

  const [families, setFamilies] = useState<ItemFamilyDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  // Filters apply as they are edited - the search box 350ms after the last keystroke (at once on
  // Enter or when it is cleared), the two dropdowns immediately. There is no Apply button.
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 350)
  /** The text Enter published ahead of the debounce; stale as soon as another key is pressed. */
  const [flushedSearch, setFlushedSearch] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [scopeId, setScopeId] = useState<string | null>(null)

  // An empty box is a finished thought, and so is Enter: both skip the wait.
  const appliedSearch = search === '' || flushedSearch === search ? search : debouncedSearch

  const storedExpanded = useMemo(() => readExpanded(), [])
  const [expanded, setExpanded] = useState<Set<number>>(() => storedExpanded ?? new Set())
  // Nothing was stored yet: the first load opens the roots so the tree does not read as a flat list.
  const seeded = useRef(storedExpanded !== null)

  useEffect(() => {
    if (seeded.current) writeExpanded(expanded)
  }, [expanded])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await itemFamiliesApi.tree()
      setFamilies(rows)
      if (!seeded.current) {
        seeded.current = true
        setExpanded(new Set(rows.filter((f) => f.parentId === null && f.childCount > 0).map((f) => f.id)))
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The item families could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  const index = useMemo(() => indexFamilies(families), [families])

  const filtering = appliedSearch.trim() !== '' || status !== null || scopeId !== null

  /**
   * The rows the grid draws, top to bottom. Unfiltered that is a depth-first walk that stops at
   * every collapsed row; filtered it is every match plus its ancestors, so a hit three levels down
   * is still shown under the families it belongs to instead of floating on its own.
   */
  const visibleRows = useMemo(() => {
    if (!filtering) return flattenTree(index, (id) => expanded.has(id))

    // The Family filter narrows the whole view to one subtree; the others then work inside it.
    const scope = scopeId === null ? null : Number(scopeId)
    let inScope: ItemFamilyDto[]
    if (scope === null) {
      inScope = [...index.byId.values()]
    } else {
      const root = index.byId.get(scope)
      inScope = root ? [root, ...descendants(index, scope)] : []
    }

    const scopeIds = new Set(inScope.map((f) => f.id))
    const term = appliedSearch.trim().toLowerCase()
    const wantActive = status === null ? null : status === 'true'

    const keep = new Set<number>()
    for (const family of inScope) {
      const matchesTerm =
        term === '' ||
        family.familyCode.toLowerCase().includes(term) ||
        family.familyName.toLowerCase().includes(term)
      const matchesStatus = wantActive === null || family.isActive === wantActive
      if (!matchesTerm || !matchesStatus) continue

      keep.add(family.id)
      // Keep the path down to the match, clipped at the scope so the Family filter still shows
      // only that family's subtree.
      for (const parent of ancestors(index, family.id)) {
        if (!scopeIds.has(parent.id)) break
        keep.add(parent.id)
      }
    }

    // A filtered tree is always fully open: a match hidden inside a collapsed parent would read
    // as no match at all.
    return flattenTree(index, () => true, keep)
  }, [index, filtering, expanded, appliedSearch, status, scopeId])

  /**
   * A row is drawn open when its children are actually on screen. Reading it back from the rows
   * rather than from `expanded` keeps the chevron honest while a filter forces the tree open.
   */
  const shownIds = useMemo(() => new Set(visibleRows.map((f) => f.id)), [visibleRows])
  const isOpen = useCallback(
    (family: ItemFamilyDto) => childrenOf(index, family.id).some((child) => shownIds.has(child.id)),
    [index, shownIds],
  )

  const familyOptions = useMemo(
    () =>
      flattenTree(index, () => true).map((f) => ({ value: String(f.id), label: parentOptionLabel(f) })),
    [index],
  )

  function toggleRow(id: number) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function expandAll() {
    setExpanded(new Set(families.filter((f) => f.childCount > 0).map((f) => f.id)))
  }

  function collapseAll() {
    setExpanded(new Set())
  }

  function clearFilters() {
    setSearch('')
    setFlushedSearch('')
    setStatus(null)
    setScopeId(null)
  }

  async function afterChange(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  /** Sends the status change and reports whatever the API objects to (PARENT_INACTIVE above all). */
  async function applyStatus(family: ItemFamilyDto, isActive: boolean) {
    try {
      await itemFamiliesApi.setStatus(family.id, isActive)
      await afterChange(isActive ? 'Item family activated.' : 'Item family deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? err.messages.join(' ') : 'The item family could not be updated.')
      if (err instanceof ApiError && err.code === 'CONCURRENCY') await load()
    }
  }

  async function handleToggleStatus(family: ItemFamilyDto) {
    if (!family.isActive) {
      // Activating touches only this family; an inactive parent is refused by the API.
      await applyStatus(family, true)
      return
    }

    const count = descendants(index, family.id).length
    const confirmed = await confirm({
      title: 'Deactivate item family',
      message:
        count > 0
          ? `Deactivating ${family.familyName} also deactivates its ${count} ${count === 1 ? 'sub-family' : 'sub-families'}. Continue?`
          : `Deactivate ${family.familyCode} - ${family.familyName}?`,
      confirmLabel: 'Deactivate',
    })
    if (confirmed) await applyStatus(family, false)
  }

  async function handleDelete(family: ItemFamilyDto) {
    const confirmed = await confirm({
      title: 'Delete item family',
      message: `Delete ${family.familyCode} - ${family.familyName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await itemFamiliesApi.remove(family.id)
      await afterChange('Item family deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'HAS_CHILDREN' || err.code === 'REFERENCED')) {
        const deactivate = await confirm({
          title: 'Item family cannot be deleted',
          message: CANNOT_DELETE,
          confirmLabel: 'Deactivate instead',
        })
        // They have just chosen to deactivate, so the cascade question is not asked a second time.
        if (deactivate) await applyStatus(family, false)
        return
      }
      notify.error(err instanceof ApiError ? err.messages.join(' ') : 'The item family could not be deleted.')
    }
  }

  const columns: DataTableColumn<ItemFamilyDto>[] = [
    {
      accessor: 'familyCode',
      title: 'Family Code',
      // Wide enough that a level-4 code still clears its indent before the column ends.
      width: 280,
      render: (family) => {
        const open = isOpen(family)
        const hasChildren = family.childCount > 0

        return (
          <Group gap={6} wrap="nowrap" style={{ paddingLeft: family.level * INDENT }}>
            {hasChildren ? (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={`${open ? 'Collapse' : 'Expand'} ${family.familyName}`}
                onClick={() => toggleRow(family.id)}
              >
                {open ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
              </ActionIcon>
            ) : (
              // Keeps every code on the same left edge, chevron or not.
              <Box w={26} />
            )}

            {open ? (
              <IconFolderOpen size={17} color="var(--mantine-color-brand-6)" />
            ) : (
              <IconFolder size={17} color={hasChildren ? 'var(--mantine-color-brand-6)' : 'var(--mantine-color-gray-5)'} />
            )}

            <Text fz="sm" fw={hasChildren ? 600 : 400}>
              {family.familyCode}
            </Text>
          </Group>
        )
      },
    },
    { accessor: 'familyName', title: 'Family Name', width: 180, ellipsis: true },
    {
      accessor: 'parentId',
      title: 'Parent Family',
      width: 150,
      ellipsis: true,
      render: (family) =>
        family.parentId === null ? (
          <Text c="dimmed">—</Text>
        ) : (
          (index.byId.get(family.parentId)?.familyName ?? <Text c="dimmed">—</Text>)
        ),
    },
    {
      accessor: 'description',
      title: 'Description',
      // No width: it takes whatever the fixed columns leave, so the grid fits a laptop.
      render: (family) =>
        family.description ? (
          <Tooltip label={family.description} multiline w={300} withArrow position="top-start">
            <Text fz="sm" lineClamp={1}>
              {family.description}
            </Text>
          </Tooltip>
        ) : (
          <Text c="dimmed">—</Text>
        ),
    },
    { accessor: 'childCount', title: 'Children', width: 90, textAlign: 'right' },
    {
      accessor: 'isActive',
      title: 'Status',
      width: 110,
      render: (family) => <StatusBadge active={family.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 140,
      textAlign: 'right',
      render: (family) => (
        <RowActions
          label={family.familyCode}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', family }) }}
          toggleStatus={{
            visible: canEdit,
            active: family.isActive,
            onClick: () => void handleToggleStatus(family),
          }}
          custom={[
            {
              visible: canCreate,
              icon: <IconPlus size={17} />,
              tooltip: 'Add child family',
              color: 'teal',
              onClick: () => setDialog({ kind: 'create', parentId: family.id }),
            },
          ]}
          remove={{ visible: canDelete, onClick: () => void handleDelete(family) }}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Item Families"
        subtitle="View and manage item families in a hierarchical structure."
        actions={
          <>
            <MoreActionsMenu
              actions={[
                { label: 'Expand All', icon: <IconFoldDown size={16} />, onClick: expandAll },
                { label: 'Collapse All', icon: <IconFoldUp size={16} />, onClick: collapseAll },
              ]}
            />
            {canCreate ? (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create', parentId: null })}>
                New Family
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <TextInput
            placeholder="Search by family code or name..."
            leftSection={<IconSearch size={16} />}
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            // Enter applies what is typed now instead of waiting out the debounce.
            onKeyDown={(e) => {
              if (e.key === 'Enter') setFlushedSearch(search)
            }}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            label="Status"
            placeholder="All"
            data={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={3}>
          <Select
            label="Family"
            placeholder="All families"
            data={familyOptions}
            value={scopeId}
            onChange={setScopeId}
            searchable
            clearable
            nothingFoundMessage="No family matches that."
          />
        </FilterBar.Col>

        <FilterBar.Col span={3}>
          <Button
            variant="default"
            leftSection={<IconFilterOff size={16} />}
            onClick={clearFilters}
            disabled={!filtering}
          >
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load item families">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        {/* No paging: a page break would cut a parent from its children and page 2 would be a
            list of orphans. The whole tree is here, and the filters narrow it in the browser. */}
        <DataTable<ItemFamilyDto>
          storeKey="masterdata.itemFamilies"
          records={visibleRows}
          columns={columns}
          idAccessor="id"
          fetching={loading}
          // Enter on the selected row does what its pencil does.
          onRowActivate={canEdit ? ({ record }) => setDialog({ kind: 'edit', family: record }) : undefined}
          noRecordsText={
            filtering
              ? 'No item family matches the filters. Try clearing them to see the whole tree.'
              : 'No item families yet.'
          }
        />
      </Paper>

      {dialog ? (
        <ItemFamilyFormModal
          mode={dialog.kind}
          family={dialog.kind === 'edit' ? dialog.family : undefined}
          initialParentId={dialog.kind === 'create' ? dialog.parentId : undefined}
          families={families}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterChange(
              dialog.kind === 'create' ? 'Item family created successfully.' : 'Item family updated successfully.',
            )
          }
          onStale={() => {
            setDialog(null)
            void load()
          }}
        />
      ) : null}
    </>
  )
}

const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
]

/** null when nothing has been stored yet, so the first load can open the roots instead. */
function readExpanded(): Set<number> | null {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return new Set(parsed.filter((id): id is number => typeof id === 'number'))
  } catch {
    // A browser that refuses storage still gets a working tree, just a forgetful one.
    return null
  }
}

function writeExpanded(ids: Set<number>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]))
  } catch {
    // Nothing to do: the expansion simply will not survive the next reload.
  }
}

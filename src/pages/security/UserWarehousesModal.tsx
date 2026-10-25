import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Checkbox,
  Collapse,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { UserDto, UserWarehousesDto, WarehouseLookupDto } from '../../api/types'
import { usersApi } from '../../api/users'
import { formatDateTime, formatNumber } from '../../components/format'
import { FormModal } from '../../components/ui/FormModal'

interface UserWarehousesModalProps {
  user: UserDto
  onClose(): void
  /** Saved: the page says so, closes the dialog and reads the list again. */
  onSaved(): void
}

/** One row of the tree: a warehouse, how deep it stands, and the ticked warehouse above it that already gives it. */
interface TreeRow {
  warehouse: WarehouseLookupDto
  depth: number
  isParent: boolean
  /** The highest ticked warehouse above it: then it is ticked and disabled "through {code}". */
  through: WarehouseLookupDto | null
}

/**
 * THE WAREHOUSES OF ONE USER (script 92, the Users page's "Warehouses" action): where they may MOVE stock - post, cancel
 * and delete documents, receive goods, dispatch and receive transfers, set stock levels. Viewing is never limited.
 *
 * ALL WAREHOUSES OR ONLY THESE. "All warehouses" (every user until an administrator restricts one) includes those added
 * later. Off, a tree of ticks by branch: A TICKED PARENT GIVES ITS WHOLE TREE, also the warehouses added under it later,
 * so the rows under it show ticked and disabled "through {parent}". None ticked is allowed, with a warning: the user then
 * moves stock nowhere (an accountant who must never move stock).
 *
 * THE SERVER DECIDES AND KEEPS THE HISTORY. Saving sends the switch and the ticks; the database drops a tick a ticked
 * parent already covers, refuses an unknown or On the way warehouse with its sentence (shown as it comes), and writes
 * one history row per change ("All warehouses" → "Only: LKS-01"). No row version: the last save wins, and the history
 * shows both. A system administrator uses every warehouse whatever is set here; the dialog says so.
 */
export function UserWarehousesModal({ user, onClose, onSaved }: UserWarehousesModalProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const [data, setData] = useState<UserWarehousesDto | null>(null)
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [all, setAll] = useState(true)
  const [ticked, setTicked] = useState<Set<number>>(() => new Set())
  const [search, setSearch] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([usersApi.getWarehouses(user.id), warehousesApi.lookup(false)])
      .then(([answer, rows]) => {
        if (cancelled) return
        setData(answer)
        // Every warehouse, active or not, never an On the way one (nobody's, never ticked).
        setWarehouses(rows.filter((w) => w.isTransit !== true))
        setAll(answer.allWarehouses)
        setTicked(new Set(answer.warehouses.map((w) => w.id)))
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.messages.join(' ') : 'The warehouses could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [user.id])

  const fullName = data?.fullName || user.fullName || user.username
  const lookup = useMemo(() => warehouses ?? [], [warehouses])
  const byId = useMemo(() => new Map(lookup.map((w) => [w.id, w])), [lookup])

  /** The warehouses above one (nearest first), a cycle left by old data cut off. */
  const ancestorsOf = useMemo(() => {
    return (w: WarehouseLookupDto): WarehouseLookupDto[] => {
      const list: WarehouseLookupDto[] = []
      const seen = new Set<number>([w.id])
      let parentId = w.parentId
      while (parentId !== null && !seen.has(parentId)) {
        seen.add(parentId)
        const parent = byId.get(parentId)
        if (!parent) break
        list.push(parent)
        parentId = parent.parentId
      }
      return list
    }
  }, [byId])

  /* THE TREE, BY BRANCH: each branch's warehouses in tree order (a parent, then the warehouses under it), indented by
     their depth. A warehouse whose parent is of another branch starts its own branch's tree. */
  const groups = useMemo(() => {
    const children = new Map<number | null, WarehouseLookupDto[]>()
    for (const w of lookup) {
      const parentKey = w.parentId !== null && byId.has(w.parentId) ? w.parentId : null
      const list = children.get(parentKey) ?? []
      list.push(w)
      children.set(parentKey, list)
    }
    for (const list of children.values()) list.sort((a, b) => a.warehouseCode.localeCompare(b.warehouseCode))

    const ordered: { warehouse: WarehouseLookupDto; depth: number }[] = []
    const visited = new Set<number>()
    const walk = (w: WarehouseLookupDto, depth: number) => {
      if (visited.has(w.id)) return
      visited.add(w.id)
      ordered.push({ warehouse: w, depth })
      // A child of another branch starts its own branch's tree at depth 0: indented here it would look given by a
      // parent it is not drawn under.
      for (const child of children.get(w.id) ?? []) walk(child, child.branchId === w.branchId ? depth + 1 : 0)
    }
    for (const root of children.get(null) ?? []) walk(root, 0)
    for (const w of lookup) walk(w, 0) // a cycle left by old data: still listed

    const byBranch = new Map<number, { branchId: number; title: string; branchName: string; rows: { warehouse: WarehouseLookupDto; depth: number }[] }>()
    for (const entry of ordered) {
      const w = entry.warehouse
      const group = byBranch.get(w.branchId) ?? { branchId: w.branchId, title: `${w.branchCode} - ${w.branchName}`, branchName: w.branchName, rows: [] }
      group.rows.push(entry)
      byBranch.set(w.branchId, group)
    }
    return [...byBranch.values()].sort((a, b) => a.branchName.localeCompare(b.branchName))
  }, [lookup, byId])

  /** The highest ticked warehouse above `w`: what gives it when `w` itself is under a ticked parent. */
  const throughOf = (w: WarehouseLookupDto): WarehouseLookupDto | null => {
    let through: WarehouseLookupDto | null = null
    for (const ancestor of ancestorsOf(w)) if (ticked.has(ancestor.id)) through = ancestor
    return through
  }

  /* WHAT IS SAVED: the ticks no ticked parent covers (the server drops the others too). */
  const stored = [...ticked].filter((id) => {
    const w = byId.get(id)
    return w === undefined || throughOf(w) === null
  })
  /* The warehouses at the bottom of the tree the ticks give (inactive ones too, as the server counts them). */
  const covered = lookup.filter((w) => w.childCount === 0 && (ticked.has(w.id) || throughOf(w) !== null)).length
  const unchanged =
    data !== null &&
    all === data.allWarehouses &&
    stored.length === data.warehouses.length &&
    data.warehouses.every((w) => stored.includes(w.id))
  const usable = unchanged && data ? data.usableCount : covered

  /* The search narrows the tree to the warehouses whose code or name matches, each with the warehouses above it. */
  const term = search.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!term) return null
    const ids = new Set<number>()
    for (const w of lookup) {
      if (!`${w.warehouseCode} ${w.warehouseName}`.toLowerCase().includes(term)) continue
      ids.add(w.id)
      for (const ancestor of ancestorsOf(w)) ids.add(ancestor.id)
    }
    return ids
  }, [term, lookup, ancestorsOf])

  function toggle(id: number, on: boolean) {
    setError(null)
    setTicked((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function save() {
    if (saving || data === null) return
    setSaving(true)
    setError(null)
    try {
      await usersApi.setWarehouses(user.id, { allWarehouses: all, warehouseIds: all ? [] : stored })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The warehouses could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const history = data?.history ?? []

  const treeRow = ({ warehouse: w, depth }: { warehouse: WarehouseLookupDto; depth: number }) => {
    const row: TreeRow = { warehouse: w, depth, isParent: w.childCount > 0, through: throughOf(w) }
    return (
      <Box key={w.id} pl={row.depth * 20} py={2} data-user-warehouse={w.warehouseCode}>
        <Checkbox
          checked={row.through !== null || ticked.has(w.id)}
          disabled={row.through !== null || saving}
          onChange={(event) => toggle(w.id, event.currentTarget.checked)}
          label={
            <Text span fz="sm" style={{ overflowWrap: 'anywhere' }}>
              {w.warehouseCode} - {w.warehouseName}
              {!w.isActive ? (
                <Text span fz="sm" c="dimmed">
                  {' '}
                  (inactive)
                </Text>
              ) : null}
              {row.isParent ? (
                <Text span fz="sm" c="dimmed">
                  {' '}
                  (and the warehouses under it)
                </Text>
              ) : null}
              {row.through !== null ? (
                // Kept on one line: a phone broke the code at its hyphen ("through TEST92-" / "G").
                <Text span fz="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {' '}
                  through {row.through.warehouseCode}
                </Text>
              ) : null}
            </Text>
          }
        />
      </Box>
    )
  }

  const loaded = data !== null && warehouses !== null
  /* THE CURSOR STARTS IN THE FIRST FIELD (the conventions): FormModal picks it when the form mounts, but the dialog then
     shows only the Loader - the switch comes with the two answers, so it takes the focus once they are in. */
  const allRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (loaded) allRef.current?.focus()
  }, [loaded])
  const tree = (
    <Stack gap="sm">
      {groups.map((group) => {
        const rows = visible === null ? group.rows : group.rows.filter((r) => visible.has(r.warehouse.id))
        if (rows.length === 0) return null
        const titleId = `uw-branch-${group.branchId}`
        return (
          <Box key={group.title} role="group" aria-labelledby={titleId}>
            <Text fz="sm" fw={600} mb={4} id={titleId}>
              {group.title}
            </Text>
            {rows.map(treeRow)}
          </Box>
        )
      })}
      {visible !== null && visible.size === 0 ? (
        <Text fz="sm" c="dimmed">
          No warehouse matches.
        </Text>
      ) : null}
    </Stack>
  )

  return (
    <FormModal
      opened
      title={`Warehouses of ${user.username}`}
      size="lg"
      fullScreen={phone}
      saving={saving}
      saveDisabled={!loaded}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <Text fz="sm" c="dimmed">
        Where {fullName} may move stock: post, cancel and delete documents, receive goods, dispatch and receive transfers,
        set stock levels. Every document stays visible to them.
      </Text>

      {loadError ? <Alert color="red">{loadError}</Alert> : null}

      {!loaded && !loadError ? (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      ) : null}

      {loaded && data.isSystemAdministrator ? (
        <Alert color="blue" data-user-warehouses-admin>
          {fullName} is a system administrator: system administrators use every warehouse, whatever is set here. This
          setting applies if the Admin role is taken away.
        </Alert>
      ) : null}

      {loaded ? (
        <Switch
          ref={allRef}
          label="All warehouses"
          description="Every warehouse, including those added later."
          checked={all}
          disabled={saving}
          onChange={(event) => {
            setError(null)
            setAll(event.currentTarget.checked)
          }}
          data-user-warehouses-all
        />
      ) : null}

      {loaded && !all ? (
        <>
          <TextInput
            label="Search warehouses"
            placeholder="Code or name"
            leftSection={<IconSearch size={16} />}
            value={search}
            // The tree narrows as it is typed; Enter saves the dialog, as in every dialog (the conventions).
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          {phone ? tree : <ScrollArea.Autosize mah={360} type="auto" offsetScrollbars>{tree}</ScrollArea.Autosize>}
          <Text fz="sm" data-user-warehouses-count>
            {formatNumber(stored.length)} ticked: {fullName} may use {formatNumber(usable)} warehouse{usable === 1 ? '' : 's'}.
          </Text>
          {stored.length === 0 ? (
            <Alert color="orange" data-user-warehouses-none>
              No warehouse ticked: {fullName} will not be able to move stock anywhere.
            </Alert>
          ) : null}
        </>
      ) : null}

      {loaded ? (
        <Box>
          <UnstyledButton
            onClick={() => setHistoryOpen((open) => !open)}
            aria-expanded={historyOpen}
            aria-controls="uw-history"
            type="button"
          >
            <Group gap={4}>
              {historyOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
              <Text fz="sm" fw={600}>
                History ({formatNumber(history.length)})
              </Text>
            </Group>
          </UnstyledButton>
          <Collapse expanded={historyOpen}>
            <Stack gap={4} mt="xs" id="uw-history" data-user-warehouses-history>
              {history.length === 0 ? (
                <Text fz="sm" c="dimmed">
                  No change yet: {fullName} has always used every warehouse.
                </Text>
              ) : (
                history.map((change) => (
                  <Text key={change.id} fz="sm" style={{ overflowWrap: 'anywhere' }}>
                    <Text span fz="sm" c="dimmed">
                      {formatDateTime(change.changedAtUtc)} · {change.changedByName}
                      {' · '}
                    </Text>
                    {change.before} → {change.after}
                  </Text>
                ))
              )}
            </Stack>
          </Collapse>
        </Box>
      ) : null}

      {error ? <Alert color="red">{error}</Alert> : null}
    </FormModal>
  )
}

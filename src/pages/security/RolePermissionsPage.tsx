import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Grid,
  Group,
  Loader,
  NavLink,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useSearchParams } from 'react-router'
import { ApiError } from '../../api/http'
import { permissionsApi } from '../../api/permissions'
import { rolesApi } from '../../api/roles'
import type { PermissionDto, PermissionModuleDto, RoleDetailDto, RoleDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'
import { ROLE_PARAM } from './rolePermissionsRoute'

/**
 * Role Permissions - which permissions a role holds, and nothing else about the role.
 *
 * Split out of the Roles page, where a hundred-odd checkboxes sat under a three-field form. Here the
 * checklist IS the page: pick a role on the left, tick on the right, save.
 *
 * Guards, unchanged from the screen this came from: rolesView opens it (the route), rolesManage may
 * save, and the catalog itself still answers to permissionsView - without it the checklist cannot be
 * listed at all, exactly as before.
 */

function sameSet(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

/** Every permission in the catalog, flattened - the denominator of "12 of 40 selected". */
function countAll(modules: PermissionModuleDto[]): number {
  return modules.reduce((total, module) => total + module.permissions.length, 0)
}

export function RolePermissionsPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSIONS.rolesManage)
  const canSeeCatalog = hasPermission(PERMISSIONS.permissionsView)
  const [searchParams, setSearchParams] = useSearchParams()

  const [roles, setRoles] = useState<RoleDto[]>([])
  const [modules, setModules] = useState<PermissionModuleDto[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<RoleDetailDto | null>(null)
  const [loadingRoles, setLoadingRoles] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  /** The ticks on screen, and the ticks as last loaded or saved - their difference is "unsaved". */
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [baseline, setBaseline] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const dirty = !sameSet(selected, baseline)
  const role = detail

  const loadRoles = useCallback(async () => {
    setLoadingRoles(true)
    try {
      const list = await rolesApi.list()
      setRoles(list)
      setLoadError(null)
      return list
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.messages.join(' ') : 'The roles could not be loaded.')
      return [] as RoleDto[]
    } finally {
      setLoadingRoles(false)
    }
  }, [])

  // The role to open on: the one named in the query string when it exists, else the first.
  useEffect(() => {
    void (async () => {
      const list = await loadRoles()
      const requested = Number(searchParams.get(ROLE_PARAM))
      const wanted = list.find((r) => r.id === requested) ?? list[0]
      // eslint-disable-next-line react/set-state-in-effect
      if (wanted) setSelectedId(wanted.id)
    })()
    // Only on mount: later changes to the parameter come from this page's own clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!canSeeCatalog) return
    void (async () => {
      try {
        // eslint-disable-next-line react/set-state-in-effect
        setModules(await permissionsApi.catalog())
      } catch {
        // The role list still works; only the checklist stays empty.
      }
    })()
  }, [canSeeCatalog])

  /** Load the selected role's permissions, and take them as the new baseline. */
  useEffect(() => {
    if (selectedId === null) return
    let cancelled = false
    setLoadingDetail(true)
    void (async () => {
      try {
        const loaded = await rolesApi.get(selectedId)
        if (cancelled) return
        const ids = new Set(loaded.permissionIds)
        setDetail(loaded)
        setSelected(ids)
        setBaseline(ids)
        setSaveError(null)
      } catch (error) {
        if (cancelled) return
        setDetail(null)
        setLoadError(error instanceof ApiError ? error.messages.join(' ') : 'The role could not be loaded.')
      } finally {
        if (!cancelled) setLoadingDetail(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  /**
   * Closing or reloading the tab with unsaved ticks. In-page navigation is guarded by hand where it
   * happens (choosing another role); this covers the one exit the app never sees.
   */
  useEffect(() => {
    if (!dirty) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** Leaving this role behind. Anything unsaved is offered up before it is lost. */
  async function chooseRole(id: number) {
    if (id === selectedId) return
    if (dirty && role) {
      const discard = await confirm({
        title: 'Unsaved permissions',
        message: `Discard the permission changes for "${role.name}"?`,
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true,
      })
      if (!discard) return
    }
    setSelectedId(id)
    // Keep the address bar on the role being edited, so a reload or a shared link comes back to it.
    setSearchParams({ [ROLE_PARAM]: String(id) }, { replace: true })
  }

  function toggle(id: number, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  /** The module header's checkbox: it acts on exactly the rows the reader can see. */
  function toggleModule(permissions: PermissionDto[], checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const permission of permissions) {
        if (checked) next.add(permission.id)
        else next.delete(permission.id)
      }
      return next
    })
  }

  function reset() {
    setSelected(new Set(baseline))
    setSaveError(null)
  }

  async function save() {
    if (!role) return
    setSaveError(null)
    setSaving(true)
    try {
      await rolesApi.setPermissions(role.id, [...selected])
      setBaseline(new Set(selected))
      notify.success(`Permissions saved for "${role.name}".`)
      // The counts on the left (and on the Roles page) are now stale.
      await loadRoles()
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.messages.join(' ') : 'The permissions could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const isSystem = role?.isSystem ?? false
  const totalPermissions = countAll(modules)
  /** A system role holds everything, whatever the checklist stores. */
  const selectedCount = isSystem ? totalPermissions : selected.size

  /** The catalog narrowed to what matches the filter box - by permission name or code. */
  const visibleModules = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return modules
    return modules
      .map((module) => ({
        ...module,
        permissions: module.permissions.filter(
          (p) => p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle),
        ),
      }))
      .filter((module) => module.permissions.length > 0)
  }, [modules, filter])

  const visibleCount = countAll(visibleModules)

  return (
    <>
      <PageHeader
        title="Role Permissions"
        subtitle="Choose a role, then tick the permissions it grants. Create and rename roles on the Roles page."
      />

      {loadError ? (
        <Alert color="red" mb="md" title="Could not load">
          {loadError}
        </Alert>
      ) : null}

      {/* Two cards side by side on a desktop, stacked below md - the list is a way in, the checklist
          is the work, so the checklist takes the room. */}
      <Grid gap="md" align="flex-start">
        <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
          <Paper radius="lg" p="md" withBorder>
            <Title order={5} mb="sm">
              Roles
            </Title>

            {loadingRoles ? (
              <Group justify="center" py="md">
                <Loader size="sm" />
              </Group>
            ) : roles.length === 0 ? (
              <Text c="dimmed" fz="sm">
                No roles yet.
              </Text>
            ) : (
              <Stack gap={2}>
                {roles.map((r) => (
                  <NavLink
                    key={r.id}
                    active={r.id === selectedId}
                    onClick={() => void chooseRole(r.id)}
                    styles={{ root: { borderRadius: 'var(--mantine-radius-md)' } }}
                    label={
                      <Group gap="xs" wrap="nowrap">
                        <Text fz="sm" fw={600} lineClamp={1}>
                          {r.name}
                        </Text>
                        {r.isSystem ? (
                          <Badge size="xs" variant="light" color="blue">
                            System
                          </Badge>
                        ) : null}
                        {!r.isActive ? (
                          <Badge size="xs" variant="light" color="red">
                            Inactive
                          </Badge>
                        ) : null}
                      </Group>
                    }
                    description={`${r.userCount} user${r.userCount === 1 ? '' : 's'} · ${
                      r.isSystem ? 'all' : r.permissionCount
                    } permission${!r.isSystem && r.permissionCount === 1 ? '' : 's'}`}
                  />
                ))}
              </Stack>
            )}
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
          <Paper radius="lg" p="md" withBorder>
            <Title order={5} mb="sm">
              {role ? `Permissions of ${role.name}` : 'Permissions'}
            </Title>

            {!canSeeCatalog ? (
              <Text c="dimmed" fz="sm">
                The permission catalog is not available to you.
              </Text>
            ) : loadingDetail || !role ? (
              <Group justify="center" py="xl">
                <Loader size="sm" />
              </Group>
            ) : (
              <Stack gap="md">
                {isSystem ? (
                  <Alert color="blue">System roles always hold every permission.</Alert>
                ) : null}

                <Group justify="space-between" align="center" wrap="wrap" gap="sm">
                  <Text fz="sm" c="dimmed">
                    <Text span fw={600} c="var(--mantine-color-text)">
                      {selectedCount}
                    </Text>{' '}
                    of {totalPermissions} selected
                    {filter.trim() ? ` · ${visibleCount} shown` : ''}
                  </Text>
                  <TextInput
                    value={filter}
                    onChange={(event) => setFilter(event.currentTarget.value)}
                    placeholder="Filter by name or code..."
                    leftSection={<IconSearch size={16} />}
                    aria-label="Filter permissions"
                    w={{ base: '100%', xs: 280 }}
                  />
                </Group>

                {modules.length === 0 ? (
                  <Text c="dimmed" fz="sm">
                    The permission catalog is empty.
                  </Text>
                ) : visibleModules.length === 0 ? (
                  <Text c="dimmed" fz="sm">
                    No permission matches &ldquo;{filter.trim()}&rdquo;.
                  </Text>
                ) : (
                  <Stack gap="md">
                    {visibleModules.map((module) => (
                      <ModuleGroup
                        key={module.module}
                        module={module}
                        selected={selected}
                        isSystem={isSystem}
                        readOnly={!canManage || isSystem}
                        onToggle={toggle}
                        onToggleModule={toggleModule}
                      />
                    ))}
                  </Stack>
                )}

                {saveError ? <Alert color="red">{saveError}</Alert> : null}

                {/* No footer at all for a system role (nothing is savable) or a read-only reader. */}
                {canManage && !isSystem ? (
                  <Group justify="flex-end" gap="sm">
                    <Button variant="default" onClick={reset} disabled={!dirty || saving}>
                      Reset
                    </Button>
                    <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
                      Save permissions
                    </Button>
                  </Group>
                ) : null}
              </Stack>
            )}
          </Paper>
        </Grid.Col>
      </Grid>
    </>
  )
}

/**
 * One module's block: a header checkbox that acts on the rows beneath it, then the rows.
 *
 * The header is indeterminate when the module is partly ticked, which is the only way to tell "some
 * of these" from "none of these" at a glance down a page of eight modules. It counts and toggles the
 * VISIBLE rows only, so with a filter on, ticking the header does exactly what the reader can see it
 * doing rather than quietly ticking rows scrolled out of the catalog.
 */
function ModuleGroup({
  module,
  selected,
  isSystem,
  readOnly,
  onToggle,
  onToggleModule,
}: {
  module: PermissionModuleDto
  selected: Set<number>
  isSystem: boolean
  readOnly: boolean
  onToggle(id: number, checked: boolean): void
  onToggleModule(permissions: PermissionDto[], checked: boolean): void
}) {
  const isChecked = (permission: PermissionDto) => isSystem || selected.has(permission.id)
  const checkedCount = module.permissions.filter(isChecked).length
  const all = checkedCount === module.permissions.length
  const some = checkedCount > 0 && !all

  return (
    <Card radius="md" p="sm" withBorder>
      <Checkbox
        checked={all}
        indeterminate={some}
        disabled={readOnly}
        onChange={(event) => {
          // Read the event synchronously: React clears currentTarget before a state updater runs.
          const checked = event.currentTarget.checked
          onToggleModule(module.permissions, checked)
        }}
        label={
          <Group gap="xs" wrap="nowrap">
            <Text fz="sm" fw={700}>
              {module.module}
            </Text>
            <Text fz="xs" c="dimmed">
              {checkedCount}/{module.permissions.length}
            </Text>
          </Group>
        }
      />

      <Stack gap="xs" mt="sm" pl="lg">
        {module.permissions.map((permission) => (
          <Checkbox
            key={permission.id}
            checked={isChecked(permission)}
            disabled={readOnly}
            onChange={(event) => {
              const checked = event.currentTarget.checked
              onToggle(permission.id, checked)
            }}
            label={
              <Stack gap={0}>
                <Text fz="sm" fw={600}>
                  {permission.name} <Code>{permission.code}</Code>
                </Text>
                {permission.description ? (
                  <Text fz="xs" c="dimmed">
                    {permission.description}
                  </Text>
                ) : null}
              </Stack>
            }
          />
        ))}
      </Stack>
    </Card>
  )
}

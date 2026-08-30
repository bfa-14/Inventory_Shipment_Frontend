import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Grid,
  Group,
  NavLink,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPlus } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { permissionsApi } from '../../api/permissions'
import { rolesApi } from '../../api/roles'
import type { PermissionModuleDto, RoleDetailDto, RoleDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { confirm } from '../../components/ui/confirm'
import { FormModal } from '../../components/ui/FormModal'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'

export function RolesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSIONS.rolesManage)

  const [roles, setRoles] = useState<RoleDto[]>([])
  const [modules, setModules] = useState<PermissionModuleDto[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<RoleDetailDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const loadRoles = useCallback(async (selectAfter?: number) => {
    try {
      const list = await rolesApi.list()
      setRoles(list)
      setLoadError(null)
      setSelectedId((current) => selectAfter ?? current ?? list[0]?.id ?? null)
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.messages.join(' ') : 'The roles could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void loadRoles()
  }, [loadRoles])

  // The permission matrix is only fetchable with security.permissions.view.
  useEffect(() => {
    if (!hasPermission(PERMISSIONS.permissionsView)) return
    void (async () => {
      try {
        setModules(await permissionsApi.catalog())
      } catch {
        // The role form still works; only the matrix stays empty.
      }
    })()
  }, [hasPermission])

  useEffect(() => {
    if (selectedId === null) return
    let cancelled = false
    void (async () => {
      try {
        const d = await rolesApi.get(selectedId)
        if (!cancelled) setDetail(d)
      } catch {
        if (!cancelled) setDetail(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  async function reload(selectAfter?: number) {
    await loadRoles(selectAfter)
    if (selectedId !== null) {
      try {
        setDetail(await rolesApi.get(selectAfter ?? selectedId))
      } catch {
        setDetail(null)
      }
    }
  }

  async function handleDelete(role: RoleDetailDto) {
    const confirmed = await confirm({
      title: 'Delete role',
      message: `Delete the role "${role.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await rolesApi.remove(role.id)
      notify.success('Role deleted.')
      setSelectedId(null)
      setDetail(null)
      await loadRoles()
    } catch (error) {
      notify.error(error instanceof ApiError ? (error.messages[0] as string) : 'The role could not be deleted.')
    }
  }

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="A role is a named bundle of permissions. Assign roles to users on the Users page."
        actions={
          canManage ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
              New role
            </Button>
          ) : null
        }
      />

      {loadError ? (
        <Alert color="red" mb="md" title="Could not load roles">
          {loadError}
        </Alert>
      ) : null}

      <Grid gap="md" align="flex-start">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Paper radius="lg" p="md" withBorder>
            <Title order={5} mb="sm">
              All roles
            </Title>
            {loading ? (
              <Text c="dimmed" fz="sm">
                Loading...
              </Text>
            ) : (
              <Stack gap={2}>
                {roles.map((role) => (
                  <NavLink
                    key={role.id}
                    active={role.id === selectedId}
                    onClick={() => setSelectedId(role.id)}
                    styles={{ root: { borderRadius: 'var(--mantine-radius-md)' } }}
                    label={
                      <Group gap="xs">
                        {role.name}
                        {role.isSystem ? (
                          <Badge size="xs" variant="light" color="blue">
                            System
                          </Badge>
                        ) : null}
                        {!role.isActive ? (
                          <Badge size="xs" variant="light" color="red">
                            Inactive
                          </Badge>
                        ) : null}
                      </Group>
                    }
                    description={`${role.userCount} user${role.userCount === 1 ? '' : 's'} · ${role.permissionCount} permission${role.permissionCount === 1 ? '' : 's'}`}
                  />
                ))}
              </Stack>
            )}
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          {detail ? (
            <RoleDetail
              key={detail.id}
              role={detail}
              modules={modules}
              canManage={canManage}
              onSaved={async (message) => {
                notify.success(message)
                await reload()
              }}
              onRequestDelete={() => void handleDelete(detail)}
            />
          ) : (
            <Paper radius="lg" p="lg" withBorder>
              <Text c="dimmed">Select a role to see its permissions.</Text>
            </Paper>
          )}
        </Grid.Col>
      </Grid>

      {creating ? (
        <CreateRoleDialog
          modules={modules}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false)
            notify.success('Role created.')
            await reload(id)
          }}
        />
      ) : null}
    </>
  )
}

function RoleDetail({
  role,
  modules,
  canManage,
  onSaved,
  onRequestDelete,
}: {
  role: RoleDetailDto
  modules: PermissionModuleDto[]
  canManage: boolean
  onSaved(message: string): Promise<void>
  onRequestDelete(): void
}) {
  const [selected, setSelected] = useState<string[]>(role.permissionIds.map(String))
  const [formError, setFormError] = useState<string | null>(null)
  const [permError, setPermError] = useState<string | null>(null)
  const [savingForm, setSavingForm] = useState(false)
  const [savingPerms, setSavingPerms] = useState(false)

  const form = useForm({
    initialValues: { name: role.name, description: role.description ?? '', isActive: role.isActive },
    validate: { name: (v) => (v.trim() ? null : 'Name is required.') },
  })

  const deleteBlocked = role.isSystem || role.userCount > 0
  const deleteReason = role.isSystem
    ? 'A system role cannot be deleted.'
    : role.userCount > 0
      ? 'Remove the role from its users first.'
      : undefined

  async function handleSaveForm(values: typeof form.values) {
    setFormError(null)
    setSavingForm(true)
    try {
      await rolesApi.update(role.id, {
        name: values.name.trim(),
        description: values.description.trim() || null,
        isActive: values.isActive,
      })
      await onSaved('Role saved.')
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The role could not be saved.')
    } finally {
      setSavingForm(false)
    }
  }

  async function handleSavePermissions() {
    setPermError(null)
    setSavingPerms(true)
    try {
      await rolesApi.setPermissions(role.id, selected.map(Number))
      await onSaved('Permissions saved.')
    } catch (error) {
      setPermError(error instanceof ApiError ? error.messages.join(' ') : 'The permissions could not be saved.')
    } finally {
      setSavingPerms(false)
    }
  }

  return (
    <Stack gap="md">
      <Paper radius="lg" p="lg" withBorder>
        <Title order={5} mb="md">
          {role.name}
        </Title>
        <form onSubmit={form.onSubmit((values) => void handleSaveForm(values))} noValidate>
          <Stack gap="md">
            <TextInput
              label="Name"
              withAsterisk
              readOnly={role.isSystem}
              disabled={!canManage}
              {...form.getInputProps('name')}
            />
            <TextInput label="Description" disabled={!canManage} {...form.getInputProps('description')} />
            <Switch
              label="Active"
              disabled={!canManage || role.isSystem}
              {...form.getInputProps('isActive', { type: 'checkbox' })}
            />

            {formError ? <Alert color="red">{formError}</Alert> : null}

            {canManage ? (
              <Group>
                <Button type="submit" loading={savingForm}>
                  Save
                </Button>
                <Button color="red" variant="light" onClick={onRequestDelete} disabled={deleteBlocked} title={deleteReason}>
                  Delete role
                </Button>
              </Group>
            ) : null}
          </Stack>
        </form>
      </Paper>

      <Paper radius="lg" p="lg" withBorder>
        <Title order={5} mb="sm">
          Permissions
        </Title>
        {role.isSystem ? (
          <Alert color="blue" mb="md">
            System roles always hold every permission.
          </Alert>
        ) : null}

        {modules.length === 0 ? (
          <Text c="dimmed" fz="sm">
            The permission catalog is not available to you.
          </Text>
        ) : (
          <Checkbox.Group value={role.isSystem ? modules.flatMap((m) => m.permissions.map((p) => String(p.id))) : selected} onChange={setSelected}>
            <Stack gap="lg">
              {modules.map((module) => {
                const ids = module.permissions.map((p) => String(p.id))
                const allSelected = ids.every((id) => role.isSystem || selected.includes(id))
                return (
                  <Stack key={module.module} gap="xs">
                    <Group justify="space-between">
                      <Title order={6}>{module.module}</Title>
                      {canManage && !role.isSystem ? (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          onClick={() =>
                            setSelected((current) =>
                              allSelected
                                ? current.filter((id) => !ids.includes(id))
                                : [...new Set([...current, ...ids])],
                            )
                          }
                        >
                          {allSelected ? 'Clear all' : 'Select all'}
                        </Button>
                      ) : null}
                    </Group>

                    <Stack gap="xs">
                      {module.permissions.map((p) => (
                        <Checkbox
                          key={p.id}
                          value={String(p.id)}
                          disabled={role.isSystem || !canManage}
                          label={
                            <Stack gap={0}>
                              <Text fz="sm" fw={600}>
                                {p.name} <Code>{p.code}</Code>
                              </Text>
                              {p.description ? (
                                <Text fz="xs" c="dimmed">
                                  {p.description}
                                </Text>
                              ) : null}
                            </Stack>
                          }
                        />
                      ))}
                    </Stack>
                  </Stack>
                )
              })}
            </Stack>
          </Checkbox.Group>
        )}

        {permError ? (
          <Alert color="red" mt="md">
            {permError}
          </Alert>
        ) : null}

        {canManage && !role.isSystem && modules.length > 0 ? (
          <Group mt="md">
            <Button loading={savingPerms} onClick={() => void handleSavePermissions()}>
              Save permissions
            </Button>
          </Group>
        ) : null}
      </Paper>
    </Stack>
  )
}

function CreateRoleDialog({
  modules,
  onClose,
  onCreated,
}: {
  modules: PermissionModuleDto[]
  onClose(): void
  onCreated(id: number): void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const form = useForm({
    initialValues: { name: '', description: '' },
    validate: { name: (v) => (v.trim() ? null : 'Name is required.') },
  })

  async function submit(values: typeof form.values) {
    setError(null)
    setBusy(true)
    try {
      const created = await rolesApi.create({
        name: values.name.trim(),
        description: values.description.trim() || null,
        permissionIds: selected.map(Number),
      })
      onCreated(created.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The role could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormModal
      opened
      title="New role"
      saveLabel="Create role"
      saving={busy}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void submit(values))()}
    >
      <TextInput label="Name" withAsterisk {...form.getInputProps('name')} />
      <TextInput label="Description" {...form.getInputProps('description')} />

      {modules.length === 0 ? (
        <Text c="dimmed" fz="sm">
          The permission catalog is not available to you.
        </Text>
      ) : (
        <Checkbox.Group label="Permissions" value={selected} onChange={setSelected}>
          <Stack gap="lg" mt="xs">
            {modules.map((module) => (
              <Stack key={module.module} gap="xs">
                <Title order={6}>{module.module}</Title>
                {module.permissions.map((p) => (
                  <Checkbox
                    key={p.id}
                    value={String(p.id)}
                    label={
                      <Text fz="sm">
                        {p.name} <Code>{p.code}</Code>
                      </Text>
                    }
                  />
                ))}
              </Stack>
            ))}
          </Stack>
        </Checkbox.Group>
      )}

      {error ? <Alert color="red">{error}</Alert> : null}
    </FormModal>
  )
}

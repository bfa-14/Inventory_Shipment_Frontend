import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Group, Paper, Switch, Text, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPlus, IconShieldCheck } from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import { ApiError } from '../../api/http'
import { rolesApi } from '../../api/roles'
import type { RoleDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FormModal } from '../../components/ui/FormModal'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { PERMISSIONS } from '../../navigation'
import { rolePermissionsRoute } from './rolePermissionsRoute'

/**
 * Roles - the DEFINITION of a role only.
 *
 * What a role IS (name, description, active) lives here; what it may DO lives on Role Permissions.
 * The two were one screen, which read as a long form whose most important control - a hundred-odd
 * checkboxes - sat below a three-field form you had to scroll past to reach it.
 */

/**
 * What each column IS, for the grid engine: its kind (so a number compares as a number and a date
 * as a date), and what it shows. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<RoleDto>[] = [
  { accessor: 'name', summary: 'count' },
  { accessor: 'description', text: (r) => r.description ?? '' },
  { accessor: 'userCount', kind: 'number', text: (r) => String(r.userCount) },
  // 'All' rather than the stored number, because that is what the cell shows for a system role -
  // the filter has to match what is read, not what is behind it.
  { accessor: 'permissionCount', text: (r) => (r.isSystem ? 'All' : String(r.permissionCount)) },
  { accessor: 'isActive', kind: 'boolean', text: (r) => (r.isActive ? 'Active' : 'Inactive') },
]

type Dialog = { kind: 'create' } | { kind: 'edit'; role: RoleDto } | null

export function RolesPage() {
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const canManage = hasPermission(PERMISSIONS.rolesManage)

  const [roles, setRoles] = useState<RoleDto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  /* THE ENGINE HOLDS THE WHOLE LIST AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column sort,
     paging, footer totals over all the filtered rows, CSV. */
  const engine = useDataGrid({
    rows: roles,
    columns: GRID_COLUMNS,
    storeKey: 'security.roles',
    sort: [{ accessor: 'name', direction: 'asc' }],
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRoles(await rolesApi.list())
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.messages.join(' ') : 'The roles could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  async function handleDelete(role: RoleDto) {
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
      await load()
    } catch (error) {
      notify.error(error instanceof ApiError ? (error.messages[0] as string) : 'The role could not be deleted.')
    }
  }

  /**
   * A new role holds nothing, so the one thing its author almost certainly wants next is the other
   * page. Offered rather than forced - the answer is sometimes "later".
   */
  async function offerPermissions(id: number, name: string) {
    const go = await confirm({
      title: 'Assign permissions?',
      message: `"${name}" has no permissions yet, so nobody holding it can do anything. Assign them now?`,
      confirmLabel: 'Assign permissions',
      cancelLabel: 'Not now',
    })
    if (go) navigate(rolePermissionsRoute(id))
  }

  const columns: DataTableColumn<RoleDto>[] = [
    rowNumberColumn<RoleDto>(engine.page, engine.pageSize),
    {
      accessor: 'name',
      title: 'Role name',
      width: 250,
      render: (role) => (
        <Group gap="xs" wrap="nowrap">
          <Text fz="sm" fw={600}>
            {role.name}
          </Text>
          {role.isSystem ? (
            <Badge size="xs" variant="light" color="blue">
              System
            </Badge>
          ) : null}
        </Group>
      ),
    },
    {
      accessor: 'description',
      title: 'Description',
      // No tick list: a description is prose, one string per role, so the box is the control that helps.
      render: (role) => role.description ?? '-',
    },
    {
      accessor: 'userCount',
      title: 'Users',
      width: 110,
      textAlign: 'right',
    },
    {
      accessor: 'permissionCount',
      title: 'Permissions',
      width: 140,
      textAlign: 'right',
      // A system role's stored count says nothing: it holds everything by definition.
      render: (role) =>
        role.isSystem ? (
          <Text fz="sm" c="dimmed">
            All
          </Text>
        ) : (
          role.permissionCount
        ),
    },
    {
      accessor: 'isActive',
      title: 'Status',
      width: 150,
      render: (role) => <StatusBadge active={role.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 150,
      textAlign: 'right',
      render: (role) => (
        <RowActions
          label={role.name}
          edit={{ visible: canManage, onClick: () => setDialog({ kind: 'edit', role }) }}
          // Visible to a reader without rolesManage too: the other page opens read-only for them,
          // which is the same trust the route itself grants.
          custom={[
            {
              icon: <IconShieldCheck size={17} />,
              tooltip: 'Assign permissions',
              color: 'grape',
              onClick: () => navigate(rolePermissionsRoute(role.id)),
            },
          ]}
          remove={{
            visible: canManage,
            disabled: role.isSystem || role.userCount > 0,
            disabledReason: role.isSystem
              ? 'A system role cannot be deleted.'
              : 'Remove the role from its users first.',
            onClick: () => void handleDelete(role),
          }}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="A role is a named bundle of permissions. Assign roles to users on the Users page; assign permissions on the Role Permissions page."
        actions={
          canManage ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
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

      <Paper radius="lg" p="md" withBorder>
        <DataTable<RoleDto>
          storeKey="security.roles"
          engine={engine}
          exportFileName="roles"
          columns={columns}
          fetching={loading}
          // Enter on the selected row does what its pencil does.
          onRowActivate={canManage ? ({ record }) => setDialog({ kind: 'edit', role: record }) : undefined}
          noRecordsText={roles.length === 0 ? 'No roles yet.' : 'No role matches your filters.'}
        />
      </Paper>

      {dialog ? (
        <RoleFormModal
          mode={dialog.kind}
          role={dialog.kind === 'edit' ? dialog.role : undefined}
          onClose={() => setDialog(null)}
          onSaved={async (created) => {
            setDialog(null)
            await load()
            if (created) {
              notify.success(`Role "${created.name}" created.`)
              await offerPermissions(created.id, created.name)
            } else {
              notify.success('Role saved.')
            }
          }}
        />
      ) : null}
    </>
  )
}

/**
 * New / edit a role: the three fields the old inline form carried, and nothing else. Permissions
 * moved out, so a role is created empty and its author is offered the other page straight after.
 */
function RoleFormModal({
  mode,
  role,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  role?: RoleDto
  onClose(): void
  /** Given the created role on create, null on edit. */
  onSaved(created: { id: number; name: string } | null): void
}) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isSystem = role?.isSystem ?? false

  const form = useForm({
    initialValues: {
      name: role?.name ?? '',
      description: role?.description ?? '',
      isActive: role?.isActive ?? true,
    },
    validate: { name: (value) => (value.trim() ? null : 'Name is required.') },
  })

  async function submit(values: typeof form.values) {
    setError(null)
    setSaving(true)
    try {
      if (mode === 'create') {
        const created = await rolesApi.create({
          name: values.name.trim(),
          description: values.description.trim() || null,
          // Empty on purpose: filling this is the Role Permissions page's job now.
          permissionIds: [],
        })
        onSaved({ id: created.id, name: created.name })
      } else if (role) {
        await rolesApi.update(role.id, {
          name: values.name.trim(),
          description: values.description.trim() || null,
          isActive: values.isActive,
        })
        onSaved(null)
      }
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length > 0) {
        form.setErrors(
          Object.fromEntries(Object.entries(err.fieldErrors).map(([field, messages]) => [field, messages.join(' ')])),
        )
      } else {
        setError(err instanceof ApiError ? err.messages.join(' ') : 'The role could not be saved.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New role' : `Edit ${role?.name ?? 'role'}`}
      saveLabel={mode === 'create' ? 'Create role' : 'Save'}
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void submit(values))()}
    >
      <TextInput
        label="Name"
        withAsterisk
        readOnly={isSystem}
        description={isSystem ? 'A system role cannot be renamed.' : undefined}
        {...form.getInputProps('name')}
      />
      <Textarea label="Description" autosize minRows={3} {...form.getInputProps('description')} />

      {/* No Active field on create: the API's create request carries none. A new role is active, and
          switching it off is an edit. */}
      {mode === 'edit' ? (
        <Switch
          label="Active"
          disabled={isSystem}
          description={isSystem ? 'A system role is always active.' : undefined}
          {...form.getInputProps('isActive', { type: 'checkbox' })}
        />
      ) : null}

      {error ? <Alert color="red">{error}</Alert> : null}
    </FormModal>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconKey, IconPlus, IconSearch, IconUserCog } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { rolesApi } from '../../api/roles'
import type { RoleDto, UserDto } from '../../api/types'
import { usersApi } from '../../api/users'
import { useAuth } from '../../auth/useAuth'
import { formatDateTime } from '../../components/format'
import { columnFilter } from '../../components/ui/columnFilter'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn, type DataTableSortStatus } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { FormModal } from '../../components/ui/FormModal'
import { useGridFilters, type ColumnText } from '../../components/ui/gridFilters'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { PAGE_SIZE_DEFAULT } from '../../config'
import { PERMISSIONS } from '../../navigation'

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; user: UserDto }
  | { kind: 'roles'; user: UserDto }
  | { kind: 'password'; user: UserDto }
  | null

const PASSWORD_HINT = 'At least 8 characters with upper and lower case, a digit and a symbol.'

/**
 * What each column SHOWS for a user - the text its header filter matches and, where the column
 * offers a tick list, the values that list is built from. Module-level so the filter callbacks keep
 * their identity between renders.
 */
const COLUMN_TEXT: Record<string, ColumnText<UserDto>> = {
  username: (u) => u.username,
  fullName: (u) => u.fullName,
  email: (u) => u.email,
  roles: (u) => u.roles.join(', '),
  isActive: (u) => (u.isActive ? 'Active' : 'Inactive'),
  lastLoginAtUtc: (u) => formatDateTime(u.lastLoginAtUtc),
}

/** The closed set the Status funnel offers, whatever the loaded page happens to contain. */
const STATUS_VALUES = ['Active', 'Inactive']

export function UsersPage() {
  const { user: currentUser, hasPermission } = useAuth()

  const [users, setUsers] = useState<UserDto[]>([])
  const [roles, setRoles] = useState<RoleDto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [sortStatus, setSortStatus] = useState<DataTableSortStatus<UserDto>>({
    columnAccessor: 'username',
    direction: 'asc',
  })
  // A filter that leaves three rows must not strand the reader on page 4 of the old result.
  const grid = useGridFilters(COLUMN_TEXT, () => setPage(1))
  const { apply: applyColumnFilters, options: columnOptions } = grid

  const canCreate = hasPermission(PERMISSIONS.usersCreate)
  const canEdit = hasPermission(PERMISSIONS.usersEdit)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await usersApi.list())
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.messages.join(' ') : 'The users could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  // The role list is needed by the create and roles dialogs; it is only fetched when allowed.
  const loadRoles = useCallback(async () => {
    if (!hasPermission(PERMISSIONS.rolesView)) return
    try {
      setRoles(await rolesApi.list())
    } catch {
      // Not fatal: the dialogs show an empty list and the user can still save the other fields.
    }
  }, [hasPermission])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
    void loadRoles()
  }, [load, loadRoles])

  /** The users endpoint returns everything at once, so filtering and paging happen here. */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matching = term
      ? users.filter(
          (u) =>
            u.username.toLowerCase().includes(term) ||
            u.fullName.toLowerCase().includes(term) ||
            u.email.toLowerCase().includes(term),
        )
      : users

    // The search box and the column funnels narrow the same list, in that order: the box is one
    // question over three fields, each funnel a question about its own column, and all of them AND.
    const narrowed = applyColumnFilters(matching)

    const key = sortStatus.columnAccessor as keyof UserDto
    const sorted = [...narrowed].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')))
    if (sortStatus.direction === 'desc') sorted.reverse()
    return sorted
  }, [users, search, sortStatus, applyColumnFilters])

  /**
   * The tick lists come from EVERY user, not from the rows currently surviving the filters - a list
   * that shrank under the cursor as values were ticked would be unusable, and a value already
   * filtered out could never be un-ticked.
   */
  const values = useMemo(
    () => ({
      username: columnOptions(users, 'username'),
      fullName: columnOptions(users, 'fullName'),
      email: columnOptions(users, 'email'),
    }),
    [users, columnOptions],
  )

  const records = filtered.slice((page - 1) * pageSize, page * pageSize)

  async function afterChange(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleStatus(user: UserDto) {
    const activating = !user.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate user' : 'Deactivate user',
      message: activating
        ? `Allow ${user.username} to sign in again?`
        : `${user.username} will be signed out everywhere and will no longer be able to sign in.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
      danger: !activating,
    })
    if (!confirmed) return

    try {
      await usersApi.setStatus(user.id, activating)
      await afterChange(activating ? 'User activated.' : 'User deactivated.')
    } catch (error) {
      notify.error(error instanceof ApiError ? (error.messages[0] as string) : 'The status could not be changed.')
    }
  }

  const columns: DataTableColumn<UserDto>[] = [
    {
      accessor: 'username',
      title: 'Username',
      sortable: true,
      width: 195,
      ...columnFilter({ ...grid.bind('username'), label: 'Username', options: values.username }),
    },
    {
      accessor: 'fullName',
      title: 'Full name',
      sortable: true,
      ...columnFilter({ ...grid.bind('fullName'), label: 'Full name', options: values.fullName }),
    },
    {
      accessor: 'email',
      title: 'E-mail',
      sortable: true,
      ...columnFilter({ ...grid.bind('email'), label: 'E-mail', options: values.email }),
    },
    {
      accessor: 'roles',
      title: 'Roles',
      // No tick list: a cell holding several roles would offer combinations ("Admin, Manager")
      // rather than roles, so the box - which matches inside the joined text - is the honest control.
      ...columnFilter({ ...grid.bind('roles'), label: 'Roles', placeholder: 'Role contains...' }),
      render: (u) =>
        u.roles.length === 0 ? (
          <Text c="dimmed" fz="sm">
            None
          </Text>
        ) : (
          <Group gap={4}>
            {u.roles.map((r) => (
              <Badge key={r} variant="light" size="sm">
                {r}
              </Badge>
            ))}
          </Group>
        ),
    },
    {
      accessor: 'isActive',
      title: 'Status',
      sortable: true,
      width: 150,
      ...columnFilter({ ...grid.bind('isActive'), label: 'Status', options: STATUS_VALUES, withText: false }),
      render: (u) => <StatusBadge active={u.isActive} />,
    },
    {
      accessor: 'lastLoginAtUtc',
      title: 'Last sign-in',
      sortable: true,
      width: 215,
      // No tick list: every sign-in is a different instant, so the list would be one entry per row.
      // The box matches the formatted text, so "2026-08" or "14/07" narrows it the way it reads.
      ...columnFilter({ ...grid.bind('lastLoginAtUtc'), label: 'Last sign-in' }),
      render: (u) => formatDateTime(u.lastLoginAtUtc),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 200,
      textAlign: 'right',
      render: (user) => (
        <Group gap={4} wrap="nowrap" justify="flex-end">
          <RowActions
            label={user.username}
            edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', user }) }}
            toggleStatus={{
              visible: canEdit,
              active: user.isActive,
              disabled: user.id === currentUser?.id,
              disabledReason: 'You cannot deactivate your own account',
              onClick: () => void handleStatus(user),
            }}
          />
          {canEdit ? (
            <>
              <Tooltip label="Roles" withArrow position="top">
                <ActionIcon
                  variant="subtle"
                  color="grape"
                  aria-label={`Roles of `}
                  onClick={() => setDialog({ kind: 'roles', user })}
                >
                  <IconUserCog size={17} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Reset password" withArrow position="top">
                <ActionIcon
                  variant="subtle"
                  color="orange"
                  aria-label={`Reset password for `}
                  onClick={() => setDialog({ kind: 'password', user })}
                >
                  <IconKey size={17} />
                </ActionIcon>
              </Tooltip>
            </>
          ) : null}
        </Group>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Accounts that can sign in, and the roles that decide what they may do."
        actions={
          canCreate ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
              New user
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <FilterBar.Col span={5}>
          <TextInput
            placeholder="Search username, name or e-mail"
            leftSection={<IconSearch size={16} />}
            aria-label="Search users"
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value)
              setPage(1)
            }}
          />
        </FilterBar.Col>
      </FilterBar>

      {loadError ? (
        <Alert color="red" mb="md" title="Could not load users">
          {loadError}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<UserDto>
          storeKey="security.users"
          records={records}
          columns={columns}
          totalRecords={filtered.length}
          page={page}
          recordsPerPage={pageSize}
          onPageChange={setPage}
          onRecordsPerPageChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          sortStatus={sortStatus}
          onSortStatusChange={(status) => {
            setSortStatus(status)
            setPage(1)
          }}
          fetching={loading}
          // Enter on the selected row does what its pencil does.
          onRowActivate={canEdit ? ({ record }) => setDialog({ kind: 'edit', user: record }) : undefined}
          filters={grid}
          noRecordsText={users.length === 0 ? 'No users yet.' : 'No user matches your search.'}
        />
      </Paper>

      {dialog?.kind === 'create' ? (
        <CreateUserDialog roles={roles} onClose={() => setDialog(null)} onDone={() => void afterChange('User created.')} />
      ) : null}

      {dialog?.kind === 'edit' ? (
        <EditUserDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={() => void afterChange('User updated.')}
        />
      ) : null}

      {dialog?.kind === 'roles' ? (
        <UserRolesDialog
          user={dialog.user}
          roles={roles}
          onClose={() => setDialog(null)}
          onDone={() => void afterChange('Roles updated.')}
        />
      ) : null}

      {dialog?.kind === 'password' ? (
        <ResetPasswordDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={() => void afterChange('Password reset.')}
        />
      ) : null}
    </>
  )
}

// ----- dialogs -----

function RoleCheckboxes({
  roles,
  value,
  onChange,
}: {
  roles: RoleDto[]
  value: string[]
  onChange(value: string[]): void
}) {
  if (roles.length === 0) {
    return (
      <Text c="dimmed" fz="sm">
        No roles available.
      </Text>
    )
  }

  return (
    <Checkbox.Group label="Roles" value={value} onChange={onChange}>
      <Stack gap="xs" mt="xs">
        {roles.map((role) => (
          <Checkbox
            key={role.id}
            value={String(role.id)}
            label={
              <Group gap="xs">
                {role.name}
                {role.isSystem ? (
                  <Badge size="xs" variant="light" color="blue">
                    System
                  </Badge>
                ) : null}
              </Group>
            }
          />
        ))}
      </Stack>
    </Checkbox.Group>
  )
}

function CreateUserDialog({ roles, onClose, onDone }: { roles: RoleDto[]; onClose(): void; onDone(): void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const form = useForm({
    initialValues: { username: '', fullName: '', email: '', password: '', confirm: '', roleIds: [] as string[] },
    validate: {
      username: (v) => (v.trim() ? null : 'Username is required.'),
      fullName: (v) => (v.trim() ? null : 'Full name is required.'),
      email: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'Enter a valid e-mail address.'),
      password: (v) => (v ? null : 'Password is required.'),
      confirm: (v, values) => (v === values.password ? null : 'The password and its confirmation do not match.'),
    },
  })

  async function submit(values: typeof form.values) {
    setError(null)
    setBusy(true)
    try {
      await usersApi.create({
        username: values.username.trim(),
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password,
        roleIds: values.roleIds.map(Number),
      })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The user could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormModal
      opened
      title="New user"
      saveLabel="Create user"
      saving={busy}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void submit(values))()}
    >
      <TextInput label="Username" withAsterisk autoComplete="off" {...form.getInputProps('username')} />
      <TextInput label="Full name" withAsterisk {...form.getInputProps('fullName')} />
      <TextInput label="E-mail" type="email" withAsterisk {...form.getInputProps('email')} />
      <PasswordInput
        label="Password"
        description={PASSWORD_HINT}
        withAsterisk
        autoComplete="new-password"
        {...form.getInputProps('password')}
      />
      <PasswordInput
        label="Confirm password"
        withAsterisk
        autoComplete="new-password"
        {...form.getInputProps('confirm')}
      />
      <RoleCheckboxes
        roles={roles}
        value={form.values.roleIds}
        onChange={(value) => form.setFieldValue('roleIds', value)}
      />
      {error ? <Alert color="red">{error}</Alert> : null}
    </FormModal>
  )
}

function EditUserDialog({ user, onClose, onDone }: { user: UserDto; onClose(): void; onDone(): void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const form = useForm({
    initialValues: { fullName: user.fullName, email: user.email },
    validate: {
      fullName: (v) => (v.trim() ? null : 'Full name is required.'),
      email: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'Enter a valid e-mail address.'),
    },
  })

  async function submit(values: typeof form.values) {
    setError(null)
    setBusy(true)
    try {
      await usersApi.update(user.id, { fullName: values.fullName.trim(), email: values.email.trim() })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The user could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormModal
      opened
      title={`Edit ${user.username}`}
      saveLabel="Save changes"
      saving={busy}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void submit(values))()}
    >
      <TextInput label="Full name" withAsterisk {...form.getInputProps('fullName')} />
      <TextInput label="E-mail" type="email" withAsterisk {...form.getInputProps('email')} />
      {error ? <Alert color="red">{error}</Alert> : null}
    </FormModal>
  )
}

function UserRolesDialog({
  user,
  roles,
  onClose,
  onDone,
}: {
  user: UserDto
  roles: RoleDto[]
  onClose(): void
  onDone(): void
}) {
  const [selected, setSelected] = useState<string[]>(user.roleIds.map(String))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      await usersApi.setRoles(user.id, selected.map(Number))
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The roles could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormModal
      opened
      title={`Roles of ${user.username}`}
      saveLabel="Save roles"
      saving={busy}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <RoleCheckboxes roles={roles} value={selected} onChange={setSelected} />
      {error ? <Alert color="red">{error}</Alert> : null}
    </FormModal>
  )
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: UserDto; onClose(): void; onDone(): void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const form = useForm({
    initialValues: { password: '', confirm: '' },
    validate: {
      password: (v) => (v ? null : 'Password is required.'),
      confirm: (v, values) => (v === values.password ? null : 'The password and its confirmation do not match.'),
    },
  })

  async function submit(values: typeof form.values) {
    setError(null)
    setBusy(true)
    try {
      await usersApi.resetPassword(user.id, values.password)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The password could not be reset.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormModal
      opened
      title={`Reset password for ${user.username}`}
      saveLabel="Reset password"
      saving={busy}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void submit(values))()}
    >
      <PasswordInput
        label="New password"
        description={PASSWORD_HINT}
        withAsterisk
        autoComplete="new-password"
        {...form.getInputProps('password')}
      />
      <PasswordInput
        label="Confirm password"
        withAsterisk
        autoComplete="new-password"
        {...form.getInputProps('confirm')}
      />
      <Text c="dimmed" fz="sm">
        All of this user&apos;s sessions will be signed out.
      </Text>
      {error ? <Alert color="red">{error}</Alert> : null}
    </FormModal>
  )
}

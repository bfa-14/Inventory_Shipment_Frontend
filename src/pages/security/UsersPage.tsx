import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/http'
import { rolesApi } from '../../api/roles'
import type { RoleDto, UserDto } from '../../api/types'
import { usersApi } from '../../api/users'
import { useAuth } from '../../auth/useAuth'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/layout/PageHeader'
import { RequirePermission } from '../../components/RequirePermission'
import { Badge } from '../../components/ui/Badge'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Modal } from '../../components/ui/Modal'
import { SearchInput } from '../../components/ui/SearchInput'
import { useToast } from '../../components/ui/useToast'
import { formatDateTime } from '../../components/format'
import { PERMISSIONS } from '../../navigation'

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; user: UserDto }
  | { kind: 'roles'; user: UserDto }
  | { kind: 'password'; user: UserDto }
  | { kind: 'status'; user: UserDto }
  | null

const PASSWORD_HINT = 'At least 8 characters with upper and lower case, a digit and a symbol.'

export function UsersPage() {
  const { user: currentUser, hasPermission } = useAuth()
  const { showToast } = useToast()

  const [users, setUsers] = useState<UserDto[]>([])
  const [roles, setRoles] = useState<RoleDto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)

  const canEdit = hasPermission(PERMISSIONS.usersEdit)

  const load = useCallback(async () => {
    try {
      const list = await usersApi.list()
      setUsers(list)
      setLoadError([])
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.messages : ['The users could not be loaded.'])
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
    // Both loaders await before touching state, so no update happens during this effect.
    // eslint-disable-next-line react/set-state-in-effect
    void load()
    void loadRoles()
  }, [load, loadRoles])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return users
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(term) ||
        u.fullName.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term),
    )
  }, [users, search])

  async function afterChange(message: string) {
    setDialog(null)
    showToast(message)
    await load()
  }

  const columns: Column<UserDto>[] = [
    { key: 'username', header: 'Username', render: (u) => <span className="mono">{u.username}</span> },
    { key: 'fullName', header: 'Full name', render: (u) => u.fullName },
    { key: 'email', header: 'E-mail', render: (u) => u.email, secondary: true },
    {
      key: 'roles',
      header: 'Roles',
      render: (u) =>
        u.roles.length === 0 ? (
          <span className="muted">None</span>
        ) : (
          <span className="chip-row">
            {u.roles.map((r) => (
              <span className="chip" key={r}>
                {r}
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => <Badge tone={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge>,
    },
    { key: 'lastLogin', header: 'Last sign-in', render: (u) => formatDateTime(u.lastLoginAtUtc), secondary: true },
  ]

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Accounts that can sign in, and the roles that decide what they may do."
        actions={
          <RequirePermission code={PERMISSIONS.usersCreate}>
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>
              New user
            </button>
          </RequirePermission>
        }
      />

      <section className="card">
        <div className="card__toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search username, name or e-mail" />
          <span className="muted">
            {filtered.length} of {users.length}
          </span>
        </div>

        <Alert kind="error" messages={loadError} />

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(u) => u.id}
          loading={loading}
          emptyMessage={users.length === 0 ? 'No users yet.' : 'No user matches your search.'}
          rowActions={
            canEdit
              ? (u) => (
                  <div className="row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'edit', user: u })}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'roles', user: u })}>
                      Roles
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setDialog({ kind: 'password', user: u })}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={u.id === currentUser?.id}
                      title={u.id === currentUser?.id ? 'You cannot deactivate your own account' : undefined}
                      onClick={() => setDialog({ kind: 'status', user: u })}
                    >
                      {u.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                )
              : undefined
          }
        />
      </section>

      {dialog?.kind === 'create' ? (
        <CreateUserDialog roles={roles} onClose={() => setDialog(null)} onDone={() => afterChange('User created.')} />
      ) : null}

      {dialog?.kind === 'edit' ? (
        <EditUserDialog user={dialog.user} onClose={() => setDialog(null)} onDone={() => afterChange('User updated.')} />
      ) : null}

      {dialog?.kind === 'roles' ? (
        <UserRolesDialog
          user={dialog.user}
          roles={roles}
          onClose={() => setDialog(null)}
          onDone={() => afterChange('Roles updated.')}
        />
      ) : null}

      {dialog?.kind === 'password' ? (
        <ResetPasswordDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={() => afterChange('Password reset.')}
        />
      ) : null}

      {dialog?.kind === 'status' ? (
        <StatusDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={(activated) => afterChange(activated ? 'User activated.' : 'User deactivated.')}
        />
      ) : null}
    </>
  )
}

// ----- dialogs -----

function RoleCheckboxes({
  roles,
  selected,
  onToggle,
}: {
  roles: RoleDto[]
  selected: number[]
  onToggle(id: number): void
}) {
  if (roles.length === 0) {
    return <p className="muted">No roles available.</p>
  }

  return (
    <div className="checkbox-list">
      {roles.map((role) => (
        <label key={role.id} className="checkbox-row">
          <input type="checkbox" checked={selected.includes(role.id)} onChange={() => onToggle(role.id)} />
          <span>
            {role.name}
            {role.isSystem ? <span className="chip chip--system">System</span> : null}
          </span>
        </label>
      ))}
    </div>
  )
}

function CreateUserDialog({ roles, onClose, onDone }: { roles: RoleDto[]; onClose(): void; onDone(): void }) {
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [roleIds, setRoleIds] = useState<number[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors([])

    if (password !== confirm) {
      setErrors(['The password and its confirmation do not match.'])
      return
    }

    setBusy(true)
    try {
      await usersApi.create({ username: username.trim(), fullName: fullName.trim(), email: email.trim(), password, roleIds })
      onDone()
    } catch (error) {
      setErrors(error instanceof ApiError ? error.messages : ['The user could not be created.'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New user"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="create-user-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating...' : 'Create user'}
          </button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={handleSubmit} noValidate className="form-grid">
        <label htmlFor="cu-username">Username</label>
        <input id="cu-username" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />

        <label htmlFor="cu-fullname">Full name</label>
        <input id="cu-fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} required />

        <label htmlFor="cu-email">E-mail</label>
        <input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label htmlFor="cu-password">Password</label>
        <input
          id="cu-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
        <p className="field-hint">{PASSWORD_HINT}</p>

        <label htmlFor="cu-confirm">Confirm password</label>
        <input
          id="cu-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />

        <span className="form-label">Roles</span>
        <RoleCheckboxes
          roles={roles}
          selected={roleIds}
          onToggle={(id) => setRoleIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
        />

        <Alert kind="error" messages={errors} />
      </form>
    </Modal>
  )
}

function EditUserDialog({ user, onClose, onDone }: { user: UserDto; onClose(): void; onDone(): void }) {
  const [fullName, setFullName] = useState(user.fullName)
  const [email, setEmail] = useState(user.email)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors([])
    setBusy(true)
    try {
      await usersApi.update(user.id, { fullName: fullName.trim(), email: email.trim() })
      onDone()
    } catch (error) {
      setErrors(error instanceof ApiError ? error.messages : ['The user could not be updated.'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Edit ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="edit-user-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={handleSubmit} noValidate className="form-grid">
        <label htmlFor="eu-fullname">Full name</label>
        <input id="eu-fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} required />

        <label htmlFor="eu-email">E-mail</label>
        <input id="eu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <Alert kind="error" messages={errors} />
      </form>
    </Modal>
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
  const [selected, setSelected] = useState<number[]>(user.roleIds)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    setErrors([])
    setBusy(true)
    try {
      await usersApi.setRoles(user.id, selected)
      onDone()
    } catch (error) {
      setErrors(error instanceof ApiError ? error.messages : ['The roles could not be saved.'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Roles of ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving...' : 'Save roles'}
          </button>
        </>
      }
    >
      <RoleCheckboxes
        roles={roles}
        selected={selected}
        onToggle={(id) => setSelected((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
      />
      <Alert kind="error" messages={errors} />
    </Modal>
  )
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: UserDto; onClose(): void; onDone(): void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors([])

    if (password !== confirm) {
      setErrors(['The password and its confirmation do not match.'])
      return
    }

    setBusy(true)
    try {
      await usersApi.resetPassword(user.id, password)
      onDone()
    } catch (error) {
      setErrors(error instanceof ApiError ? error.messages : ['The password could not be reset.'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Reset password for ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="reset-password-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : 'Reset password'}
          </button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={handleSubmit} noValidate className="form-grid">
        <label htmlFor="rp-password">New password</label>
        <input
          id="rp-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
        <p className="field-hint">{PASSWORD_HINT}</p>

        <label htmlFor="rp-confirm">Confirm password</label>
        <input
          id="rp-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />

        <p className="field-hint">All of this user&apos;s sessions will be signed out.</p>
        <Alert kind="error" messages={errors} />
      </form>
    </Modal>
  )
}

function StatusDialog({ user, onClose, onDone }: { user: UserDto; onClose(): void; onDone(activated: boolean): void }) {
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const activating = !user.isActive

  async function handleConfirm() {
    setErrors([])
    setBusy(true)
    try {
      await usersApi.setStatus(user.id, activating)
      onDone(activating)
    } catch (error) {
      setErrors(error instanceof ApiError ? error.messages : ['The status could not be changed.'])
      setBusy(false)
    }
  }

  if (errors.length > 0) {
    return (
      <Modal
        title={activating ? 'Activate user' : 'Deactivate user'}
        onClose={onClose}
        footer={
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        }
      >
        <Alert kind="error" messages={errors} />
      </Modal>
    )
  }

  return (
    <ConfirmDialog
      title={activating ? 'Activate user' : 'Deactivate user'}
      message={
        activating
          ? `Allow ${user.username} to sign in again?`
          : `${user.username} will be signed out everywhere and will no longer be able to sign in.`
      }
      confirmLabel={activating ? 'Activate' : 'Deactivate'}
      danger={!activating}
      busy={busy}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  )
}

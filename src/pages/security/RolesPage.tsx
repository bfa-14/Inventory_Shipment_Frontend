import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/http'
import { permissionsApi } from '../../api/permissions'
import { rolesApi } from '../../api/roles'
import type { PermissionModuleDto, RoleDetailDto, RoleDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/layout/PageHeader'
import { RequirePermission } from '../../components/RequirePermission'
import { Badge } from '../../components/ui/Badge'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/useToast'
import { PERMISSIONS } from '../../navigation'

export function RolesPage() {
  const { hasPermission } = useAuth()
  const { showToast } = useToast()
  const canManage = hasPermission(PERMISSIONS.rolesManage)

  const [roles, setRoles] = useState<RoleDto[]>([])
  const [modules, setModules] = useState<PermissionModuleDto[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<RoleDetailDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const loadRoles = useCallback(async (selectAfter?: number) => {
    try {
      const list = await rolesApi.list()
      setRoles(list)
      setLoadError([])
      setSelectedId((current) => selectAfter ?? current ?? list[0]?.id ?? null)
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.messages : ['The roles could not be loaded.'])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // loadRoles awaits before touching state, so no update happens during this effect.
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

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="A role is a named bundle of permissions. Assign roles to users on the Users page."
        actions={
          <RequirePermission code={PERMISSIONS.rolesManage}>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              New role
            </button>
          </RequirePermission>
        }
      />

      <Alert kind="error" messages={loadError} />

      <div className="master-detail">
        <section className="card master-detail__list">
          <h3 className="card__title">All roles</h3>
          {loading ? (
            <p className="muted">Loading...</p>
          ) : (
            <ul className="role-list">
              {roles.map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    className={`role-list__item${role.id === selectedId ? ' role-list__item--active' : ''}`}
                    onClick={() => setSelectedId(role.id)}
                  >
                    <span className="role-list__name">
                      {role.name}
                      {role.isSystem ? <Badge tone="info">System</Badge> : null}
                      {!role.isActive ? <Badge tone="danger">Inactive</Badge> : null}
                    </span>
                    <span className="role-list__meta muted">
                      {role.userCount} user{role.userCount === 1 ? '' : 's'} &middot; {role.permissionCount} permission
                      {role.permissionCount === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="master-detail__detail">
          {detail ? (
            <RoleDetail
              key={detail.id}
              role={detail}
              modules={modules}
              canManage={canManage}
              onSaved={async (message) => {
                showToast(message)
                await reload()
              }}
              onRequestDelete={() => setConfirmDelete(true)}
            />
          ) : (
            <div className="card">
              <p className="muted">Select a role to see its permissions.</p>
            </div>
          )}
        </section>
      </div>

      {creating ? (
        <CreateRoleDialog
          modules={modules}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false)
            showToast('Role created.')
            await reload(id)
          }}
        />
      ) : null}

      {confirmDelete && detail ? (
        <DeleteRoleDialog
          role={detail}
          onClose={() => setConfirmDelete(false)}
          onDeleted={async () => {
            setConfirmDelete(false)
            showToast('Role deleted.')
            setSelectedId(null)
            setDetail(null)
            await loadRoles()
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
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? '')
  const [isActive, setIsActive] = useState(role.isActive)
  const [selected, setSelected] = useState<number[]>(role.permissionIds)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [permErrors, setPermErrors] = useState<string[]>([])
  const [savingForm, setSavingForm] = useState(false)
  const [savingPerms, setSavingPerms] = useState(false)

  const deleteBlocked = role.isSystem || role.userCount > 0
  const deleteReason = role.isSystem
    ? 'A system role cannot be deleted.'
    : role.userCount > 0
      ? 'Remove the role from its users first.'
      : undefined

  async function handleSaveForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormErrors([])
    setSavingForm(true)
    try {
      await rolesApi.update(role.id, { name: name.trim(), description: description.trim() || null, isActive })
      await onSaved('Role saved.')
    } catch (error) {
      setFormErrors(error instanceof ApiError ? error.messages : ['The role could not be saved.'])
    } finally {
      setSavingForm(false)
    }
  }

  async function handleSavePermissions() {
    setPermErrors([])
    setSavingPerms(true)
    try {
      await rolesApi.setPermissions(role.id, selected)
      await onSaved('Permissions saved.')
    } catch (error) {
      setPermErrors(error instanceof ApiError ? error.messages : ['The permissions could not be saved.'])
    } finally {
      setSavingPerms(false)
    }
  }

  return (
    <>
      <section className="card">
        <h3 className="card__title">{role.name}</h3>
        <form onSubmit={handleSaveForm} noValidate className="form-grid">
          <label htmlFor="rd-name">Name</label>
          <input
            id="rd-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            readOnly={role.isSystem}
            disabled={!canManage}
            required
          />

          <label htmlFor="rd-description">Description</label>
          <input
            id="rd-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canManage}
          />

          <label className="checkbox-row checkbox-row--inline">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={!canManage || role.isSystem}
            />
            <span>Active</span>
          </label>

          <Alert kind="error" messages={formErrors} />

          {canManage ? (
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={savingForm}>
                {savingForm ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn-danger-solid"
                onClick={onRequestDelete}
                disabled={deleteBlocked}
                title={deleteReason}
              >
                Delete role
              </button>
            </div>
          ) : null}
        </form>
      </section>

      <section className="card">
        <h3 className="card__title">Permissions</h3>
        {role.isSystem ? <p className="notice">System roles always hold every permission.</p> : null}

        {modules.length === 0 ? (
          <p className="muted">The permission catalog is not available to you.</p>
        ) : (
          modules.map((module) => {
            const ids = module.permissions.map((p) => p.id)
            const allSelected = ids.every((id) => role.isSystem || selected.includes(id))
            return (
              <div className="perm-module" key={module.module}>
                <div className="perm-module__head">
                  <h4>{module.module}</h4>
                  {canManage && !role.isSystem ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setSelected((current) =>
                          allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])],
                        )
                      }
                    >
                      {allSelected ? 'Clear all' : 'Select all'}
                    </button>
                  ) : null}
                </div>

                <div className="checkbox-list">
                  {module.permissions.map((p) => (
                    <label className="checkbox-row" key={p.id}>
                      <input
                        type="checkbox"
                        checked={role.isSystem || selected.includes(p.id)}
                        disabled={role.isSystem || !canManage}
                        onChange={() =>
                          setSelected((current) =>
                            current.includes(p.id) ? current.filter((x) => x !== p.id) : [...current, p.id],
                          )
                        }
                      />
                      <span>
                        <strong>{p.name}</strong>
                        <code className="mono perm-code">{p.code}</code>
                        {p.description ? <span className="muted perm-desc">{p.description}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })
        )}

        <Alert kind="error" messages={permErrors} />

        {canManage && !role.isSystem && modules.length > 0 ? (
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={handleSavePermissions} disabled={savingPerms}>
              {savingPerms ? 'Saving...' : 'Save permissions'}
            </button>
          </div>
        ) : null}
      </section>
    </>
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
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors([])
    setBusy(true)
    try {
      const created = await rolesApi.create({
        name: name.trim(),
        description: description.trim() || null,
        permissionIds: selected,
      })
      onCreated(created.id)
    } catch (error) {
      setErrors(error instanceof ApiError ? error.messages : ['The role could not be created.'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New role"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="create-role-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating...' : 'Create role'}
          </button>
        </>
      }
    >
      <form id="create-role-form" onSubmit={handleSubmit} noValidate className="form-grid">
        <label htmlFor="cr-name">Name</label>
        <input id="cr-name" value={name} onChange={(e) => setName(e.target.value)} required />

        <label htmlFor="cr-description">Description</label>
        <input id="cr-description" value={description} onChange={(e) => setDescription(e.target.value)} />

        <span className="form-label">Permissions</span>
        {modules.length === 0 ? (
          <p className="muted">The permission catalog is not available to you.</p>
        ) : (
          modules.map((module) => (
            <div className="perm-module" key={module.module}>
              <h4>{module.module}</h4>
              <div className="checkbox-list">
                {module.permissions.map((p) => (
                  <label className="checkbox-row" key={p.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={() =>
                        setSelected((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))
                      }
                    />
                    <span>
                      <strong>{p.name}</strong>
                      <code className="mono perm-code">{p.code}</code>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))
        )}

        <Alert kind="error" messages={errors} />
      </form>
    </Modal>
  )
}

function DeleteRoleDialog({ role, onClose, onDeleted }: { role: RoleDto; onClose(): void; onDeleted(): void }) {
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setErrors([])
    setBusy(true)
    try {
      await rolesApi.remove(role.id)
      onDeleted()
    } catch (error) {
      setErrors(error instanceof ApiError ? error.messages : ['The role could not be deleted.'])
      setBusy(false)
    }
  }

  if (errors.length > 0) {
    return (
      <Modal
        title="Delete role"
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
      title="Delete role"
      message={`Delete the role "${role.name}"? This cannot be undone.`}
      confirmLabel="Delete"
      danger
      busy={busy}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  )
}

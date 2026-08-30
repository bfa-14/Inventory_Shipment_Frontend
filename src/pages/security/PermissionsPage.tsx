import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../api/http'
import { permissionsApi } from '../../api/permissions'
import type { PermissionModuleDto } from '../../api/types'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/layout/PageHeader'
import { SearchInput } from '../../components/ui/SearchInput'

export function PermissionsPage() {
  const [modules, setModules] = useState<PermissionModuleDto[]>([])
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const catalog = await permissionsApi.catalog()
        if (!cancelled) setModules(catalog)
      } catch (error) {
        if (!cancelled) setErrors(error instanceof ApiError ? error.messages : ['The catalog could not be loaded.'])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return modules
    return modules
      .map((m) => ({
        ...m,
        permissions: m.permissions.filter(
          (p) =>
            p.code.toLowerCase().includes(term) ||
            p.name.toLowerCase().includes(term) ||
            (p.description ?? '').toLowerCase().includes(term),
        ),
      }))
      .filter((m) => m.permissions.length > 0)
  }, [modules, filter])

  return (
    <>
      <PageHeader title="Permissions" subtitle="Everything the application can guard, grouped by module." />

      <section className="card">
        <p className="notice">
          Permissions are defined by the application; assign them to roles on the Roles page.
        </p>

        <div className="card__toolbar">
          <SearchInput value={filter} onChange={setFilter} placeholder="Filter by code, name or description" />
        </div>

        <Alert kind="error" messages={errors} />

        {loading ? (
          <p className="table-state muted">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="table-state muted">No permission matches your filter.</p>
        ) : (
          filtered.map((module) => (
            <div className="perm-module" key={module.module}>
              <h3 className="card__title">{module.module}</h3>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th className="col-secondary">Description</th>
                      <th>Roles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {module.permissions.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <code className="mono">{p.code}</code>
                        </td>
                        <td>{p.name}</td>
                        <td className="col-secondary muted">{p.description}</td>
                        <td>
                          {p.roles.length === 0 ? (
                            <span className="muted">No role</span>
                          ) : (
                            <span className="chip-row">
                              {p.roles.map((r) => (
                                <span className="chip" key={r}>
                                  {r}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>
    </>
  )
}

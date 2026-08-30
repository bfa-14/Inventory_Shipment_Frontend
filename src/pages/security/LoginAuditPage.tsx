import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/http'
import { securityApi } from '../../api/security'
import type { LoginAuditDto } from '../../api/types'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/layout/PageHeader'
import { Badge } from '../../components/ui/Badge'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { formatDateTime } from '../../components/format'

const TAKE_OPTIONS = [50, 200, 500]

export function LoginAuditPage() {
  const [entries, setEntries] = useState<LoginAuditDto[]>([])
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])

  const [username, setUsername] = useState('')
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [take, setTake] = useState(200)

  const load = useCallback(async () => {
    setLoading(true)
    setErrors([])
    try {
      setEntries(await securityApi.loginAudit({ username, onlyFailed, take }))
    } catch (error) {
      setErrors(error instanceof ApiError ? error.messages : ['The login audit could not be loaded.'])
    } finally {
      setLoading(false)
    }
  }, [username, onlyFailed, take])

  useEffect(() => {
    void load()
    // Only refetch on an explicit Refresh or a filter change the user confirms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyFailed, take])

  const columns: Column<LoginAuditDto>[] = [
    { key: 'time', header: 'Time', render: (e) => formatDateTime(e.attemptedAtUtc) },
    { key: 'username', header: 'Username', render: (e) => <span className="mono">{e.username}</span> },
    {
      key: 'result',
      header: 'Result',
      render: (e) => <Badge tone={e.succeeded ? 'success' : 'danger'}>{e.succeeded ? 'Success' : 'Failed'}</Badge>,
    },
    { key: 'reason', header: 'Reason', render: (e) => e.failureReason ?? <span className="muted">-</span> },
    { key: 'ip', header: 'IP address', render: (e) => <span className="mono">{e.ipAddress ?? '-'}</span>, secondary: true },
    {
      key: 'ua',
      header: 'User agent',
      secondary: true,
      render: (e) => (
        <span className="truncate" title={e.userAgent ?? undefined}>
          {e.userAgent ?? '-'}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Login audit" subtitle="Every sign-in attempt, successful or not." />

      <section className="card">
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault()
            void load()
          }}
        >
          <div className="filter-bar__field">
            <label htmlFor="la-username">Username</label>
            <input
              id="la-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Exact username"
            />
          </div>

          <label className="checkbox-row checkbox-row--inline">
            <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} />
            <span>Only failed</span>
          </label>

          <div className="filter-bar__field">
            <label htmlFor="la-take">Rows</label>
            <select id="la-take" value={take} onChange={(e) => setTake(Number(e.target.value))}>
              {TAKE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </form>

        <Alert kind="error" messages={errors} />

        <DataTable
          columns={columns}
          rows={entries}
          rowKey={(e) => e.id}
          loading={loading}
          emptyMessage="No sign-in attempts match these filters."
        />
      </section>
    </>
  )
}

import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { PageHeader } from '../components/layout/PageHeader'
import { formatDateTime, initials } from '../components/format'
import { navLeaves, visibleNavigation } from '../navigation'

export function DashboardPage() {
  const { user, hasPermission } = useAuth()
  if (!user) return null

  // One card per screen this user may actually open, grouped the way the sidebar groups them.
  const groups = new Map<string, string[]>()
  for (const leaf of navLeaves(visibleNavigation(hasPermission))) {
    if (leaf.item.to === '/') continue
    const heading = leaf.group?.label ?? leaf.section.breadcrumb ?? leaf.section.title ?? 'Sections'
    groups.set(heading, [...(groups.get(heading) ?? []), leaf.item.label])
  }

  const routeOf = new Map(navLeaves().map((leaf) => [leaf.item.label, leaf.item.to as string]))
  const reachable = [...groups].map(([title, items]) => ({ title, items }))

  return (
    <>
      <PageHeader title={`Welcome, ${user.fullName}`} subtitle="Katanga TVS Inventory &amp; Shipment" />

      <section className="card dashboard-hero">
        <span className="dashboard-hero__avatar" aria-hidden="true">
          {initials(user.fullName)}
        </span>
        <div>
          <h2>{user.fullName}</h2>
          <p className="muted">
            {user.username} &middot; {user.email}
          </p>
          <div className="chip-row">
            {user.roles.length === 0 ? (
              <span className="muted">No roles assigned</span>
            ) : (
              user.roles.map((r) => (
                <span className="chip" key={r}>
                  {r}
                </span>
              ))
            )}
          </div>
          <p className="muted dashboard-hero__last">Last sign-in: {formatDateTime(user.lastLoginAtUtc)}</p>
        </div>
      </section>

      {reachable.length === 0 ? (
        <section className="card">
          <p className="muted">You have no sections available yet. Ask an administrator for access.</p>
        </section>
      ) : (
        reachable.map((section) => (
          <section key={section.title}>
            <h3 className="section-title">{section.title}</h3>
            <div className="card-grid">
              {section.items.map((label) => (
                <Link className="card link-card" to={routeOf.get(label) as string} key={label}>
                  <strong>{label}</strong>
                  <span className="muted">Open {label.toLowerCase()}</span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  )
}

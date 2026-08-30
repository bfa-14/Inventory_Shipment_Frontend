import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppShell } from './components/layout/AppShell'
import { PERMISSIONS } from './navigation'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { DashboardPage } from './pages/DashboardPage'
import { ForbiddenPage } from './pages/ForbiddenPage'
import { LoginPage } from './pages/LoginPage'
import { BranchesPage } from './pages/masterdata/BranchesPage'
import { WarehousesPage } from './pages/masterdata/WarehousesPage'
import { LoginAuditPage } from './pages/security/LoginAuditPage'
import { PermissionsPage } from './pages/security/PermissionsPage'
import { RolesPage } from './pages/security/RolesPage'
import { UsersPage } from './pages/security/UsersPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Everything below requires a signed-in user. */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="/account/password" element={<ChangePasswordPage />} />
              <Route path="/forbidden" element={<ForbiddenPage />} />

              <Route element={<ProtectedRoute permission={PERMISSIONS.branchesView} />}>
                <Route path="/setup/master-data/branches" element={<BranchesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.warehousesView} />}>
                <Route path="/setup/master-data/warehouses" element={<WarehousesPage />} />
              </Route>

              <Route element={<ProtectedRoute permission={PERMISSIONS.usersView} />}>
                <Route path="/security/users" element={<UsersPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.rolesView} />}>
                <Route path="/security/roles" element={<RolesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.permissionsView} />}>
                <Route path="/security/permissions" element={<PermissionsPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.auditView} />}>
                <Route path="/security/login-audit" element={<LoginAuditPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

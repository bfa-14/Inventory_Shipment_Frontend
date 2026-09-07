import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppShell } from './components/layout/AppShell'
import { PERMISSIONS } from './navigation'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { DashboardPage } from './pages/DashboardPage'
import { ForbiddenPage } from './pages/ForbiddenPage'
import { ItemDetailsPage } from './pages/inventory/ItemDetailsPage'
import { ItemsPage } from './pages/inventory/ItemsPage'
import { LoginPage } from './pages/LoginPage'
import { BranchesPage } from './pages/masterdata/BranchesPage'
import { BrandsPage } from './pages/masterdata/BrandsPage'
import { CurrenciesPage } from './pages/masterdata/CurrenciesPage'
import { ItemFamiliesPage } from './pages/masterdata/ItemFamiliesPage'
import { PartiesPage } from './pages/masterdata/PartiesPage'
import { PriceListsPage } from './pages/masterdata/PriceListsPage'
import { UnitTypesPage } from './pages/masterdata/UnitTypesPage'
import { WarehousesPage } from './pages/masterdata/WarehousesPage'
import { LoginAuditPage } from './pages/security/LoginAuditPage'
import { PermissionsPage } from './pages/security/PermissionsPage'
import { RolePermissionsPage } from './pages/security/RolePermissionsPage'
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
              <Route element={<ProtectedRoute permission={PERMISSIONS.currenciesView} />}>
                <Route path="/setup/master-data/currencies" element={<CurrenciesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.itemFamiliesView} />}>
                <Route path="/setup/master-data/item-families" element={<ItemFamiliesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.brandsView} />}>
                <Route path="/setup/master-data/brands" element={<BrandsPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.unitTypesView} />}>
                <Route path="/setup/master-data/unit-types" element={<UnitTypesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.partiesView} />}>
                <Route path="/setup/master-data/parties" element={<PartiesPage />} />
              </Route>

              {/* Creating an item needs its own guard: a reader who may only view items must not
                  reach the blank form, even though it is the same component as the details page. */}
              <Route element={<ProtectedRoute permission={PERMISSIONS.itemsCreate} />}>
                <Route path="/inventory/items/new" element={<ItemDetailsPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.itemsView} />}>
                <Route path="/inventory/items" element={<ItemsPage />} />
                <Route path="/inventory/items/:id" element={<ItemDetailsPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.priceListsView} />}>
                <Route path="/inventory/price-lists" element={<PriceListsPage />} />
              </Route>

              <Route element={<ProtectedRoute permission={PERMISSIONS.usersView} />}>
                <Route path="/security/users" element={<UsersPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.rolesView} />}>
                <Route path="/security/roles" element={<RolesPage />} />
                {/* Reading a role's permissions is reading the role, so it shares the role's view
                    guard; saving them is checked against rolesManage inside the page. */}
                <Route path="/security/role-permissions" element={<RolePermissionsPage />} />
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

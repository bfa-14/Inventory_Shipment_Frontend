import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppShell } from './components/layout/AppShell'
import { INVENTORY_IN, INVENTORY_OUT } from './components/documents/documentKind'
import { PURCHASE_INVOICE, PURCHASE_ORDER, PURCHASE_RETURN } from './components/purchase/purchaseKind'
import { PERMISSIONS } from './navigation'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { DocumentTypesPage } from './pages/configuration/DocumentTypesPage'
import { DashboardPage } from './pages/DashboardPage'
import { ForbiddenPage } from './pages/ForbiddenPage'
import { ItemDetailsPage } from './pages/inventory/ItemDetailsPage'
import { ItemsPage } from './pages/inventory/ItemsPage'
import { ShortagesPage } from './pages/inventory/ShortagesPage'
import { StockDocumentPage } from './pages/inventory/StockDocumentPage'
import { StockDocumentsPage } from './pages/inventory/StockDocumentsPage'
import { LoginPage } from './pages/LoginPage'
import { BranchesPage } from './pages/masterdata/BranchesPage'
import { BrandsPage } from './pages/masterdata/BrandsPage'
import { CurrenciesPage } from './pages/masterdata/CurrenciesPage'
import { ItemFamiliesPage } from './pages/masterdata/ItemFamiliesPage'
import { PartiesPage } from './pages/masterdata/PartiesPage'
import { PriceListsPage } from './pages/masterdata/PriceListsPage'
import { UnitTypesPage } from './pages/masterdata/UnitTypesPage'
import { WarehousesPage } from './pages/masterdata/WarehousesPage'
import { PurchaseDocumentPage } from './pages/purchase/PurchaseDocumentPage'
import { PurchaseDocumentsPage } from './pages/purchase/PurchaseDocumentsPage'
import { ImportSalesPage } from './pages/sales/ImportSalesPage'
import { SalesInvoicePage } from './pages/sales/SalesInvoicePage'
import { SalesInvoicesPage } from './pages/sales/SalesInvoicesPage'
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
              {/* The two document families. Create and edit sit behind the view permission as well:
                  the page itself refuses to save without the create one, and a user who may not read
                  the list has no business on a document from it. */}
              <Route element={<ProtectedRoute permission={PERMISSIONS.stockInView} />}>
                <Route path="/inventory/stock-in" element={<StockDocumentsPage kind={INVENTORY_IN} />} />
                <Route path="/inventory/stock-in/new" element={<StockDocumentPage kind={INVENTORY_IN} />} />
                <Route path="/inventory/stock-in/:id" element={<StockDocumentPage kind={INVENTORY_IN} />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.stockOutView} />}>
                <Route path="/inventory/stock-out" element={<StockDocumentsPage kind={INVENTORY_OUT} />} />
                <Route path="/inventory/stock-out/new" element={<StockDocumentPage kind={INVENTORY_OUT} />} />
                <Route path="/inventory/stock-out/:id" element={<StockDocumentPage kind={INVENTORY_OUT} />} />
              </Route>

              <Route element={<ProtectedRoute permission={PERMISSIONS.priceListsView} />}>
                <Route path="/inventory/price-lists" element={<PriceListsPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.shortagesView} />}>
                <Route path="/inventory/shortages" element={<ShortagesPage />} />
              </Route>

              {/* The purchase family: one list and one document page, three kinds. Each kind sits behind
                  its own view permission; creating, posting, closing and cancelling are checked on the
                  page (and by the API, which answers 403 naming the permission). */}
              <Route element={<ProtectedRoute permission={PERMISSIONS.purchaseOrdersView} />}>
                <Route path="/purchase/orders" element={<PurchaseDocumentsPage kind={PURCHASE_ORDER} />} />
                <Route path="/purchase/orders/new" element={<PurchaseDocumentPage kind={PURCHASE_ORDER} />} />
                <Route path="/purchase/orders/:id" element={<PurchaseDocumentPage kind={PURCHASE_ORDER} />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.purchaseInvoicesView} />}>
                <Route path="/purchase/invoices" element={<PurchaseDocumentsPage kind={PURCHASE_INVOICE} />} />
                <Route path="/purchase/invoices/new" element={<PurchaseDocumentPage kind={PURCHASE_INVOICE} />} />
                <Route path="/purchase/invoices/:id" element={<PurchaseDocumentPage kind={PURCHASE_INVOICE} />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.purchaseReturnsView} />}>
                <Route path="/purchase/returns" element={<PurchaseDocumentsPage kind={PURCHASE_RETURN} />} />
                <Route path="/purchase/returns/new" element={<PurchaseDocumentPage kind={PURCHASE_RETURN} />} />
                <Route path="/purchase/returns/:id" element={<PurchaseDocumentPage kind={PURCHASE_RETURN} />} />
              </Route>

              {/* Import Sales from Excel: validate a file against the stock and post it as an invoice.
                  Guarded by the import permission; posting is checked on the page (and the API). */}
              <Route element={<ProtectedRoute permission={PERMISSIONS.invoicesImport} />}>
                <Route path="/sales/import-preview" element={<ImportSalesPage />} />
              </Route>
              {/* Sales invoices: the list and the document sit behind the view permission; creating,
                  posting and cancelling are checked on the page (and by the API). */}
              <Route element={<ProtectedRoute permission={PERMISSIONS.invoicesView} />}>
                <Route path="/sales/invoices" element={<SalesInvoicesPage />} />
                <Route path="/sales/invoices/new" element={<SalesInvoicePage />} />
                <Route path="/sales/invoices/:id" element={<SalesInvoicePage />} />
              </Route>

              <Route element={<ProtectedRoute permission={PERMISSIONS.documentTypesManage} />}>
                <Route path="/configuration/document-types" element={<DocumentTypesPage />} />
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

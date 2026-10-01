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
import { ShortageDocumentPage } from './pages/inventory/ShortageDocumentPage'
import { ShortagePrintPage } from './pages/inventory/ShortagePrintPage'
import { ShortagesPage } from './pages/inventory/ShortagesPage'
import { StockValuationPage } from './pages/inventory/StockValuationPage'
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
import { AttachmentTypesPage } from './pages/masterdata/AttachmentTypesPage'
import { ContainerTypesPage } from './pages/masterdata/ContainerTypesPage'
import { PortsPage } from './pages/masterdata/PortsPage'
import { ContainerPage } from './pages/logistics/ContainerPage'
import { ContainersPage } from './pages/logistics/ContainersPage'
import { ContainerChargesPage } from './pages/logistics/ContainerChargesPage'
import { MovementPage } from './pages/logistics/MovementPage'
import { MovementsPage } from './pages/logistics/MovementsPage'
import { TrackingPage } from './pages/logistics/TrackingPage'
import { MovementTypesPage } from './pages/masterdata/MovementTypesPage'
import { PaymentMethodsPage } from './pages/masterdata/PaymentMethodsPage'
import { CashBankAccountsPage } from './pages/masterdata/CashBankAccountsPage'
import { ChargeTypesPage } from './pages/purchase/ChargeTypesPage'
import { LandedCostAdjustmentPage } from './pages/purchase/LandedCostAdjustmentPage'
import { LandedCostAdjustmentsPage } from './pages/purchase/LandedCostAdjustmentsPage'
import { PurchaseDocumentPage } from './pages/purchase/PurchaseDocumentPage'
import { PurchaseDocumentsPage } from './pages/purchase/PurchaseDocumentsPage'
import { ImportSalesPage } from './pages/sales/ImportSalesPage'
import { SalesInvoicePage } from './pages/sales/SalesInvoicePage'
import { CustomerStatementPage } from './pages/sales/CustomerStatementPage'
import { CustomerStatementPrintPage } from './pages/sales/CustomerStatementPrintPage'
import { ReceiptPage } from './pages/sales/ReceiptPage'
import { ReceiptPrintPage } from './pages/sales/ReceiptPrintPage'
import { ReceiptsPage } from './pages/sales/ReceiptsPage'
import { SalesInvoicesPage } from './pages/sales/SalesInvoicesPage'
import { SalesProfitPage } from './pages/sales/SalesProfitPage'
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
            {/* The plan on paper: outside the shell, so nothing but the document reaches the printer. */}
            <Route element={<ProtectedRoute permission={PERMISSIONS.shortagesView} />}>
              <Route path="/inventory/shortages/:id/print" element={<ShortagePrintPage />} />
            </Route>

            {/* Receipts and statements on paper: outside the shell, like the shortage plan. */}
            <Route element={<ProtectedRoute permission={PERMISSIONS.receiptsView} />}>
              <Route path="/sales/receipts/:id/print" element={<ReceiptPrintPage />} />
              <Route path="/sales/receipts/statement/print" element={<CustomerStatementPrintPage />} />
            </Route>

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
              <Route element={<ProtectedRoute permission={PERMISSIONS.containerTypesManage} />}>
                <Route path="/setup/master-data/container-types" element={<ContainerTypesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.portsManage} />}>
                <Route path="/setup/master-data/ports" element={<PortsPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.attachmentTypesManage} />}>
                <Route path="/setup/master-data/attachment-types" element={<AttachmentTypesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.movementTypesManage} />}>
                <Route path="/setup/master-data/movement-types" element={<MovementTypesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.paymentMethodsManage} />}>
                <Route path="/setup/master-data/payment-methods" element={<PaymentMethodsPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.cashBankAccountsManage} />}>
                <Route path="/setup/master-data/cash-bank-accounts" element={<CashBankAccountsPage />} />
              </Route>

              <Route element={<ProtectedRoute permission={PERMISSIONS.containersCreate} />}>
                <Route path="/logistics/containers/new" element={<ContainerPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.containersView} />}>
                <Route path="/logistics/containers" element={<ContainersPage />} />
                <Route path="/logistics/containers/:id" element={<ContainerPage />} />
                <Route path="/logistics/movements" element={<MovementsPage />} />
                <Route path="/logistics/movements/:id" element={<MovementPage />} />
                <Route path="/logistics/tracking" element={<TrackingPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.movementsManage} />}>
                <Route path="/logistics/movements/new" element={<MovementPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.containerChargesView} />}>
                <Route path="/logistics/container-charges" element={<ContainerChargesPage />} />
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
              {/* What the shelves are worth: the item list with its money shown, so it is guarded
                  by the item permission rather than one of its own. */}
              <Route element={<ProtectedRoute permission={PERMISSIONS.itemsView} />}>
                <Route path="/inventory/valuation" element={<StockValuationPage />} />
              </Route>
              {/* Shortage plans: the list and the document sit behind the view permission; "new" needs
                  the create one as well, so a reader who may only look never reaches a blank plan. */}
              <Route element={<ProtectedRoute permission={PERMISSIONS.shortagesCreate} />}>
                <Route path="/inventory/shortages/new" element={<ShortageDocumentPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.shortagesView} />}>
                <Route path="/inventory/shortages" element={<ShortagesPage />} />
                <Route path="/inventory/shortages/:id" element={<ShortageDocumentPage />} />
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

              {/* Charge types are setup — one permission for the lot. Landed cost adjustments are
                  documents: the list and the document sit behind the view permission, and creating,
                  posting, cancelling and deleting are checked on the page (and by the API). */}
              <Route element={<ProtectedRoute permission={PERMISSIONS.chargeTypesManage} />}>
                <Route path="/purchase/charge-types" element={<ChargeTypesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.landedCostsCreate} />}>
                <Route path="/purchase/landed-cost-adjustments/new" element={<LandedCostAdjustmentPage />} />
              </Route>
              <Route element={<ProtectedRoute permission={PERMISSIONS.landedCostsView} />}>
                <Route path="/purchase/landed-cost-adjustments" element={<LandedCostAdjustmentsPage />} />
                <Route path="/purchase/landed-cost-adjustments/:id" element={<LandedCostAdjustmentPage />} />
              </Route>

              {/* Net sales less the cost frozen on each line, behind its own permission. */}
              <Route element={<ProtectedRoute permission={PERMISSIONS.salesProfitView} />}>
                <Route path="/sales/profit" element={<SalesProfitPage />} />
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
              {/* Customer receipts: list and document behind the view permission; saving, posting,
                  reversing and allocating are checked on the page (and by the API). */}
              <Route element={<ProtectedRoute permission={PERMISSIONS.receiptsView} />}>
                <Route path="/sales/receipts" element={<ReceiptsPage />} />
                <Route path="/sales/receipts/statement" element={<CustomerStatementPage />} />
                <Route path="/sales/receipts/new" element={<ReceiptPage />} />
                <Route path="/sales/receipts/:id" element={<ReceiptPage />} />
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

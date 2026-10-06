// Mirrors the DTOs in Inventory_Shipment.Model (serialized as camelCase JSON by the API).

export interface UserDto {
  id: number
  username: string
  email: string
  fullName: string
  /** Names of the roles the user holds. */
  roles: string[]
  /** Ids of those roles - what the role editor posts back. */
  roleIds: number[]
  /** Flattened permission codes granted by those roles. */
  permissions: string[]
  isActive: boolean
  lastLoginAtUtc: string | null
  createdAtUtc: string
}

/**
 * A user as it appears in a dropdown - id, username, full name and status, nothing else. Readable
 * by any signed-in user, because forms that link a record to the user it belongs to need it.
 */
export interface UserLookupDto {
  id: number
  username: string
  fullName: string
  isActive: boolean
}

export interface LoginRequest {
  username: string
  password: string
}

export interface AuthResponse {
  tokenType: string
  accessToken: string
  accessTokenExpiresAtUtc: string
  refreshToken: string
  refreshTokenExpiresAtUtc: string
  user: UserDto
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

export interface CreateUserRequest {
  username: string
  email: string
  fullName: string
  password: string
  roleIds: number[]
}

export interface UpdateUserRequest {
  fullName: string
  email: string
}

export interface SetUserRolesRequest {
  roleIds: number[]
}

// ----- roles & permissions -----

export interface RoleDto {
  id: number
  name: string
  description: string | null
  /** System roles always hold every permission and cannot be renamed, deactivated or deleted. */
  isSystem: boolean
  isActive: boolean
  userCount: number
  permissionCount: number
  createdAtUtc: string
}

export interface RoleDetailDto extends RoleDto {
  permissionIds: number[]
  permissions: PermissionDto[]
}

export interface CreateRoleRequest {
  name: string
  description: string | null
  permissionIds: number[]
}

export interface UpdateRoleRequest {
  name: string
  description: string | null
  isActive: boolean
}

export interface SetRolePermissionsRequest {
  permissionIds: number[]
}

export interface PermissionDto {
  id: number
  code: string
  name: string
  module: string
  description: string | null
  sortOrder: number
  /** Names of the roles that hold this permission. */
  roles: string[]
}

export interface PermissionModuleDto {
  module: string
  permissions: PermissionDto[]
}

// ----- login audit -----

export interface LoginAuditDto {
  id: number
  username: string
  userId: number | null
  succeeded: boolean
  failureReason: string | null
  ipAddress: string | null
  userAgent: string | null
  attemptedAtUtc: string
}

export interface LoginAuditQuery {
  username?: string
  onlyFailed?: boolean
  take?: number
}

/** RFC 9457 problem details as returned by the API on every error. */
export interface ProblemDetails {
  type?: string
  title?: string
  status?: number
  detail?: string
  instance?: string
  traceId?: string
  /** ASP.NET model validation uses an object (field -> messages); the service layer uses a plain list. */
  errors?: Record<string, string[]> | string[]
  /** Machine-readable reason for the failure, e.g. DUPLICATE_CODE or MAIN_BRANCH_EXISTS. */
  code?: string
  /** Extra payload that goes with the code, e.g. { currentMainBranch: BranchDto }. */
  data?: unknown
}

// ----- master data: branches / sites -----

export interface BranchDto {
  id: number
  branchCode: string
  branchName: string
  address: string | null
  isMainBranch: boolean
  isActive: boolean
  createdAtUtc: string
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** Body of both POST (create) and PUT (update). */
export interface SaveBranchRequest {
  branchCode: string
  branchName: string
  address?: string | null
  isMainBranch: boolean
  isActive: boolean
  /** Confirms taking the Main Branch flag away from the branch that currently holds it. */
  replaceMainBranch: boolean
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export interface SetBranchStatusRequest {
  isActive: boolean
}

export type BranchSortBy = 'BranchCode' | 'BranchName' | 'Address' | 'IsMainBranch' | 'IsActive' | 'CreatedAtUtc'

export interface BranchQuery {
  search?: string
  isActive?: boolean
  isMainBranch?: boolean
  sortBy?: BranchSortBy
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/** One page of a server-side paged list. */
export interface PagedResult<T> {
  items: T[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasNext: boolean
  hasPrevious: boolean
}

// ----- master data: warehouses -----

export interface WarehouseDto {
  id: number
  warehouseCode: string
  warehouseName: string
  branchId: number
  branchCode: string
  branchName: string
  address: string | null
  /** The warehouse this one stands under; null for a root. */
  parentId: number | null
  parentCode: string | null
  parentName: string | null
  /** Depth in the tree, 1 for a root. */
  level: number
  /** Warehouses directly under this one. 0 means a leaf - and stock lives on the leaves. */
  childCount: number
  isMainWarehouse: boolean
  isActive: boolean
  /** Sales invoices selling more than it holds: true allows (after a warning), false refuses, null follows the global setting. */
  allowOutOfStockOverride: boolean | null
  createdAtUtc: string
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** Body of both POST (create) and PUT (update). */
export interface SaveWarehouseRequest {
  warehouseCode: string
  warehouseName: string
  branchId: number
  address?: string | null
  /** The warehouse this one stands under; null makes it a root. It need not share the branch. */
  parentId?: number | null
  isMainWarehouse: boolean
  isActive: boolean
  /** Confirms taking the Main Warehouse flag away from the warehouse that currently holds it. */
  replaceMainWarehouse: boolean
  /** True allows selling out-of-stock items from this warehouse, false refuses, null follows the global setting. */
  allowOutOfStockOverride?: boolean | null
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export interface SetWarehouseStatusRequest {
  isActive: boolean
}

export type WarehouseSortBy =
  'WarehouseCode' | 'WarehouseName' | 'BranchName' | 'Address' | 'IsMainWarehouse' | 'IsActive' | 'CreatedAtUtc'

export interface WarehouseQuery {
  search?: string
  branchId?: number
  isActive?: boolean
  isMainWarehouse?: boolean
  sortBy?: WarehouseSortBy
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/** A branch / site as it appears in a dropdown. */
export interface BranchLookupDto {
  id: number
  branchCode: string
  branchName: string
  isMainBranch: boolean
  isActive: boolean
}

/** A warehouse as it appears in a dropdown. */
export interface WarehouseLookupDto {
  id: number
  warehouseCode: string
  warehouseName: string
  branchId: number
  branchCode: string
  branchName: string
  isMainWarehouse: boolean
  isActive: boolean
  /** The tree, so a picker can draw it and offer only the leaves that may hold stock. */
  parentId: number | null
  level: number
  childCount: number
}

// ----- master data: currencies -----

export interface CurrencyDto {
  id: number
  /** ISO 4217, always three upper-case letters. */
  currencyCode: string
  currencyName: string
  symbol: string | null
  /** Digits after the decimal separator (0-6); 0 for currencies without cents. */
  decimalPlaces: number
  /** Exactly one active currency carries this: amounts are stored and reported in it. */
  isBaseCurrency: boolean
  isActive: boolean
  createdAtUtc: string
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** Body of both POST (create) and PUT (update). */
export interface SaveCurrencyRequest {
  currencyCode: string
  currencyName: string
  symbol?: string | null
  decimalPlaces: number
  isBaseCurrency: boolean
  isActive: boolean
  /** Confirms taking the base currency flag away from the currency that currently holds it. */
  replaceBaseCurrency: boolean
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export interface SetCurrencyStatusRequest {
  isActive: boolean
}

export type CurrencySortBy =
  'CurrencyCode' | 'CurrencyName' | 'DecimalPlaces' | 'IsBaseCurrency' | 'IsActive' | 'CreatedAtUtc'

export interface CurrencyQuery {
  search?: string
  isActive?: boolean
  isBaseCurrency?: boolean
  sortBy?: CurrencySortBy
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/** A currency as it appears in a dropdown (the base currency comes first). */
export interface CurrencyLookupDto {
  id: number
  currencyCode: string
  currencyName: string
  symbol: string | null
  decimalPlaces: number
  isBaseCurrency: boolean
  isActive: boolean
}

/** The payload behind the BASE_CURRENCY_EXISTS error code. */
export interface CurrentBaseCurrency {
  id: number
  currencyCode: string
  currencyName: string
}

// ----- master data: exchange rates -----

/** 1 = Official (central bank), 2 = NonOfficial (parallel), 3 = Market. The API exchanges the names. */
export type RateType = 'Official' | 'NonOfficial' | 'Market'

/**
 * One exchange rate: 1 unit of the BASE currency equals `rate` units of `currencyCode` on `rateDate`.
 * The base currency never has rates - its rate is 1 by definition.
 */
export interface ExchangeRateDto {
  id: number
  currencyId: number
  currencyCode: string
  currencyName: string
  symbol: string | null
  /** Decimal places of the quoted currency - what the rate is formatted with. */
  decimalPlaces: number
  rateType: RateType
  /** The effective date as "yyyy-MM-dd". */
  rateDate: string
  rate: number
  notes: string | null
  createdAtUtc: string
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** Body of both POST (create) and PUT (update). */
export interface SaveExchangeRateRequest {
  currencyId: number
  rateType: RateType
  /** "yyyy-MM-dd"; the API refuses a future date. */
  rateDate: string
  rate: number
  notes?: string | null
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export type ExchangeRateSortBy = 'RateDate' | 'CurrencyCode' | 'RateType' | 'Rate' | 'CreatedAtUtc'

export interface ExchangeRateQuery {
  currencyId?: number
  rateType?: RateType
  /** "yyyy-MM-dd". */
  dateFrom?: string
  /** "yyyy-MM-dd". */
  dateTo?: string
  sortBy?: ExchangeRateSortBy
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

// ----- master data: item families -----

/**
 * One node of the item family tree. The tree endpoint returns EVERY family as a flat list in this
 * shape, ordered by level then code; the page nests them itself through `parentId`. There is no
 * server paging on purpose - paging cannot work on a tree.
 */
export interface ItemFamilyDto {
  id: number
  /** Null for a root family. */
  parentId: number | null
  /** Globally unique and stable - moving a family never renames it. */
  familyCode: string
  familyName: string
  description: string | null
  /** Depth in the tree, 1 for a root. */
  level: number
  isActive: boolean
  /** Direct children only; 0 means the row is a leaf. */
  childCount: number
  createdAtUtc: string
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** Body of both POST (create) and PUT (update). */
export interface SaveItemFamilyRequest {
  familyCode: string
  familyName: string
  /** Null creates (or moves the family to) a root. */
  parentId?: number | null
  description?: string | null
  isActive: boolean
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export interface SetItemFamilyStatusRequest {
  isActive: boolean
}

/** An item family as it appears in a dropdown; indent the label by `level`. */
export interface ItemFamilyLookupDto {
  id: number
  parentId: number | null
  familyCode: string
  familyName: string
  level: number
  isActive: boolean
}

/** A code the API suggests for a record about to be created. Only a suggestion - it stays editable. */
export interface NextCodeDto {
  suggestedCode: string
}

// ----- master data: brands -----

export interface BrandDto {
  id: number
  brandCode: string
  brandName: string
  description: string | null
  isActive: boolean
  createdAtUtc: string
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** Body of both POST (create) and PUT (update). */
export interface SaveBrandRequest {
  brandCode: string
  brandName: string
  description?: string | null
  isActive: boolean
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export interface SetBrandStatusRequest {
  isActive: boolean
}

export type BrandSortBy = 'BrandCode' | 'BrandName' | 'IsActive' | 'CreatedAtUtc'

export interface BrandQuery {
  search?: string
  isActive?: boolean
  sortBy?: BrandSortBy
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/** A brand as it appears in a dropdown (the Items page's Brand picker). */
export interface BrandLookupDto {
  id: number
  brandCode: string
  brandName: string
  isActive: boolean
}

// ----- master data: price lists -----

export interface PriceListDto {
  id: number
  priceListCode: string
  priceListName: string
  currencyId: number
  currencyCode: string
  currencyName: string
  decimalPlaces: number
  description: string | null
  isActive: boolean
  /** Prices held by the list. Non-zero locks the currency and blocks deletion. */
  priceCount: number
  createdAtUtc: string
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** Body of both POST (create) and PUT (update). */
export interface SavePriceListRequest {
  priceListCode: string
  priceListName: string
  currencyId: number
  description?: string | null
  isActive: boolean
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export interface SetPriceListStatusRequest {
  isActive: boolean
}

export type PriceListSortBy =
  'PriceListCode' | 'PriceListName' | 'CurrencyCode' | 'IsActive' | 'CreatedAtUtc'

export interface PriceListQuery {
  search?: string
  currencyId?: number
  isActive?: boolean
  sortBy?: PriceListSortBy
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/** A price list as it appears in a dropdown, with the currency its prices are expressed in. */
export interface PriceListLookupDto {
  id: number
  priceListCode: string
  priceListName: string
  currencyId: number
  currencyCode: string
  symbol: string | null
  decimalPlaces: number
  isActive: boolean
}

// ----- master data: unit types -----

export interface UnitTypeDto {
  id: number
  unitTypeName: string
  isActive: boolean
  createdAtUtc: string
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** Body of both POST (create) and PUT (update). */
export interface SaveUnitTypeRequest {
  unitTypeName: string
  isActive: boolean
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export type UnitTypeSortBy = 'UnitTypeName' | 'IsActive' | 'CreatedAtUtc'

export interface UnitTypeQuery {
  search?: string
  isActive?: boolean
  sortBy?: UnitTypeSortBy
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/** A unit type as it appears in a dropdown (the item's Units & Packaging picker). */
export interface UnitTypeLookupDto {
  id: number
  unitTypeName: string
  isActive: boolean
}

// ----- inventory: item definition -----

/** One row of the Item Definition list. */
export interface ItemListDto {
  id: number
  itemCode: string
  itemName: string
  brandId: number
  brandName: string
  model: string | null
  itemFamilyId: number
  familyCode: string
  familyName: string
  /** ISO 3166-1 alpha-2, e.g. "IN". */
  countryOfOrigin: string
  defaultWarehouseId: number
  warehouseCode: string
  warehouseName: string
  /** Unit type of the base unit; null while the item has no unit yet. */
  baseUnitName: string | null
  baseUnitSku: string | null
  /** Base units across every warehouse, from the stock ledger. */
  onHand: number
  /** The moving average cost per base unit, kept on the item. */
  averageCost: number | null
  /** What the last purchase LANDED at, per base unit. */
  lastCost: number | null
  /** What the supplier charged on the last posted invoice, before the charges around it. */
  fobCost: number | null
  /** On hand × average cost, in the base currency. */
  inventoryValue: number
  defaultSupplierId: number | null
  defaultSupplierName: string | null
  isBivac: boolean
  isActive: boolean
  createdAtUtc: string
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** An item with its units and the metadata of its files - what the details page reads. */
export interface ItemDetailsDto {
  id: number
  itemCode: string
  itemName: string
  brandId: number
  brandName: string
  model: string | null
  itemFamilyId: number
  familyCode: string
  familyName: string
  countryOfOrigin: string
  defaultWarehouseId: number
  warehouseCode: string
  warehouseName: string
  description: string | null
  warrantyMonths: number | null
  minQuantity: number
  maxQuantity: number | null
  isBivac: boolean
  isActive: boolean
  onHand: number
  /** What the last posted purchase LANDED at, per base unit. An Inventory In does not touch it. */
  lastCost: number | null
  /** The moving average cost per base unit, kept on the item by every posting that adds stock. What a sale is costed at. */
  averageCost: number | null
  /** What the supplier charged per base unit on the last posted invoice, before freight, customs and the rest. */
  fobCost: number | null
  /** On hand × average cost, in the base currency. */
  inventoryValue: number
  lastPurchaseCost: number | null
  /** The supplier a purchase order is raised on by default. */
  defaultSupplierId: number | null
  defaultSupplierCode: string | null
  defaultSupplierName: string | null
  /** Days between ordering and receiving. */
  leadTimeDays: number | null
  /** Pieces (base units) that fit in one container — the default of a shortage plan line. Only the item's own GET returns it. */
  pcPerContainer?: number | null
  /** Per BASE unit. What a charge allocated by weight is shared out on. */
  weightKg?: number | null
  /** Per BASE unit, in cubic metres. The same, for a charge allocated by volume. */
  volumeCbm?: number | null
  lastSupplierId: number | null
  lastSupplierName: string | null
  lastPurchaseAtUtc: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
  /** Base unit first, then the packing units ordered by formula. */
  units: ItemUnitDto[]
  /** The item image (when present) first, then the attachments, newest first. */
  files: ItemFileDto[]
}

/** One packing unit of an item. Exactly one unit is the base and its formula is 1. */
export interface ItemUnitDto {
  id: number
  itemId: number
  unitTypeId: number
  unitTypeName: string
  /** How many base units this unit holds; 1 for the base unit itself. */
  packingFormula: number
  skuCode: string
  barcode: string | null
  isSalesUnit: boolean
  isPurchaseUnit: boolean
  isBaseUnit: boolean
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** Metadata of one item file; the bytes come from the download endpoint. */
export interface ItemFileDto {
  id: number
  itemId: number
  fileName: string
  contentType: string
  sizeBytes: number
  /** True for the single item image; false for an ordinary attachment. */
  isItemImage: boolean
  createdAtUtc: string
}

/** Body of both POST (create) and PUT (update) on an item. */
export interface SaveItemRequest {
  itemCode: string
  itemName: string
  brandId: number
  model?: string | null
  itemFamilyId: number
  /** ISO 3166-1 alpha-2; the API stores it upper-case. */
  countryOfOrigin: string
  defaultWarehouseId: number
  description?: string | null
  warrantyMonths?: number | null
  minQuantity: number
  maxQuantity?: number | null
  isBivac: boolean
  isActive: boolean
  /** The supplier a purchase order is raised on by default. */
  defaultSupplierId?: number | null
  /** Days between ordering and receiving. */
  leadTimeDays?: number | null
  /** Pieces (base units) per container; null clears it. */
  pcPerContainer?: number | null
  /** Per BASE unit; needed by charges allocated by weight. */
  weightKg?: number | null
  /** Per BASE unit, in cubic metres; needed by charges allocated by volume. */
  volumeCbm?: number | null
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

/** Body of both POST (add) and PUT (edit) on an item unit. */
export interface SaveItemUnitRequest {
  unitTypeId: number
  packingFormula: number
  skuCode: string
  barcode?: string | null
  isSalesUnit: boolean
  isPurchaseUnit: boolean
  isBaseUnit: boolean
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export interface SetItemStatusRequest {
  isActive: boolean
}

export type ItemSortBy =
  'ItemCode' | 'ItemName' | 'BrandName' | 'FamilyName' | 'WarehouseName' | 'OnHand' | 'IsActive' | 'CreatedAtUtc'

export interface ItemQuery {
  /** Matches item code, item name, or the SKU / barcode of any of the item's units. */
  search?: string
  /** Matches the family AND its whole subtree. */
  itemFamilyId?: number
  brandId?: number
  defaultWarehouseId?: number
  isActive?: boolean
  isBivac?: boolean
  sortBy?: ItemSortBy
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/** An item as it appears in a dropdown. */
export interface ItemLookupDto {
  id: number
  itemCode: string
  itemName: string
  baseUnitSku: string | null
  isActive: boolean
}

// ----- master data: parties -----

/**
 * The role a party plays, when exactly one has to be named - the list filter, a typed dropdown, the
 * code the server suggests. A party itself carries the four flags below and may hold several.
 */
export type PartyTypeName = 'Supplier' | 'Client' | 'Salesman' | 'Employee'

/**
 * A party: the one master behind suppliers, clients, salesmen and employees. The type flags are
 * independent, so the same company can be a supplier and a client without being entered twice.
 * The `*Name` / `*Code` fields are joined in by the API and are read-only.
 */
export interface PartyDto {
  id: number
  partyCode: string
  partyName: string
  isSupplier: boolean
  isClient: boolean
  isSalesman: boolean
  isEmployee: boolean
  branchId: number | null
  branchCode: string | null
  branchName: string | null
  contactPerson: string | null
  phone: string | null
  mobile: string | null
  email: string | null
  address: string | null
  /** ISO 3166-1 alpha-2 country code, e.g. "IN". */
  country: string | null
  taxRegistrationNo: string | null
  notes: string | null
  /** The application user this party signs in as (salesman / employee). */
  userId: number | null
  userName: string | null
  userFullName: string | null
  /** The price list pre-filled on this party's invoices; editable there. Any party type may have one. */
  defaultPriceListId: number | null
  defaultPriceListName: string | null
  defaultCurrencyId: number | null
  defaultCurrencyCode: string | null
  isActive: boolean
  createdAtUtc: string
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; send it back on update so concurrent edits are detected. */
  rowVersion: string
}

/** Body of both POST (create) and PUT (update). At least one type flag must be set. */
export interface SavePartyRequest {
  partyCode: string
  partyName: string
  isSupplier: boolean
  isClient: boolean
  isSalesman: boolean
  isEmployee: boolean
  branchId: number | null
  contactPerson: string | null
  phone: string | null
  mobile: string | null
  email: string | null
  address: string | null
  country: string | null
  taxRegistrationNo: string | null
  notes: string | null
  userId: number | null
  defaultPriceListId: number | null
  defaultCurrencyId: number | null
  isActive: boolean
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export interface SetPartyStatusRequest {
  isActive: boolean
}

export type PartySortBy =
  'PartyCode' | 'PartyName' | 'BranchName' | 'Email' | 'Phone' | 'IsActive' | 'CreatedAtUtc'

export interface PartyQuery {
  /** Matches party code, name, phone, mobile or e-mail. */
  search?: string
  /** Keeps only the parties carrying that type; omitted means every party. */
  partyType?: PartyTypeName
  branchId?: number
  isActive?: boolean
  sortBy?: PartySortBy
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/** A party as it appears in a typed dropdown, with what choosing it should default to. */
export interface PartyLookupDto {
  id: number
  partyCode: string
  partyName: string
  isSupplier: boolean
  isClient: boolean
  isSalesman: boolean
  isEmployee: boolean
  branchId: number | null
  defaultPriceListId: number | null
  defaultCurrencyId: number | null
  userId: number | null
  isActive: boolean
  /** The address as Parties holds it, so a document header can show it. */
  address: string | null
}

/** One item's stock in one warehouse that has held it (zero included). */
export interface ItemStockBalanceRowDto {
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  warehouseIsActive: boolean
  branchId: number
  branchCode: string
  branchName: string
  /** Base units; negative when out-of-stock selling took it below zero. */
  onHandBase: number
  lastMovementAtUtc: string | null
  averageCost: number | null
  inventoryValue: number
}

/** The item card's Stock Balance: the item, its stock per warehouse and the totals. */
export interface ItemStockBalanceDto {
  itemId: number
  itemCode: string
  itemName: string
  warehouses: ItemStockBalanceRowDto[]
  totalOnHandBase: number
  totalInventoryValue: number
}

/** One movement on an item's stock statement, with the balance after it. */
export interface ItemStockMovementDto {
  id: number
  movementDate: string
  /** Inventory | Sales | Purchase - with the type and id, what the row links to. */
  documentFamily: string
  documentTypeCode: string
  documentTypeName: string | null
  documentId: number
  documentNumber: string | null
  /** The movement written back when its document was cancelled. */
  isReversal: boolean
  reasonCode: string | null
  expiryDate: string | null
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  branchName: string
  quantityIn: number
  quantityOut: number
  balance: number
  unitCostBase: number | null
  /** The client of a sale or the supplier of a purchase. */
  counterparty: string | null
  createdByName: string | null
}

/** An item's stock statement: brought forward, the movements, and what is left. */
export interface ItemStockStatementDto {
  itemId: number
  itemCode: string
  itemName: string
  openingBase: number
  totalIn: number
  totalOut: number
  closingBase: number
  movements: ItemStockMovementDto[]
}

/** One purchase order with the item on it, and what it asks for of that item. */
export interface ItemPurchaseOrderDto {
  documentId: number
  documentNumber: string | null
  documentDate: string
  expectedDate: string | null
  statusCode: number
  /** Draft | PendingApproval | Posted | Closed | Cancelled. */
  status: string
  supplierCode: string
  supplierName: string
  branchName: string
  currencyCode: string
  decimalPlaces: number
  orderedBase: number
  receivedBase: number
  /** Still to come: on an open (Posted) order only. */
  outstandingBase: number
  amount: number
}

/** The item card's Purchase Orders: the orders it is on and what is still on order. */
export interface ItemPurchaseOrdersDto {
  itemId: number
  itemCode: string
  itemName: string
  openOrders: number
  outstandingBase: number
  orderedBase: number
  receivedBase: number
  orders: ItemPurchaseOrderDto[]
}

/** One container carrying the item, and how much of it it holds. */
export interface ItemContainerDto {
  containerId: number
  containerRef: string
  containerNo: string | null
  /** 1 Draft ... 8 Cancelled - see containerStatusLabel. */
  statusCode: number
  containerTypeName: string | null
  orderDate: string | null
  dispatchDate: string | null
  eta: string | null
  offloadedDate: string | null
  branchName: string | null
  warehouseName: string | null
  purchaseOrderId: number | null
  purchaseOrderNumber: string | null
  loadedBase: number
  receivedBase: number
  /** Loaded less received, from Confirmed to Cleared only. */
  onTheWayBase: number
}

/** The item card's Containers: the containers carrying it and what is on the way. */
export interface ItemContainersDto {
  itemId: number
  itemCode: string
  itemName: string
  containersOnTheWay: number
  onTheWayBase: number
  loadedBase: number
  receivedBase: number
  containers: ItemContainerDto[]
}

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
  isMainWarehouse: boolean
  isActive: boolean
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
  isMainWarehouse: boolean
  isActive: boolean
  /** Confirms taking the Main Warehouse flag away from the warehouse that currently holds it. */
  replaceMainWarehouse: boolean
  /** Required on update to detect concurrent edits. */
  rowVersion?: string | null
}

export interface SetWarehouseStatusRequest {
  isActive: boolean
}

export type WarehouseSortBy =
  | 'WarehouseCode'
  | 'WarehouseName'
  | 'BranchName'
  | 'Address'
  | 'IsMainWarehouse'
  | 'IsActive'
  | 'CreatedAtUtc'

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
  | 'CurrencyCode'
  | 'CurrencyName'
  | 'DecimalPlaces'
  | 'IsBaseCurrency'
  | 'IsActive'
  | 'CreatedAtUtc'

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

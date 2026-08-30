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

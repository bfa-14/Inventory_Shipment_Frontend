/**
 * The Role Permissions route and the query parameter that opens it on a particular role.
 *
 * One module owns both, so the page reading the parameter and the pages linking to it cannot drift
 * apart over its name.
 */
export const ROLE_PERMISSIONS_PATH = '/security/role-permissions'

export const ROLE_PARAM = 'roleId'

export function rolePermissionsRoute(roleId?: number): string {
  return roleId === undefined ? ROLE_PERMISSIONS_PATH : `${ROLE_PERMISSIONS_PATH}?${ROLE_PARAM}=${roleId}`
}

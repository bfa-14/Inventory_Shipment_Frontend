export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function initials(name: string | undefined): string {
  return (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

/** "BR-001 - Head Office", with a marker when the branch is no longer active. */
export function branchLabel(branch: { branchCode: string; branchName: string; isActive: boolean }): string {
  return `${branch.branchCode} - ${branch.branchName}${branch.isActive ? '' : ' (inactive)'}`
}

import type { ItemFamilyDto } from '../../api/types'

/**
 * Helpers for the Item Families tree. The API sends every family as one flat list, so the shape a
 * page needs - who the children are, who the ancestors are, what order the rows come in - is worked
 * out here once and shared by the page and its form modal.
 *
 * Every walk is a loop over an explicit stack rather than a recursive call: the tree has no depth
 * limit, and a family that is its own ancestor (which the API forbids, but a stale reload could
 * still show) must slow the page down, not blow the stack.
 */

/** Key standing in for "no parent" in {@link FamilyIndex.childrenOf} - real ids start at 1. */
const ROOT = 0

export interface FamilyIndex {
  /** Every family by id. */
  byId: Map<number, ItemFamilyDto>
  /** Direct children of a family, sorted by code; the roots live under {@link ROOT}. */
  childrenOf: Map<number, ItemFamilyDto[]>
  /** The families with no parent, sorted by code. */
  roots: ItemFamilyDto[]
}

export function indexFamilies(families: ItemFamilyDto[]): FamilyIndex {
  const byId = new Map<number, ItemFamilyDto>()
  const childrenOf = new Map<number, ItemFamilyDto[]>()

  for (const family of families) byId.set(family.id, family)

  for (const family of families) {
    const key = family.parentId ?? ROOT
    const siblings = childrenOf.get(key)
    if (siblings) siblings.push(family)
    else childrenOf.set(key, [family])
  }

  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => a.familyCode.localeCompare(b.familyCode))
  }

  return { byId, childrenOf, roots: childrenOf.get(ROOT) ?? [] }
}

export function childrenOf(index: FamilyIndex, id: number): ItemFamilyDto[] {
  return index.childrenOf.get(id) ?? []
}

/** Every family below this one, at any depth. */
export function descendants(index: FamilyIndex, id: number): ItemFamilyDto[] {
  const found: ItemFamilyDto[] = []
  const seen = new Set<number>([id])
  const stack = [...childrenOf(index, id)]

  while (stack.length > 0) {
    const family = stack.pop() as ItemFamilyDto
    if (seen.has(family.id)) continue
    seen.add(family.id)
    found.push(family)
    stack.push(...childrenOf(index, family.id))
  }

  return found
}

/** The family's ancestors, nearest parent first. */
export function ancestors(index: FamilyIndex, id: number): ItemFamilyDto[] {
  const chain: ItemFamilyDto[] = []
  const seen = new Set<number>([id])

  let parentId = index.byId.get(id)?.parentId ?? null
  while (parentId !== null && !seen.has(parentId)) {
    const parent = index.byId.get(parentId)
    if (!parent) break
    seen.add(parent.id)
    chain.push(parent)
    parentId = parent.parentId
  }

  return chain
}

/**
 * The rows of the tree, depth-first, in the order they are drawn. `isExpanded` decides whether a
 * family's children follow it; `keep`, when given, restricts the walk to that set of ids and starts
 * from every kept family whose parent is not kept (so a filtered view can begin part-way down).
 */
export function flattenTree(
  index: FamilyIndex,
  isExpanded: (id: number) => boolean,
  keep?: ReadonlySet<number>,
): ItemFamilyDto[] {
  const included = (family: ItemFamilyDto) => !keep || keep.has(family.id)

  const tops = keep
    ? [...index.byId.values()]
        .filter((f) => keep.has(f.id) && (f.parentId === null || !keep.has(f.parentId)))
        .sort((a, b) => a.familyCode.localeCompare(b.familyCode))
    : index.roots

  const rows: ItemFamilyDto[] = []
  const seen = new Set<number>()
  // Reversed, because the stack is popped from the end and siblings must keep their order.
  const stack = [...tops].reverse()

  while (stack.length > 0) {
    const family = stack.pop() as ItemFamilyDto
    if (seen.has(family.id)) continue
    seen.add(family.id)
    rows.push(family)

    if (isExpanded(family.id)) {
      const children = childrenOf(index, family.id).filter(included)
      for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i] as ItemFamilyDto)
    }
  }

  return rows
}

/** The label a family carries in a parent dropdown: one dash per level below the root. */
export function parentOptionLabel(family: ItemFamilyDto): string {
  const indent = '— '.repeat(Math.max(0, family.level - 1))
  return `${indent}${family.familyName}${family.isActive ? '' : ' (inactive)'}`
}

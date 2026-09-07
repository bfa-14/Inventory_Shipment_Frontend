import type { PartyDto, PartyTypeName } from '../../api/types'

/** One of the four roles a party can play, with the colour its badge wears everywhere. */
export interface PartyTypeMeta {
  value: PartyTypeName
  label: string
  color: string
  /** The flag on the party that says it plays this role. */
  flag: 'isSupplier' | 'isClient' | 'isSalesman' | 'isEmployee'
}

/**
 * The four types, in the order the list and the form show them. One table so the badge in a grid
 * cell, the checkbox in the form and the dropdown in the filter bar cannot drift apart.
 */
export const PARTY_TYPES: readonly PartyTypeMeta[] = [
  { value: 'Supplier', label: 'Supplier', color: 'blue', flag: 'isSupplier' },
  { value: 'Client', label: 'Client', color: 'green', flag: 'isClient' },
  { value: 'Salesman', label: 'Salesman', color: 'orange', flag: 'isSalesman' },
  { value: 'Employee', label: 'Employee', color: 'violet', flag: 'isEmployee' },
]

/** The types a party actually carries, in the canonical order above. */
export function partyTypesOf(party: Pick<PartyDto, PartyTypeMeta['flag']>): PartyTypeMeta[] {
  return PARTY_TYPES.filter((type) => party[type.flag])
}

import { containersApi } from '../../api/logistics/containers'
import { movementsApi } from '../../api/logistics/movements'
import { partiesApi } from '../../api/masterdata/parties'
import { purchaseDocumentsApi, type PurchaseDocumentListDto } from '../../api/purchase/documents'
import type { SearchOption, SearchOptionsLoader } from '../ui/SearchSelect'

/*
 * THE LOADERS OF THE SERVER-SEARCHED DROPDOWNS (components/ui/SearchSelect) for the lists without a ceiling: orders,
 * invoices, containers, movements, suppliers. Each asks the server for the first matches of what is typed, where the
 * dropdowns used to hold a preloaded page of the 200 newest (script 78: any number of containers).
 */

const FIRST_MATCHES = 50

/** For a reader without the list's permission: the filter offers nothing, and nothing is asked (no 403 in the console). */
export const loadNothing: SearchOptionsLoader = async () => []

function documentOption(d: Pick<PurchaseDocumentListDto, 'id' | 'documentNumber' | 'supplierName'>): SearchOption {
  return { value: String(d.id), label: `${d.documentNumber ?? `draft #${d.id}`} - ${d.supplierName}` }
}

/**
 * Approved orders (Saved, Partially posted or Posted: stored status Posted), newest first, by number or supplier. The
 * server filters on the status: filtering a page of the newest orders here left the list empty when they were drafts.
 */
export const loadPurchaseOrders: SearchOptionsLoader = async (search, signal) => {
  const page = await purchaseDocumentsApi.list(
    {
      documentTypeCode: 'PO',
      status: 'Posted',
      search: search || undefined,
      pageSize: FIRST_MATCHES,
      sortBy: 'DocumentDate',
      sortDir: 'desc',
    },
    signal,
  )
  return page.items.filter((o) => o.documentNumber).map(documentOption)
}

/** Supplier invoices with a number (posted, or cancelled after posting), newest first. */
export const loadPurchaseInvoices: SearchOptionsLoader = async (search, signal) => {
  const page = await purchaseDocumentsApi.list(
    {
      documentTypeCode: 'PINV',
      search: search || undefined,
      pageSize: FIRST_MATCHES,
      sortBy: 'DocumentDate',
      sortDir: 'desc',
    },
    signal,
  )
  return page.items.filter((i) => i.documentNumber).map(documentOption)
}

/** The label of an order or invoice kept in a filter. */
export async function resolvePurchaseDocument(value: string): Promise<SearchOption | null> {
  const d = await purchaseDocumentsApi.get(Number(value))
  return documentOption(d)
}

/** Suppliers, active or not (a filter may look for an old one), by code or name. */
export const loadSuppliers: SearchOptionsLoader = async (search) => {
  const parties = await partiesApi.lookup({
    partyType: 'Supplier',
    activeOnly: false,
    search: search || undefined,
    top: FIRST_MATCHES,
  })
  return parties.map((p) => ({ value: String(p.id), label: `${p.partyCode} - ${p.partyName}` }))
}

/** "KTG-2026-0031 (MSKU1234565)" */
export function containerLabel(c: { containerRef: string; containerNo: string | null }): string {
  return c.containerNo ? `${c.containerRef} (${c.containerNo})` : c.containerRef
}

/** Containers by ref or container no., newest first. */
export const loadContainers: SearchOptionsLoader = async (search, signal) => {
  const rows = await containersApi.lookup({ search: search || undefined, top: FIRST_MATCHES }, signal)
  return rows.map((c) => ({ value: String(c.id), label: containerLabel(c) }))
}

export async function resolveContainer(value: string): Promise<SearchOption | null> {
  const [c] = await containersApi.lookup({ ids: [Number(value)] })
  return c ? { value: String(c.id), label: containerLabel(c) } : null
}

/** Movements by number (and what the movement search matches), newest first. */
export const loadMovements: SearchOptionsLoader = async (search, signal) => {
  const page = await movementsApi.list({ search: search || undefined, pageSize: FIRST_MATCHES }, signal)
  return page.items.map((m) => ({ value: String(m.id), label: `${m.movementNo} - ${m.typeName}` }))
}

export async function resolveMovement(value: string): Promise<SearchOption | null> {
  const m = await movementsApi.get(Number(value))
  return { value: String(m.id), label: `${m.movementNo} - ${m.typeName}` }
}

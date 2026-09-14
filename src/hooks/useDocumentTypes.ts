import { useCallback, useEffect, useState } from 'react'
import { inventoryLookupsApi, type DocumentTypeDto } from '../api/inventory/stockDocuments'

/**
 * The document type configuration, read once and shared.
 *
 * CACHED ACROSS THE APPLICATION, not per page: every document page and every list reads the same
 * eight rows to know how its kind numbers, prices and behaves, and eight rows fetched once are not
 * worth a spinner on each screen. The configuration page's save calls refresh(), which re-reads and
 * tells every mounted reader — so a type changed in one tab is what the next document page sees.
 */
let cache: DocumentTypeDto[] | null = null
let inflight: Promise<DocumentTypeDto[]> | null = null
const listeners = new Set<(types: DocumentTypeDto[]) => void>()

function load(force = false): Promise<DocumentTypeDto[]> {
  if (cache && !force) return Promise.resolve(cache)
  if (!inflight || force) {
    inflight = inventoryLookupsApi
      .documentTypes()
      .then((types) => {
        cache = types
        inflight = null
        listeners.forEach((listener) => listener(types))
        return types
      })
      .catch((error: unknown) => {
        inflight = null
        throw error
      })
  }
  return inflight
}

export type PricingMode = 'cost' | 'priceList' | 'none'

/** How a document kind prices its lines, as the grids read it. */
export interface DocumentPricing {
  /** cost: a typed or average cost; priceList: the price list price; none: no money on the lines. */
  mode: PricingMode
  /** Whether the price / cost column may be typed at all. */
  editable: boolean
}

/**
 * The pricing rule of a type — or the fallback while the configuration has not arrived, so a page
 * that opens before the fetch answers is not stuck with an unusable grid.
 */
export function pricingOf(type: DocumentTypeDto | undefined, fallback: DocumentPricing): DocumentPricing {
  if (!type) return fallback
  const mode: PricingMode = type.defaultPricing === 'PriceList' ? 'priceList' : type.defaultPricing === 'None' ? 'none' : 'cost'
  return { mode, editable: mode !== 'none' && type.priceEditable }
}

export function useDocumentTypes() {
  const [types, setTypes] = useState<DocumentTypeDto[]>(() => cache ?? [])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listeners.add(setTypes)
    load()
      .then(setTypes)
      .catch(() => setError('The document types could not be loaded.'))
    return () => {
      listeners.delete(setTypes)
    }
  }, [])

  const refresh = useCallback(
    () =>
      load(true)
        .then(setTypes)
        .catch(() => setError('The document types could not be loaded.')),
    [],
  )

  const byCode = useCallback((code: string) => types.find((t) => t.code === code), [types])

  return { types, loading: types.length === 0 && error === null, error, byCode, refresh }
}

import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../api/http'
import { containersApi, type ContainerOrderDefaultsDto } from '../../api/logistics/containers'
import { partiesApi } from '../../api/masterdata/parties'
import { COUNTRIES, countryLabel } from '../../data/countries'
import { supplierLabel } from '../purchase/purchaseKind'
import type { SearchOption, SearchOptionsLoader } from '../ui/SearchSelect'

/** The order a container dialog works for, with its supplier (from the order or the invoice made from it). */
export interface ContainerOrderSupplier {
  supplierId: number
  supplierCode: string
  supplierName: string
}

/**
 * WHAT AUTO-PLAN AND ADD CONTAINER FILL IN BY THEMSELVES (script 78, the owner: "the supplier must be automatic"): the
 * server's answer for the order - its supplier, the forwarder (of the order's most recent container that has one, else
 * the supplier) and the country of origin (the supplier's). Null until it answers; a failure leaves the fields empty
 * and editable, as they were before.
 */
export function useContainerOrderDefaults(purchaseOrderId: number): {
  defaults: ContainerOrderDefaultsDto | null
  error: string | null
} {
  const [state, setState] = useState<{
    id: number
    defaults: ContainerOrderDefaultsDto | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    containersApi
      .orderDefaults(purchaseOrderId, controller.signal)
      .then((defaults) => setState({ id: purchaseOrderId, defaults, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setState({
          id: purchaseOrderId,
          defaults: null,
          error: err instanceof ApiError ? err.message : 'The order defaults could not be loaded.',
        })
      })
    return () => controller.abort()
  }, [purchaseOrderId])

  const current = state?.id === purchaseOrderId ? state : null
  return { defaults: current?.defaults ?? null, error: current?.error ?? null }
}

/** The forwarder's options: the suppliers matching what is typed, from the server (not the first 50 only). */
export const loadForwarders: SearchOptionsLoader = async (search) => {
  const parties = await partiesApi.lookup({ partyType: 'Supplier', search: search || undefined, top: 50 })
  return parties.map((p) => ({ value: String(p.id), label: supplierLabel(p) }))
}

/** The defaulted forwarder as an option, so the field shows its label before anything is searched. */
export function defaultForwarderOption(defaults: ContainerOrderDefaultsDto | null): SearchOption | null {
  return defaults
    ? {
        value: String(defaults.forwarderId),
        label: supplierLabel({ partyCode: defaults.forwarderCode, partyName: defaults.forwarderName }),
      }
    : null
}

/** The hint under Forwarder: where its default came from. */
export function forwarderHint(defaults: ContainerOrderDefaultsDto | null): string {
  if (!defaults) return 'The company that ships the containers.'
  return defaults.forwarderSource === 'LastContainer' && defaults.lastContainerRef
    ? `The forwarder of ${defaults.lastContainerRef}, the order's last container. Change it if another company ships these.`
    : "The order's supplier, until a container of the order names another forwarder. Change it if another company ships these."
}

/** Country of origin: every ISO country, "India (IN)". */
export function useCountryOptions(): SearchOption[] {
  return useMemo(() => COUNTRIES.map((c) => ({ value: c.code, label: countryLabel(c) })), [])
}

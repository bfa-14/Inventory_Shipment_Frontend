import { useState } from 'react'
import { useParams } from 'react-router'
import type { PurchaseKind } from '../../components/purchase/purchaseKind'
import { PurchaseDocumentPage } from './PurchaseDocumentPage'

/**
 * The purchase document page, mounted afresh for every document it shows.
 *
 * React keeps a component's state when the same component renders in the same place, and the three
 * purchase routes render the same page. Without a key, going from an order to its invoice and back
 * reused ONE instance: the containers ticked on the order were still ticked on arrival, the charge
 * types were never loaded on an invoice first opened as an order, and the first frame showed the
 * previous document. A new key per document makes each one a page of its own.
 *
 * EXCEPT A NEW DOCUMENT'S FIRST SAVE: /new becomes /:id while the page is still working on that
 * document (Save & Post saves, then posts), so the instance that created it keeps it.
 */
export function PurchaseDocumentRoute({ kind }: { kind: PurchaseKind }) {
  const { id } = useParams()
  const [mount, setMount] = useState({ kind: kind.code, id, generation: 0 })

  // Adjusted while rendering, React's way of resetting on a prop change: no frame of the old page.
  if (mount.kind !== kind.code || (mount.id !== undefined && mount.id !== id)) {
    setMount({ kind: kind.code, id, generation: mount.generation + 1 })
  } else if (mount.id === undefined && id !== undefined) {
    setMount({ ...mount, id })
  }

  return <PurchaseDocumentPage key={mount.generation} kind={kind} />
}

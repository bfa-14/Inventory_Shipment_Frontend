import { useCallback, useMemo, useState } from 'react'

/**
 * The rows a list page has ticked for a bulk action.
 *
 * HELD AS RECORDS, NOT AS A PAGE'S INDICES, so the selection survives paging: a reader who ticks
 * three drafts on page 1 and two on page 2 posts five. It is cleared explicitly — by the Clear
 * button, by a completed action — and never by a reload, which is what a grid refresh after a post
 * would otherwise do to a half-made selection.
 */
export function useBulkSelection<T extends { id: number }>() {
  const [selected, setSelected] = useState<T[]>([])

  const ids = useMemo(() => selected.map((record) => record.id), [selected])

  const clear = useCallback(() => setSelected([]), [])

  /** Drops the rows a completed action consumed (posted, deleted), keeping the refused ones ticked. */
  const removeIds = useCallback((gone: number[]) => {
    setSelected((current) => current.filter((record) => !gone.includes(record.id)))
  }, [])

  return { selected, setSelected, ids, clear, removeIds }
}

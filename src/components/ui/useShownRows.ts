import { useState } from 'react'

/** How many rows a long card draws at first, and adds at each "Show more". */
export const SHOWN_ROWS_STEP = 200

/**
 * A LONG LIST DRAWN IN STEPS (script 78: any number of containers). Drawing 2,000 rows of badges, fill bars and
 * checkboxes at once froze the page for seconds; the card draws the first 200 and adds more on demand. Only the
 * DRAWING is cut: the rows are all loaded, so "Select every container" and the bulk actions still reach every one.
 * `resetKey` starts again from the first step when the list is replaced (a new proposal).
 */
export function useShownRows(total: number, resetKey?: unknown) {
  const [state, setState] = useState<{ key: unknown; shown: number }>({ key: resetKey, shown: SHOWN_ROWS_STEP })
  const shown = state.key === resetKey ? state.shown : SHOWN_ROWS_STEP
  return {
    limit: Math.min(shown, total),
    more: () => setState({ key: resetKey, shown: shown + SHOWN_ROWS_STEP }),
    all: () => setState({ key: resetKey, shown: Number.POSITIVE_INFINITY }),
  }
}
